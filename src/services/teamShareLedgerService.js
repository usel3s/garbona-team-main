const TeamShareOperation = require("../models/TeamShareOperation");
const SteamLog = require("../models/SteamLog");
const AppSettings = require("../models/AppSettings");
const { isMafileSessionInvalid } = require("./steamControlService");

const TEAM_SHARE_FLAGGED_KINDS = new Set(["invalid", "unsold"]);
const TEAM_SHARE_TIME_ZONE = "Europe/Moscow";
const TEAM_SHARE_TZ_OFFSET = "+03:00";
const TEAM_SHARE_EXPORT_CURSOR_KEY = "teamShareExportLastTime";

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseTeamShareDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dotted = raw.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const year = Number(dotted[3]);
    const hour = Number(dotted[4] || 0);
    const minute = Number(dotted[5] || 0);
    const second = Number(dotted[6] || 0);
    if (
      month < 1 || month > 12
      || day < 1 || day > 31
      || hour > 23 || minute > 59 || second > 59
    ) {
      throw new Error("Некорректные дата и время.");
    }
    const date = new Date(
      `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${TEAM_SHARE_TZ_OFFSET}`
    );
    if (Number.isNaN(date.getTime())) throw new Error("Некорректные дата и время.");
    return date;
  }
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(raw)) {
    const normalized = raw.replace(" ", "T");
    const withTime = /T\d{2}:\d{2}/.test(normalized)
      ? (normalized.length === 16 ? `${normalized}:00` : normalized)
      : `${normalized}T00:00:00`;
    const date = new Date(`${withTime}${TEAM_SHARE_TZ_OFFSET}`);
    if (Number.isNaN(date.getTime())) throw new Error("Некорректные дата и время.");
    return date;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw new Error("Некорректные дата и время.");
    return date;
  }
  throw new Error("Укажите дату и время как 28.08.2026 10:30:00.");
}

function formatTeamShareDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TEAM_SHARE_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function asTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveTeamShareExportRange({ from = "", to = "", lastExportTime = null, now = new Date() } = {}) {
  const fromManual = parseTeamShareDateTime(from);
  const toManual = parseTeamShareDateTime(to);
  const cursor = asTime(lastExportTime);
  let start;
  let end;
  let mode;
  if (fromManual) {
    start = fromManual;
    end = toManual || now;
    mode = "manual";
  } else {
    if (!cursor) throw new Error("Укажите дату и время начала.");
    start = cursor;
    end = toManual || now;
    mode = "auto";
  }
  if (!(start.getTime() < end.getTime())) {
    throw new Error("Начало периода должно быть раньше окончания.");
  }
  return { start, end, mode };
}

function nextTeamShareExportCursor(previous, end) {
  const prev = asTime(previous);
  const endTime = asTime(end);
  if (!endTime) return prev;
  if (!prev || endTime.getTime() > prev.getTime()) return endTime;
  return prev;
}

function buildTeamShareCreatedAtMatch(range = {}) {
  const start = asTime(range.start || range.from);
  const end = asTime(range.end || range.to);
  if (!start && !end) return {};
  const createdAt = {};
  if (start) createdAt.$gte = start;
  if (end) createdAt.$lt = end;
  return { createdAt };
}

async function getTeamShareLastExportTime() {
  const row = await AppSettings.findOne({ key: TEAM_SHARE_EXPORT_CURSOR_KEY }).lean();
  return asTime(row?.valueString);
}

async function setTeamShareLastExportTime(value) {
  const date = asTime(value);
  if (!date) throw new Error("Некорректное время выгрузки.");
  await AppSettings.findOneAndUpdate(
    { key: TEAM_SHARE_EXPORT_CURSOR_KEY },
    { valueString: date.toISOString() },
    { upsert: true }
  );
  return date;
}

async function markTeamShareExportSuccess(end, previous = null) {
  const prev = previous == null ? await getTeamShareLastExportTime() : asTime(previous);
  const next = nextTeamShareExportCursor(prev, end);
  return setTeamShareLastExportTime(next);
}

