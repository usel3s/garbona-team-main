const User = require("../models/User");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const { env } = require("../config/env");
const { pe, urlBtn } = require("../utils/emoji");
const { payoutModerationKeyboard, homeOnlyKeyboard } = require("../keyboards/common");
const { Markup } = require("telegraf");
const mongoose = require("mongoose");

const LOCK_STATUSES = ["pending", "awaiting_payout_link"];

const METHOD_LABELS = {
  usdt_trc20: "USDT TRC20",
  usdt_bep20: "USDT BEP20",
  ton_gram: "TON (GRAM)",
  solana: "Solana",
  xRocketr: "xRocket",
  cryptobot: "CryptoBot",
  lolz: "Lolz",
  usdt_ton: "USDT TON",
};

const LINK_PAYOUT_METHODS = new Set(["xRocketr", "cryptobot"]);
const NICKNAME_PAYOUT_METHODS = new Set(["lolz"]);

function isLinkPayoutMethod(method) {
  return LINK_PAYOUT_METHODS.has(String(method || "").trim());
}

function isNicknamePayoutMethod(method) {
  return NICKNAME_PAYOUT_METHODS.has(String(method || "").trim());
}

function payoutLinkLabel(method) {
  return isLinkPayoutMethod(method) ? "чек" : "транзакцию";
}

function payoutOpenButtonLabel(method) {
  return isLinkPayoutMethod(method) ? "Открыть чек" : "Открыть транзакцию";
}

let cachedWithdrawalFees = null;

function defaultWithdrawalFees() {
  return {
    usdt_trc20: env.withdrawFeeUsdtTrc20,
    usdt_bep20: env.withdrawFeeUsdtBep20,
    ton_gram: env.withdrawFeeTonGram,
    solana: env.withdrawFeeSolana,
    usdt_ton: env.withdrawFeeTonGram,
    xRocketr: 0,
    cryptobot: 0,
    lolz: 0,
  };
}

async function loadWithdrawalFees(force = false) {
  if (cachedWithdrawalFees && !force) return cachedWithdrawalFees;
  try {
    const { getWithdrawalFees } = require("./settingsService");
    cachedWithdrawalFees = await getWithdrawalFees();
  } catch (_) {
    cachedWithdrawalFees = defaultWithdrawalFees();
  }
  return cachedWithdrawalFees;
}

function invalidateWithdrawalFeesCache() {
  cachedWithdrawalFees = null;
}

function methodLabel(method) {
  return METHOD_LABELS[method] || method;
}

function getNetworkFeeUsd(method, fees = cachedWithdrawalFees || defaultWithdrawalFees()) {
  const map = fees || defaultWithdrawalFees();
  const fee = Number(map[method] ?? 0);
  return Number((Number.isFinite(fee) && fee > 0 ? fee : 0).toFixed(2));
}

async function getNetworkFeeUsdAsync(method) {
  const fees = await loadWithdrawalFees();
  return getNetworkFeeUsd(method, fees);
}

/**
 * Сумма заявки списывается с баланса; комиссия сети вычитается из неё.
 * @returns {{ amountUsd: number, networkFee: number, payoutAmount: number }}
 */
function calcPayoutBreakdown(amountUsd, method) {
  const amount = Number(Number(amountUsd || 0).toFixed(2));
  const networkFee = getNetworkFeeUsd(method);
  const payoutAmount = Number(Math.max(0, amount - networkFee).toFixed(2));
  return { amountUsd: amount, networkFee, payoutAmount };
}

function getMinWithdrawalUsd() {
  return 1;
}

function payoutActor(adminTelegramId, extra = {}) {
  return {
    actorTelegramId: String(adminTelegramId || extra.actorTelegramId || ""),
    actorUsername: String(extra.actorUsername || "").slice(0, 80),
  };
}

function statusHistoryEntry(status, adminTelegramId, extra = {}) {
  return {
    status: String(status || ""),
    at: extra.at || new Date(),
    note: String(extra.note || "").slice(0, 400),
    ...payoutActor(adminTelegramId, extra),
  };
}

function payoutShortId(id) {
  return String(id || "").slice(-8);
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeWalletAddress(raw) {
  return String(raw || "").trim().replace(/\s+/g, "");
}

function normalizeLolzNickname(raw) {
  let value = String(raw || "").trim().replace(/^@+/, "");
  if (!value) return "";
  try {
    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value);
      const path = String(parsed.pathname || "").replace(/\/+$/, "");
      const member = path.match(/\/(?:members|users)\/([^/]+)/i);
      if (member) value = decodeURIComponent(member[1]);
    }
  } catch (_) {
    /* keep trimmed value */
  }
  return value.replace(/^@+/, "").replace(/\/+$/, "").trim();
}

function validateWalletAddress(method, address) {
  if (isLinkPayoutMethod(method)) {
    return { ok: true, address: "" };
  }
  if (isNicknamePayoutMethod(method)) {
    const nick = normalizeLolzNickname(address);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}$/.test(nick) || nick.length < 3) {
      return { ok: false, error: "Укажите ник на Lolz." };
    }
    return { ok: true, address: nick };
  }
  const addr = normalizeWalletAddress(address);
  if (!addr || addr.length < 10 || addr.length > 128) {
    return { ok: false, error: "Некорректный адрес кошелька." };
  }

  if (method === "usdt_trc20") {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
      return { ok: false, error: "Адрес TRC20 должен начинаться с T и содержать 34 символа." };
    }
  } else if (method === "usdt_bep20") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      return { ok: false, error: "Адрес BEP20 должен быть в формате 0x… (42 символа)." };
    }
  } else if (method === "ton_gram") {
    if (!/^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(addr) && !/^0:[a-fA-F0-9]{64}$/.test(addr)) {
      return {
        ok: false,
        error: "Адрес TON должен начинаться с EQ/UQ или быть в формате 0:…",
      };
    }
  } else if (method === "solana") {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
      return {
        ok: false,
        error: "Адрес Solana должен быть в формате base58 (32–44 символа).",
      };
    }
  }

  return { ok: true, address: addr };
}

const MAX_PAYOUT_REQUISITES = 8;

function newRequisiteId() {
  return `rq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function serializePayoutRequisite(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || "").trim();
  const method = String(row.method || "").trim();
  const address = String(row.address || "").trim();
  if (!method || (!address && !isLinkPayoutMethod(method))) return null;
  return { id: id || newRequisiteId(), method, address };
}

function listPayoutRequisites(user) {
  const rows = Array.isArray(user?.payoutRequisites) ? user.payoutRequisites : [];
  const mapped = rows.map(serializePayoutRequisite).filter(Boolean);
  if (mapped.length) return mapped;
  if (user?.payoutMethod && user?.payoutAddress) {
    return [
      {
        id: "legacy",
        method: String(user.payoutMethod),
        address: String(user.payoutAddress),
      },
    ];
  }
  return [];
}

function setPayoutRequisites(user, items) {
  const incoming = Array.isArray(items) ? items : [];
  if (incoming.length > MAX_PAYOUT_REQUISITES) {
    throw new Error(`Можно сохранить не больше ${MAX_PAYOUT_REQUISITES} реквизитов.`);
  }
  const seen = new Set();
  const next = [];
  for (const row of incoming) {
    const method = String(row?.method || "").trim();
    if (!METHOD_LABELS[method]) {
      throw new Error("Неизвестный метод выплат");
    }
    const check = validateWalletAddress(method, row?.address);
    if (!check.ok) throw new Error(check.error);
    const key = `${method}::${check.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({
      id: String(row?.id || "").trim() || newRequisiteId(),
      method,
      address: check.address,
    });
  }
  user.payoutRequisites = next;
  user.payoutMethod = next[0]?.method || "";
  user.payoutAddress = next[0]?.address || "";
  return next;
}

async function sumReservedUsd(telegramId, session = null) {
  const agg = await WithdrawalRequest.aggregate([
    { $match: { telegramId: String(telegramId), status: { $in: LOCK_STATUSES } } },
    { $group: { _id: null, total: { $sum: "$amountUsd" } } },
  ]).session(session);
  return Number((agg[0]?.total || 0).toFixed(2));
}

async function getAvailableUsd(user) {
  const reserved = Number(user.reservedWithdrawalUsd || 0);
  const frozen = Number(user.frozenSaleUsd || 0);
  return Number((Number(user.totalProfit || 0) - reserved - frozen).toFixed(2));
}