function teamShareAccountId(op) {
  const fromField = String(op?.accountId || "").trim();
  if (fromField) return fromField;
  const match = String(op?.reason || "").match(/#(\d{3,})\b/);
  return match ? match[1] : "";
}

function isFlaggedTeamShareKind(kind) {
  return TEAM_SHARE_FLAGGED_KINDS.has(String(kind || ""));
}

function mafileInventoryUsd(log) {
  const inventory = Number(log?.inventoryUsd || 0);
  if (inventory > 0) return roundUsd(inventory);
  const fromTotal = roundUsd(log?.totalProfit || 0);
  if (fromTotal > 0) return fromTotal;
  const items = Array.isArray(log?.mafileSnapshot?.items) ? log.mafileSnapshot.items : [];
  const fromItems = items.reduce((sum, item) => sum + Number(item?.price || 0), 0);
  return roundUsd(fromItems);
}

function accountStatusKey(log) {
  return String(log?.accountStatus || "").trim().toLowerCase();
}

function isConvertCommission(op) {
  return /convert/i.test(String(op?.kind || ""));
}

function isConvertedLog(log) {
  if (!log) return false;
  if (log.convertedFromMafile) return true;
  return /^(converted|onsell|onhold|sold)$/i.test(accountStatusKey(log));
}

function toSessionRow(log) {
  return {
    status: log.accountStatus || log.status,
    isMaFile:
      log.isMaFile === true
      || log.logKind === "mafile"
      || /mafile/i.test(String(log.accountStatus || log.status || "")),
    invalidDate: log.uprojectInvalidDate || log.invalidDate,
    sessionValid: log.sessionValid,
    sessionInvalid: log.sessionInvalid,
    session: log.session,
    mafileSession: log.mafileSession,
    steamInfo: log.steamInfo,
    mafileSnapshot: log.mafileSnapshot,
  };
}

function isMafileInvalid(log) {
  if (!log) return false;
  if (String(log.mafileStatus || "").toLowerCase() === "invalid") return true;
  if (isConvertedLog(log)) {
    const account = String(log.accountStatus || "").trim();
    if (/invalidsession/i.test(account)) return false;
    return /^(invalid|невалид)$/i.test(account)
      || (/невалид|invalid/i.test(account) && !/mafile/i.test(account));
  }
  if (log.sessionInvalid === true) return true;
  const account = String(log.accountStatus || "").trim();
  if (
    !/invalidsession/i.test(account)
    && (/^(invalid|невалид)$/i.test(account)
      || (/невалид|invalid/i.test(account) && !/mafile/i.test(account)))
  ) {
    return true;
  }
  return isMafileSessionInvalid(toSessionRow(log));
}

function isConvertedPair(log, extra = {}) {
  return isConvertCommission(extra) || isConvertedLog(log);
}

function convertedSaleUsd(log) {
  const sale = roundUsd(log?.autoSaleGrossUsd);
  return sale > 0 ? sale : 0;
}

function isConvertedLogSold(log) {
  if (!log) return false;
  const status = accountStatusKey(log);
  if (status === "sold" || status === "onhold") return true;
  const auto = String(log.autoSaleStatus || "");
  if (["sold_held", "arbitration", "released"].includes(auto)) return true;
  if (String(log.saleStatus || "") === "done") return true;
  if (String(log.mafileStatus || "").toLowerCase() === "sold") return true;
  return false;
}

function isConvertedLogInProgress(log) {
  if (!log || isConvertedLogSold(log)) return false;
  const status = accountStatusKey(log);
  if (status === "onsell") return true;
  if (status === "mafile" || status === "processing" || status === "onprocessing" || status === "onhandle") {
    return true;
  }
  return ["queued", "listing", "listed"].includes(String(log.autoSaleStatus || ""));
}

function convertedLogStatusLabel(log) {
  const status = String(log?.accountStatus || "").trim();
  if (status) return status;
  const auto = String(log?.autoSaleStatus || "").trim();
  if (auto && auto !== "none") return auto;
  return "нет продажи";
}

function classifyConvertedSaleIssue(log, commissionUsd, extra = {}) {
  const accountId = String(extra.accountId || log?.sourceId || "").trim();
  const inventoryUsd = log ? mafileInventoryUsd(log) : 0;
  const saleUsd = log ? convertedSaleUsd(log) : 0;
  const sold = isConvertedLogSold(log);
  const inProgress = isConvertedLogInProgress(log);
  const invalid = isMafileInvalid(log) && !sold;
  const unsold = Boolean(log) && !sold && !inProgress;
  const withdrawnUsd = sold || saleUsd > 0 ? saleUsd : unsold ? 0 : null;
  let kind = "";
  let label = "";
  if (invalid) {
    kind = "invalid";
    label = "Невалид";
  } else if (unsold) {
    kind = "unsold";
    label = "Не продан";
  }
  return {
    kind,
    label,
    detail: `комиссия $${commissionUsd.toFixed(2)} · лог #${accountId || "—"} · ${convertedLogStatusLabel(log)}${saleUsd > 0 ? ` · продажа $${saleUsd.toFixed(2)}` : ""}`,
    inventoryUsd,
    withdrawnUsd,
    yieldPct: null,
    shortfallUsd: invalid || unsold ? commissionUsd : 0,
    flagged: isFlaggedTeamShareKind(kind),
    converted: true,
    logId: accountId,
    saleStatus: convertedLogStatusLabel(log),
  };
}

function classifyMafileWithdrawIssue(log, commissionUsd) {
  const inventoryUsd = log ? mafileInventoryUsd(log) : 0;
  const status = String(log?.mafileStatus || "").toLowerCase();
  const withdrawnAmount = roundUsd(log?.mafileWithdrawnAmount);
  const withdrawnKnown = status === "withdrawn" || status === "sold" || withdrawnAmount > 0;
  const withdrawnUsd = withdrawnKnown || isMafileInvalid(log) ? withdrawnAmount : null;
  const invalid = isMafileInvalid(log);
  const yieldPct =
    inventoryUsd > 0 && withdrawnUsd != null
      ? Number(((withdrawnUsd / inventoryUsd) * 100).toFixed(1))
      : null;

  return {
    kind: invalid ? "invalid" : "",
    label: invalid ? "Невалид" : "",
    detail:
      withdrawnUsd != null
        ? `комиссия $${commissionUsd.toFixed(2)} · снято $${withdrawnUsd.toFixed(2)} · инв. $${inventoryUsd.toFixed(2)}`
        : `комиссия $${commissionUsd.toFixed(2)}`,
    inventoryUsd,
    withdrawnUsd,
    yieldPct,
    shortfallUsd: invalid ? commissionUsd : 0,
    flagged: invalid,
    converted: false,
    logId: "",
    saleStatus: "",
  };
}

function classifyTeamShareMafileFlag(log) {
  const issue = classifyTeamShareIssue(log, 0);
  if (issue.kind !== "invalid" && issue.kind !== "unsold") return null;
  return issue;
}

function classifyTeamShareIssue(log, amountUsd = 0, extra = {}) {
  const commissionUsd = roundUsd(amountUsd);
  if (isConvertedPair(log, extra)) {
    return classifyConvertedSaleIssue(log, commissionUsd, extra);
  }
  return classifyMafileWithdrawIssue(log, commissionUsd);
}

function teamShareAdminLabel(row) {
  if (String(row?.source || "") === "uproject") return "UProject";
  const username = String(row?.actorUsername || "").trim();
  if (username) return username.startsWith("@") ? username : `@${username}`;
  return String(row?.actorTelegramId || "").trim() || "Админ";
}

function moneyCell(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

function moneyLine(value) {
  const text = moneyCell(value);
  return text ? `$${text}` : "—";
}

function formatExportDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

function teamShareExportTitle(row) {
  const id = String(row?.accountId || row?.logId || "").trim();
  let title = String(row?.reason || "").trim().replace(/^UProject\s*·\s*/i, "");
  if (!title) {
    title = row?.converted ? "Конвертация MaFile" : "Комиссия MaFile";
  }
  if (id && !title.includes(`#${id}`)) title = `${title} · #${id}`;
  return title;
}

function teamShareFlagExportTxt(rows, range = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const body = list
    .map((row, index) => {
      const status = String(row.flagLabel || "").trim()
        || (row.flag === "unsold" ? "Не продан" : "")
        || (row.flag === "invalid" ? "Невалид" : "")
        || String(row.flag || "").trim()
        || "—";
      const lines = [
        `${index + 1}. ${teamShareExportTitle(row)}`,
        `Дата: ${formatExportDate(row.createdAt) || "—"}`,
        `Комиссия: ${moneyLine(row.amountUsd)}`,
        `Снято: ${row.withdrawnUsd == null ? "—" : moneyLine(row.withdrawnUsd)}`,
        `Инвентарь: ${row.inventoryUsd ? moneyLine(row.inventoryUsd) : "—"}`,
        `Статус: ${status}`,
      ];
      const logId = String(row.logId || "").trim();
      const accountId = String(row.accountId || "").trim();
      if (row.converted && logId && logId !== accountId) {
        lines.splice(2, 0, `Лог: #${logId}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
  const totalUsd = roundUsd(list.reduce((sum, row) => sum + Number(row?.amountUsd || 0), 0));
  const footer = `Итого: ${moneyLine(totalUsd)}`;
  const start = asTime(range.start);
  const end = asTime(range.end);
  const header = start && end
    ? `Период: ${formatTeamShareDateTime(start)} — ${formatTeamShareDateTime(end)} МСК\n\n`
    : "";
  const content = body ? `${body}\n\n${footer}` : footer;
  return `${header}${content}`;
}

function signedMoneyLine(value) {
  const amount = roundUsd(value);
  return `${amount < 0 ? "−" : ""}$${Math.abs(amount).toFixed(2)}`;
}

function teamShareFullExportTxt(rows, range = {}, summary = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const gross = roundUsd(summary.teamShareGrossUsd);
  const debited = roundUsd(summary.teamShareDebitedUsd);
  const net = roundUsd(summary.teamShareUsd ?? gross - debited);
  const onHold = roundUsd(summary.teamShareOnHoldUsd);
  const activeTotal = roundUsd(
    list.reduce(
      (sum, row) => sum + (String(row?.status || "active") === "canceled" ? 0 : Number(row?.amountUsd || 0)),
      0
    )
  );
  const canceledTotal = roundUsd(
    list.reduce(
      (sum, row) => sum + (String(row?.status || "active") === "canceled" ? Number(row?.amountUsd || 0) : 0),
      0
    )
  );
  const start = asTime(range.start);
  const end = asTime(range.end);
  const header = [
    "Доля команды — полный отчёт",
    start && end
      ? `Период операций: ${formatTeamShareDateTime(start)} — ${formatTeamShareDateTime(end)} МСК`
      : "Период операций: весь доступный",
    "",
    "Текущий баланс:",
    `Начислено без холда: ${signedMoneyLine(gross)}`,
    `Списано всего: ${signedMoneyLine(debited)}`,
    `Итог: ${signedMoneyLine(net)}`,
    `В холде: ${signedMoneyLine(onHold)}`,
    "",
    `Операций в отчёте: ${list.length}`,
    `Активные списания за период: ${signedMoneyLine(activeTotal)}`,
    `Отменённые операции за период: ${signedMoneyLine(canceledTotal)}`,
  ];
  const body = list.map((row, index) => {
    const canceled = String(row?.status || "active") === "canceled";
    const issue = String(row?.flagLabel || "").trim() || "Нет";
    const lines = [
      `${index + 1}. ${teamShareExportTitle(row)}`,
      `Дата: ${formatExportDate(row.createdAt) || "—"}`,
      `Сумма: −$${Number(row?.amountUsd || 0).toFixed(2)}`,
      `Состояние операции: ${canceled ? "Отменена" : "Активна"}`,
      `Источник: ${teamShareAdminLabel(row)}`,
      `Тип: ${String(row?.kind || "").trim() || "Ручная операция"}`,
      `ID операции UProject: ${String(row?.externalId || "").trim() || "—"}`,
      `Снято с MaFile: ${row?.withdrawnUsd == null ? "—" : moneyLine(row.withdrawnUsd)}`,
      `Инвентарь: ${row?.inventoryUsd ? moneyLine(row.inventoryUsd) : "—"}`,
      `Расхождение: ${issue}`,
      `Причина: ${String(row?.reason || "").trim() || "—"}`,
    ];
    const logId = String(row?.logId || "").trim();
    const accountId = String(row?.accountId || "").trim();
    if (accountId) lines.splice(1, 0, `MaFile: #${accountId}`);
    if (logId && logId !== accountId) lines.splice(2, 0, `Лог: #${logId}`);
    if (canceled && row?.canceledAt) {
      lines.push(`Отменена: ${formatExportDate(row.canceledAt)}`);
    }
    return lines.join("\n");
  });
  return [
    ...header,
    ...(body.length
      ? ["", ...body.flatMap((item, index) => (index ? ["", item] : [item]))]
      : ["", "Операций нет."]),
  ].join("\n");
}

function emptyIssueFields(op = {}) {
  return {
    flag: "",
    flagLabel: "",
    flagDetail: "",
    inventoryUsd: 0,
    withdrawnUsd: null,
    yieldPct: null,
    shortfallUsd: 0,
    converted: false,
    logId: "",
    saleStatus: "",
    adminLabel: teamShareAdminLabel(op),
  };
}

function steamLogLookupValues(ids) {
  const values = [];
  for (const id of ids) {
    const text = String(id);
    values.push(text);
    if (/^\d+$/.test(text)) values.push(Number(text));
  }
  return [...new Set(values)];
}

function unwrapSteamAccount(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.id != null || payload.steamInfo || payload.username) return payload;
  if (payload.data && typeof payload.data === "object") return unwrapSteamAccount(payload.data);
  if (payload.account && typeof payload.account === "object") return unwrapSteamAccount(payload.account);
  if (payload.row && typeof payload.row === "object") return unwrapSteamAccount(payload.row);
  return null;
}

function inventoryUsdFromAccount(account) {
  const price = account?.inventory?.price;
  if (price && typeof price === "object") {
    for (const key of ["tradable", "marketable", "total", "usd", "value"]) {
      const n = Number(price[key]);
      if (Number.isFinite(n) && n > 0) return roundUsd(n);
    }
  }
  return 0;
}

function mergeLiveAccount(log, account) {
  if (!account) return log;
  const merged = { ...(log || {}) };
  const liveInventory = inventoryUsdFromAccount(account);
  if (liveInventory > mafileInventoryUsd(merged)) {
    merged.inventoryUsd = liveInventory;
  }
  const status = String(account.status || "").trim();
  if (status) merged.accountStatus = status;
  if (/^(converted|onsell|onhold|sold)$/i.test(status)) {
    merged.convertedFromMafile = true;
  }
  if (account.invalidDate != null) merged.invalidDate = account.invalidDate;
  if (account.invalid_date != null && merged.invalidDate == null) merged.invalidDate = account.invalid_date;
  if (account.sessionValid != null) merged.sessionValid = account.sessionValid;
  if (account.sessionInvalid != null) merged.sessionInvalid = account.sessionInvalid;
  if (account.isMaFile != null) merged.isMaFile = account.isMaFile;
  if (isMafileSessionInvalid(account)) merged.sessionInvalid = true;
  return merged;
}

function withTeamShareIssue(op, log) {
  const issue = classifyTeamShareIssue(log, op.amountUsd, {
    accountId: op.accountId,
    kind: op.kind,
  });
  return {
    ...op,
    flag: issue.kind,
    flagLabel: issue.label,
    flagDetail: issue.detail,
    inventoryUsd: issue.inventoryUsd,
    withdrawnUsd: issue.withdrawnUsd,
    yieldPct: issue.yieldPct,
    shortfallUsd: issue.shortfallUsd,
    converted: Boolean(issue.converted),
    logId: String(issue.logId || (issue.converted ? op.accountId : "") || ""),
    saleStatus: String(issue.saleStatus || ""),
    adminLabel: teamShareAdminLabel(op),
  };
}

async function loadSteamLogsByAccountIds(ids) {
  if (!ids.length) return new Map();
  const logs = await SteamLog.find({ sourceId: { $in: steamLogLookupValues(ids) } })
    .select("sourceId mafileStatus accountStatus inventoryUsd totalProfit balanceUsd mafileWithdrawnAmount mafileSnapshot.items convertedFromMafile logKind autoSaleStatus saleStatus autoSaleGrossUsd autoSaleError autoSaleListedAt sessionInvalid uprojectInvalidDate")
    .lean();
  return new Map(logs.map((log) => [String(log.sourceId), log]));
}

async function hydrateLogsFromUproject(byId, ids, ops = []) {
  const convertIds = new Set(
    (ops || [])
      .filter((op) => isConvertCommission(op) || isConvertedLog(byId.get(String(op.accountId || ""))))
      .map((op) => String(op.accountId || "").trim())
      .filter(Boolean)
  );
  const missing = ids.filter((id) => {
    const log = byId.get(id);
    if (!log) return true;
    if (mafileInventoryUsd(log) <= 0) return true;
    if (convertIds.has(id) && !isConvertedLogSold(log)) return true;
    if (isConvertedLog(log) && !isConvertedLogSold(log)) return true;
    if (!isConvertedLog(log) && !isMafileInvalid(log)) return true;
    return false;
  });
  if (!missing.length) return;
  const { getSteamAccountById } = require("./steamApiService");
  await Promise.all(missing.map(async (id) => {
    try {
      const account = unwrapSteamAccount(await getSteamAccountById(null, id));
      if (!account) return;
      byId.set(id, mergeLiveAccount(byId.get(id), account));
    } catch (_) {
      /* UProject may no longer have the account */
    }
  }));
}

async function enrichTeamShareOperations(ops, { hydrateLive = false } = {}) {
  const serialized = (ops || []).map((op) => serializeTeamShareOperation(op));
  const ids = [...new Set(serialized.map((op) => String(op.accountId || "").trim()).filter(Boolean))];
  if (!ids.length) {
    return serialized.map((op) => ({ ...op, ...emptyIssueFields(op) }));
  }

  const byId = await loadSteamLogsByAccountIds(ids);
  if (hydrateLive) await hydrateLogsFromUproject(byId, ids, serialized);

  return serialized.map((op) => withTeamShareIssue(op, byId.get(String(op.accountId || ""))));
}

async function hydrateIncompleteTeamShareOps(rows) {
  const need = (rows || []).filter((row) => {
    const id = String(row.accountId || "").trim();
    if (!id) return false;
    if (row.flag === "unsold") return true;
    if (!row.flag && !row.converted) return true;
    return row.withdrawnUsd == null || !(Number(row.inventoryUsd) > 0);
  });
  if (!need.length) return rows || [];
  const ids = [...new Set(need.map((row) => String(row.accountId)))];
  const byId = await loadSteamLogsByAccountIds(ids);
  await hydrateLogsFromUproject(byId, ids, need);
  return (rows || []).map((op) => {
    const id = String(op.accountId || "").trim();
    if (!id || !need.some((row) => String(row.accountId) === id)) return op;
    return withTeamShareIssue(op, byId.get(id));
  });
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTeamShareOpsMatch(q) {
  const raw = String(q || "").trim();
  if (!raw) return {};
  const id = raw.replace(/^#/, "").trim();
  if (/^\d{3,}$/.test(id)) {
    return {
      $or: [
        { accountId: id },
        { externalId: id },
        { reason: new RegExp(`#${id}(?:\\D|$)`) },
      ],
    };
  }
  const escaped = escapeRegex(raw);
  const $or = [
    { accountId: new RegExp(escaped, "i") },
    { reason: new RegExp(escaped, "i") },
    { kind: new RegExp(escaped, "i") },
    { actorUsername: new RegExp(escaped, "i") },
    { actorTelegramId: new RegExp(escaped, "i") },
    { externalId: new RegExp(escaped, "i") },
  ];
  if (/uproject/i.test(raw)) $or.push({ source: "uproject" });
  return { $or };
}

function applyTeamShareDebits(releasedTeamUsd, debitedUsd) {
  const gross = roundUsd(releasedTeamUsd);
  const debited = roundUsd(debitedUsd);
  return {
    teamShareGrossUsd: gross,
    teamShareDebitedUsd: debited,
    teamShareUsd: roundUsd(gross - debited),
  };
}

function serializeTeamShareOperation(row) {
  const status = String(row.status || "active") === "canceled" ? "canceled" : "active";
  return {
    id: String(row._id),
    amountUsd: roundUsd(row.amountUsd),
    reason: String(row.reason || ""),
    actorTelegramId: String(row.actorTelegramId || ""),
    actorUsername: String(row.actorUsername || ""),
    source: String(row.source || "manual"),
    kind: String(row.kind || ""),
    accountId: teamShareAccountId(row),
    externalId: row.externalId ? String(row.externalId) : "",
    status,
    canceledAt: row.canceledAt || null,
    canceledByTelegramId: String(row.canceledByTelegramId || ""),
    canceledByUsername: String(row.canceledByUsername || ""),
    createdAt: row.createdAt || null,
    canCancel: status === "active",
  };
}

async function sumTeamShareDebits(range = {}) {
  const match = {
    status: { $ne: "canceled" },
    ...buildTeamShareCreatedAtMatch(range),
  };
  const rows = await TeamShareOperation.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$amountUsd" } } },
  ]);
  return roundUsd(rows[0]?.total || 0);
}

async function collectFlaggedTeamShareOperations(q = "", range = {}) {
  const match = {
    status: { $ne: "canceled" },
    ...buildTeamShareOpsMatch(q),
    ...buildTeamShareCreatedAtMatch(range),
  };
  const query = TeamShareOperation.find(match).sort({ createdAt: -1 });
  if (!range.start && !range.end) query.limit(5000);
  const all = await query.lean();
  return (await enrichTeamShareOperations(all, { hydrateLive: true })).filter(
    (row) => isFlaggedTeamShareKind(row.flag)
  );
}

async function collectAllTeamShareOperations(q = "", range = {}) {
  const match = {
    ...buildTeamShareOpsMatch(q),
    ...buildTeamShareCreatedAtMatch(range),
  };
  const rows = await TeamShareOperation.find(match).sort({ createdAt: -1 }).lean();
  return enrichTeamShareOperations(rows, { hydrateLive: true });
}

async function listTeamShareOperations({
  limit = 5,
  page = 0,
  q = "",
  flaggedOnly = false,
  range = {},
} = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 5));
  const requestedPage = Math.max(0, Number.parseInt(page, 10) || 0);
  const match = {
    ...buildTeamShareOpsMatch(q),
    ...buildTeamShareCreatedAtMatch(range),
  };
  const wantFlagged = Boolean(flaggedOnly);

  if (!wantFlagged) {
    const total = await TeamShareOperation.countDocuments(match);
    const pageCount = Math.max(1, Math.ceil(total / safeLimit) || 1);
    const pageIndex = Math.min(requestedPage, pageCount - 1);
    const rows = await TeamShareOperation.find(match)
      .sort({ createdAt: -1 })
      .skip(pageIndex * safeLimit)
      .limit(safeLimit)
      .lean();
    return {
      rows: await enrichTeamShareOperations(rows, { hydrateLive: true }),
      total,
      page: pageIndex,
      pageCount,
      limit: safeLimit,
      q: String(q || "").trim(),
      flaggedOnly: false,
    };
  }

  const flagged = await collectFlaggedTeamShareOperations(q, range);
  const total = flagged.length;
  const pageCount = Math.max(1, Math.ceil(total / safeLimit) || 1);
  const pageIndex = Math.min(requestedPage, pageCount - 1);
  return {
    rows: await hydrateIncompleteTeamShareOps(
      flagged.slice(pageIndex * safeLimit, pageIndex * safeLimit + safeLimit)
    ),
    total,
    page: pageIndex,
    pageCount,
    limit: safeLimit,
    q: String(q || "").trim(),
    flaggedOnly: true,
  };
}

async function exportFlaggedTeamShareOperations({
  q = "",
  from = "",
  to = "",
  now = new Date(),
  lastExportTime,
} = {}) {
  const cursor = lastExportTime === undefined
    ? await getTeamShareLastExportTime()
    : asTime(lastExportTime);
  const range = resolveTeamShareExportRange({ from, to, lastExportTime: cursor, now });
  const rows = await collectFlaggedTeamShareOperations(q, range);
  return {
    txt: teamShareFlagExportTxt(rows, range),
    total: rows.length,
    rows,
    start: range.start,
    end: range.end,
    mode: range.mode,
    startLabel: formatTeamShareDateTime(range.start),
    endLabel: formatTeamShareDateTime(range.end),
  };
}

async function exportAllTeamShareOperations({
  q = "",
  from = "",
  to = "",
  now = new Date(),
  lastExportTime,
  summary = {},
} = {}) {
  let cursor = asTime(lastExportTime);
  if (!String(from || "").trim() && lastExportTime === undefined) {
    const first = await TeamShareOperation.findOne(buildTeamShareOpsMatch(q))
      .sort({ createdAt: 1 })
      .select("createdAt")
      .lean();
    cursor = asTime(first?.createdAt) || new Date(now);
  }
  const range = resolveTeamShareExportRange({ from, to, lastExportTime: cursor, now });
  const rows = await collectAllTeamShareOperations(q, range);
  return {
    txt: teamShareFullExportTxt(rows, range, summary),
    total: rows.length,
    rows,
    start: range.start,
    end: range.end,
    mode: range.mode,
    startLabel: formatTeamShareDateTime(range.start),
    endLabel: formatTeamShareDateTime(range.end),
  };
}

async function createTeamShareDebit({
  amountUsd,
  reason,
  actorTelegramId = "",
  actorUsername = "",
  availableUsd = null,
  source = "manual",
  kind = "",
  accountId = "",
  externalId = null,
  createdAt = null,
  skipAvailableCheck = false,
} = {}) {
  const amount = roundUsd(amountUsd);
  const note = String(reason || "").trim();
  if (!(amount > 0)) {
    throw new Error("Сумма списания должна быть больше 0.");
  }
  if (note.length < 3) {
    throw new Error("Укажите причину списания.");
  }
  if (!skipAvailableCheck && availableUsd != null && amount > roundUsd(availableUsd) + 0.001) {
    throw new Error(
      `Нельзя списать больше доли команды (доступно $${roundUsd(availableUsd).toFixed(2)}).`
    );
  }
  const payload = {
    amountUsd: amount,
    reason: note.slice(0, 400),
    actorTelegramId: String(actorTelegramId || ""),
    actorUsername: String(actorUsername || "").slice(0, 80),
    source: source === "uproject" ? "uproject" : "manual",
    kind: String(kind || "").slice(0, 80),
    accountId: teamShareAccountId({ accountId, reason: note }).slice(0, 32),
    status: "active",
  };
  const ext = String(externalId || "").trim();
  if (ext) payload.externalId = ext;
  if (createdAt) payload.createdAt = createdAt;
  const doc = await TeamShareOperation.create(payload);
  return serializeTeamShareOperation(doc);
}

async function cancelTeamShareDebit({
  id,
  actorTelegramId = "",
  actorUsername = "",
} = {}) {
  const opId = String(id || "").trim();
  if (!opId) throw new Error("Операция не найдена.");
  const doc = await TeamShareOperation.findById(opId);
  if (!doc) throw new Error("Операция не найдена.");
  if (String(doc.status || "active") === "canceled") {
    return serializeTeamShareOperation(doc);
  }
  doc.status = "canceled";
  doc.canceledAt = new Date();
  doc.canceledByTelegramId = String(actorTelegramId || "");
  doc.canceledByUsername = String(actorUsername || "").slice(0, 80);
  await doc.save();
  return serializeTeamShareOperation(doc);
}

async function findTeamShareDebitByExternalId(externalId) {
  const id = String(externalId || "").trim();
  if (!id) return null;
  return TeamShareOperation.findOne({ externalId: id });
}

module.exports = {
  TEAM_SHARE_FLAGGED_KINDS,
  TEAM_SHARE_TIME_ZONE,
  roundUsd,
  escapeRegex,
  teamShareAccountId,
  isFlaggedTeamShareKind,
  mafileInventoryUsd,
  isMafileInvalid,
  classifyTeamShareMafileFlag,
  classifyTeamShareIssue,
  teamShareAdminLabel,
  parseTeamShareDateTime,
  formatTeamShareDateTime,
  resolveTeamShareExportRange,
  nextTeamShareExportCursor,
  buildTeamShareCreatedAtMatch,
  teamShareFlagExportTxt,
  teamShareFullExportTxt,
  enrichTeamShareOperations,
  buildTeamShareOpsMatch,
  applyTeamShareDebits,
  serializeTeamShareOperation,
  collectAllTeamShareOperations,
  collectFlaggedTeamShareOperations,
  sumTeamShareDebits,
  listTeamShareOperations,
  getTeamShareLastExportTime,
  markTeamShareExportSuccess,
  exportFlaggedTeamShareOperations,
  exportAllTeamShareOperations,
  createTeamShareDebit,
  cancelTeamShareDebit,
  findTeamShareDebitByExternalId,
};