async function hasPendingRequest(telegramId) {
  const n = await WithdrawalRequest.countDocuments({
    telegramId: String(telegramId),
    status: { $in: LOCK_STATUSES },
  });
  return n > 0;
}

async function createWithdrawalRequest(user, amountUsd, method, walletAddress) {
  const requestedAmount = Number(Number(amountUsd || 0).toFixed(2));
  const minWithdrawalUsd = getMinWithdrawalUsd();
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new Error("Некорректная сумма вывода.");
  }
  if (requestedAmount + 1e-9 < minWithdrawalUsd) {
    throw new Error(`Минимальная сумма вывода: ${formatUsd(minWithdrawalUsd)}.`);
  }
  if (await hasPendingRequest(user.telegramId)) {
    throw new Error("Уже есть активная заявка на вывод.");
  }
  const check = validateWalletAddress(method, walletAddress);
  if (!check.ok) throw new Error(check.error);

  const { amountUsd: amount, networkFee, payoutAmount } = calcPayoutBreakdown(
    requestedAmount,
    method
  );
  if (payoutAmount <= 0) {
    throw new Error(
      `Сумма должна быть больше комиссии сети (${formatUsd(networkFee)}).`
    );
  }

  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      // Available = totalProfit − reserved − LZT sale hold (frozenSaleUsd).
      const lockedUser = await User.findOneAndUpdate(
        {
          _id: user._id,
          $expr: {
            $gte: [
              {
                $subtract: [
                  "$totalProfit",
                  {
                    $add: [
                      { $ifNull: ["$reservedWithdrawalUsd", 0] },
                      { $ifNull: ["$frozenSaleUsd", 0] },
                    ],
                  },
                ],
              },
              amount,
            ],
          },
        },
        { $inc: { reservedWithdrawalUsd: amount } },
        { new: true, session }
      );
      if (!lockedUser) {
        throw new Error("Недостаточно средств с учётом холда продаж и активных заявок.");
      }
      const rows = await WithdrawalRequest.create([{
        userId: lockedUser._id,
        telegramId: String(lockedUser.telegramId),
        username: lockedUser.username || "",
        amountUsd: amount,
        method,
        walletAddress: check.address,
        status: "pending",
        statusHistory: [statusHistoryEntry("pending", "", { note: "Создана" })],
      }], { session });
      created = rows[0];
    });
    return created;
  } finally {
    await session.endSession();
  }
}

async function attachChannelMeta(requestId, chatId, messageId) {
  return WithdrawalRequest.findByIdAndUpdate(
    requestId,
    {
      channelChatId: String(chatId),
      channelMessageId: String(messageId),
    },
    { new: true }
  );
}

async function resetPendingApproval(requestId, extra = {}) {
  return WithdrawalRequest.findByIdAndUpdate(
    requestId,
    {
      status: "pending",
      awaitingAdminTelegramId: "",
      $push: {
        statusHistory: statusHistoryEntry("pending", extra.actorTelegramId || "", {
          ...extra,
          note: extra.note || "Возвращена в очередь",
        }),
      },
    },
    { new: true }
  );
}

async function setAwaitingPayoutLink(requestId, adminTelegramId, extra = {}) {
  return WithdrawalRequest.findOneAndUpdate(
    { _id: requestId, status: "pending" },
    {
      status: "awaiting_payout_link",
      awaitingAdminTelegramId: String(adminTelegramId),
      $push: {
        statusHistory: statusHistoryEntry("awaiting_payout_link", adminTelegramId, {
          ...extra,
          note: extra.note || "Принята, ожидает ссылку",
        }),
      },
    },
    { new: true }
  ).populate("userId");
}

async function findAwaitingLinkForAdmin(adminTelegramId) {
  return WithdrawalRequest.findOne({
    status: "awaiting_payout_link",
    awaitingAdminTelegramId: String(adminTelegramId),
  })
    .sort({ updatedAt: -1 })
    .populate("userId");
}

async function completePayoutWithLink(requestId, payoutUrl, adminTelegramId, extra = {}) {
  const normalizedUrl = normalizePayoutUrl(payoutUrl);
  if (!normalizedUrl) throw new Error("Укажите корректную ссылку, начинающуюся с https://");
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const req = await WithdrawalRequest.findOneAndUpdate(
        { _id: requestId, status: "awaiting_payout_link" },
        {
          $set: {
            status: "approved",
            payoutUrl: normalizedUrl,
            awaitingAdminTelegramId: "",
            resolvedByTelegramId: String(adminTelegramId),
          },
          $push: {
            statusHistory: statusHistoryEntry("approved", adminTelegramId, {
              ...extra,
              note: extra.note || "Выплата завершена",
            }),
          },
        },
        { new: true, session }
      );
      if (!req) throw new Error("Заявка не ожидает ссылку.");
      const user = await User.findOneAndUpdate(
        { _id: req.userId, totalProfit: { $gte: req.amountUsd }, reservedWithdrawalUsd: { $gte: req.amountUsd } },
        { $inc: { totalProfit: -req.amountUsd, reservedWithdrawalUsd: -req.amountUsd } },
        { new: true, session }
      );
      if (!user) throw new Error("Нарушен резерв баланса заявки.");
      result = { request: req, user };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function rejectPayout(requestId, adminTelegramId, extra = {}) {
  const session = await mongoose.startSession();
  try {
    let request;
    await session.withTransaction(async () => {
      request = await WithdrawalRequest.findOneAndUpdate(
        { _id: requestId, status: { $in: ["pending", "awaiting_payout_link"] } },
        {
          $set: { status: "rejected", awaitingAdminTelegramId: "", resolvedByTelegramId: String(adminTelegramId) },
          $push: {
            statusHistory: statusHistoryEntry("rejected", adminTelegramId, {
              ...extra,
              note: extra.note || "Отклонена",
            }),
          },
        },
        { new: true, session }
      );
      if (!request) return;
      const user = await User.findOneAndUpdate(
        { _id: request.userId, reservedWithdrawalUsd: { $gte: request.amountUsd } },
        { $inc: { reservedWithdrawalUsd: -request.amountUsd } },
        { new: true, session }
      );
      if (!user) throw new Error("Нарушен резерв баланса заявки.");
      await request.populate({ path: "userId", options: { session } });
    });
    return request;
  } finally {
    await session.endSession();
  }
}

async function backfillWithdrawalReserves() {
  const rows = await WithdrawalRequest.aggregate([
    { $match: { status: { $in: LOCK_STATUSES } } },
    { $group: { _id: "$userId", total: { $sum: "$amountUsd" } } },
  ]);
  const reserves = new Map(rows.map((row) => [String(row._id), Number(row.total || 0)]));
  const users = await User.find({}).select("_id reservedWithdrawalUsd");
  let updated = 0;
  for (const user of users) {
    const total = reserves.get(String(user._id)) || 0;
    if (Number(user.reservedWithdrawalUsd || 0) !== total) {
      await User.updateOne({ _id: user._id }, { $set: { reservedWithdrawalUsd: total } });
      updated += 1;
    }
  }
  return updated;
}

async function listUserRequests(telegramId, limit = 15, skip = 0) {
  return WithdrawalRequest.find({ telegramId: String(telegramId) })
    .sort({ createdAt: -1 })
    .skip(Math.max(0, Number(skip) || 0))
    .limit(limit)
    .lean();
}

async function countUserRequests(telegramId) {
  return WithdrawalRequest.countDocuments({ telegramId: String(telegramId) });
}

function buildChannelMessageHtml(req) {
  const username = String(req.username || "").replace(/^@/, "").trim();
  const worker = username ? `@${escapeHtml(username)}` : "воркер";
  return [
    `${pe("transfer")} <b>Новая заявка на выплату</b>`,
    "",
    `${pe("profile")} Воркер: ${worker}`,
    `${pe("coins")} Сумма: <b>${formatUsd(req.amountUsd)}</b>`,
    `💳 Метод: <b>${escapeHtml(methodLabel(req.method))}</b>`,
    `${pe("tag")} Заявка: <code>#${payoutShortId(req._id)}</code>`,
    "",
    "<i>Откройте заявку на панели, чтобы посмотреть детали, историю транзакций и источники начислений.</i>",
  ].join("\n");
}

function buildAdminPayoutApprovalHtml(req) {
  const wallet = String(req?.walletAddress || "").trim();
  const breakdown = calcPayoutBreakdown(req?.amountUsd, req?.method);
  return [
    `${pe("success")} <b>Одобрение выплаты</b>`,
    "",
    `Заявка: <code>${req?._id || "—"}</code>`,
    `Пользователь: @${escapeHtml(req?.username || "—")} (<code>${escapeHtml(req?.telegramId || "—")}</code>)`,
    `Сумма: <b>${formatUsd(breakdown.amountUsd)}</b>`,
    `Комиссия сети: <b>${formatUsd(breakdown.networkFee)}</b>`,
    `К выплате: <b>${formatUsd(breakdown.payoutAmount)}</b>`,
    `Метод: <b>${escapeHtml(methodLabel(req?.method))}</b>`,
    wallet
      ? `${isNicknamePayoutMethod(req?.method) ? "Ник" : "Кошелёк"}: <code>${escapeHtml(wallet)}</code>`
      : null,
    "",
    `Пришлите <b>следующим сообщением</b> ссылку на ${payoutLinkLabel(req?.method)} (https://…).`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWithdrawConfirmHtml({ method, address, amountUsd }) {
  const { networkFee, payoutAmount } = calcPayoutBreakdown(amountUsd, method);
  const lines = [
    `${pe("transfer")} <b>Подтверждение вывода</b>`,
    "",
    `${pe("coins")} ${
      isNicknamePayoutMethod(method) || isLinkPayoutMethod(method) ? "Сервис" : "Сеть"
    }: <b>${methodLabel(method)}</b>`,
  ];
  if (isNicknamePayoutMethod(method) && address) {
    lines.push(`${pe("profile")} Ник: <code>${escapeHtml(address)}</code>`);
  } else if (!isLinkPayoutMethod(method) && address) {
    lines.push(`${pe("wallet")} Кошелёк: <code>${escapeHtml(address)}</code>`);
  } else if (isLinkPayoutMethod(method)) {
    lines.push(`${pe("information")} Чек будет отправлен администратором после одобрения заявки.`);
  }
  lines.push(
    `${pe("transfer")} Сумма: <b>${formatUsd(amountUsd)}</b>`,
    `${pe("coins")} Комиссия сети: <b>${formatUsd(networkFee)}</b>`,
    `${pe("receive")} К выплате: <b>${formatUsd(payoutAmount)}</b>`,
    "",
    "Проверьте данные и нажмите <b>Отправить</b>."
  );
  return lines.join("\n");
}

function buildApprovedChannelSuffix() {
  return `\n\n${pe("success")} <b>Выплата одобрена</b> — ссылка отправлена пользователю.`;
}

function buildRejectedChannelSuffix() {
  return `\n\n${pe("error")} <b>Выплата отклонена</b>.`;
}

function normalizePayoutUrl(text) {
  const trimmed = String(text || "").trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch (_) {
    return null;
  }
}

function buildUserPayoutApprovedMessage(req) {
  const { amountUsd, networkFee, payoutAmount } = calcPayoutBreakdown(
    req?.amountUsd,
    req?.method
  );
  const receiptLabel = isLinkPayoutMethod(req?.method) ? "Ваш чек:" : "Транзакция:";
  return [
    `${pe("celebrate")} <b>Поздравляем, вам успешно одобрен вывод!</b>`,
    "",
    `${pe("transfer")} Сумма: <b>${formatUsd(amountUsd)}</b>`,
    `${pe("coins")} Комиссия сети: <b>${formatUsd(networkFee)}</b>`,
    `${pe("receive")} К выплате: <b>${formatUsd(payoutAmount)}</b>`,
    "",
    `${pe("link")} <b>${receiptLabel}</b> ссылка в кнопке ниже.`,
  ].join("\n");
}

function payoutApprovedUserKeyboard(url, method) {
  return Markup.inlineKeyboard([[urlBtn(payoutOpenButtonLabel(method), url, "link")]]);
}

async function notifyApprovedPayout(botOrTelegram, request) {
  const telegram = botOrTelegram?.telegram || botOrTelegram;
  if (!telegram?.sendMessage || !request) return null;
  const url = String(request.payoutUrl || "").trim();
  const sent = await telegram.sendMessage(
    request.telegramId,
    buildUserPayoutApprovedMessage(request),
    {
      parse_mode: "HTML",
      reply_markup: payoutApprovedUserKeyboard(url, request.method).reply_markup,
    }
  );
  try {
    await telegram.pinChatMessage(request.telegramId, sent.message_id, {
      disable_notification: true,
    });
  } catch (_) {
    /* Telegram may forbid pinning in this chat. */
  }
  if (request.channelChatId && request.channelMessageId) {
    await telegram.editMessageText(
      request.channelChatId,
      Number(request.channelMessageId),
      undefined,
      buildChannelMessageHtml(request) + buildApprovedChannelSuffix(),
      { parse_mode: "HTML", reply_markup: payoutModerationKeyboard(String(request._id)).reply_markup }
    );
  }
  return sent;
}

async function notifyRejectedPayout(botOrTelegram, request) {
  const telegram = botOrTelegram?.telegram || botOrTelegram;
  if (!telegram?.sendMessage || !request) return;
  try {
    await telegram.sendMessage(
      request.telegramId,
      `${pe("error")} Ваша заявка на выплату <b>отклонена</b>.`,
      {
        parse_mode: "HTML",
        reply_markup: homeOnlyKeyboard().reply_markup,
      }
    );
  } catch (_) {
    /* User notification is best-effort. */
  }
  if (request.channelChatId && request.channelMessageId) {
    await telegram.editMessageText(
      request.channelChatId,
      Number(request.channelMessageId),
      undefined,
      buildChannelMessageHtml(request) + buildRejectedChannelSuffix(),
      { parse_mode: "HTML", reply_markup: payoutModerationKeyboard(String(request._id)).reply_markup }
    );
  }
}

async function notifyWithdrawalRequestChannel(bot, request) {
  const telegram = bot?.telegram || bot;
  if (!telegram?.sendMessage || !env.payoutRequestsChannelId || !request) {
    return null;
  }
  const text = buildChannelMessageHtml(request);
  const msg = await telegram.sendMessage(env.payoutRequestsChannelId, text, {
    parse_mode: "HTML",
    reply_markup: payoutModerationKeyboard(String(request._id)).reply_markup,
  });
  await attachChannelMeta(request._id, msg.chat.id, msg.message_id);
  return msg;
}

async function addPayoutComment(requestId, text, extra = {}) {
  const note = String(text || "").trim();
  if (note.length < 2) throw new Error("Введите комментарий.");
  if (note.length > 500) throw new Error("Комментарий слишком длинный.");
  const updated = await WithdrawalRequest.findByIdAndUpdate(
    requestId,
    {
      $push: {
        comments: {
          text: note,
          at: new Date(),
          actorTelegramId: String(extra.actorTelegramId || ""),
          actorUsername: String(extra.actorUsername || "").slice(0, 80),
        },
      },
    },
    { new: true }
  );
  if (!updated) throw new Error("Заявка не найдена.");
  return updated;
}

module.exports = {
  METHOD_LABELS,
  LINK_PAYOUT_METHODS,
  isLinkPayoutMethod,
  isNicknamePayoutMethod,
  payoutLinkLabel,
  payoutOpenButtonLabel,
  methodLabel,
  loadWithdrawalFees,
  invalidateWithdrawalFeesCache,
  getNetworkFeeUsd,
  getNetworkFeeUsdAsync,
  getMinWithdrawalUsd,
  calcPayoutBreakdown,
  validateWalletAddress,
  listPayoutRequisites,
  setPayoutRequisites,
  MAX_PAYOUT_REQUISITES,
  sumReservedUsd,
  getAvailableUsd,
  hasPendingRequest,
  createWithdrawalRequest,
  setAwaitingPayoutLink,
  findAwaitingLinkForAdmin,
  completePayoutWithLink,
  rejectPayout,
  backfillWithdrawalReserves,
  listUserRequests,
  countUserRequests,
  buildChannelMessageHtml,
  buildAdminPayoutApprovalHtml,
  buildWithdrawConfirmHtml,
  buildApprovedChannelSuffix,
  buildRejectedChannelSuffix,
  attachChannelMeta,
  normalizePayoutUrl,
  buildUserPayoutApprovedMessage,
  payoutApprovedUserKeyboard,
  notifyApprovedPayout,
  notifyRejectedPayout,
  notifyWithdrawalRequestChannel,
  addPayoutComment,
  resetPendingApproval,
  payoutShortId,
};
