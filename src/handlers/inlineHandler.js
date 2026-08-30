const { isAdminTelegramId, getUserByTelegramId, listCurators, listCallers } = require("../services/userService");
const {
  getPostByCode,
  listSavedPosts,
  buildInlineResult,
} = require("../services/postService");
const {
  listUserProfits,
  groupUserProfits,
} = require("../services/profitService");
const { listUserRequests } = require("../services/withdrawalService");
const { getCurrencyContext, formatDisplayAmount } = require("../services/currencyService");
const {
  buildCuratorCardHtml,
  curatorCardKeyboard,
} = require("../services/curatorService");
const {
  buildCallerCardHtml,
  callerCardKeyboard,
} = require("../services/callerService");
const { pe, btn } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { getProfilePhotoFileId, getProfileThumbnail } = require("../utils/profilePhoto");
const { getBranchInlineThumb, applyInlineThumb } = require("../utils/branchInlineIcons");
const {
  listSteamAccountsForAdmin,
  fetchSteamAccountById,
  buildAdminLogInlinePreviewHtml,
  sendAdminLogCard,
  accountTotalUsd,
  kindLabel,
} = require("../services/steamLogAdminService");
const {
  listUserFeedback,
  getFeedbackById,
  buildUserTicketHtml,
  buildFeedbackInlinePreviewHtml,
  typeLabel,
  statusLabel,
  truncate,
} = require("../services/feedbackService");
const { adminResultKeyboard } = require("../keyboards/admin");
const { feedbackTicketKeyboard } = require("../keyboards/feedback");

const MONTHS_RU = [
  "",
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

function formatDateTime(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} в ${hh}:${mi}`;
}

function formatDateLong(date) {
  return new Date(date).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseInlineQuery(raw) {
  const q = String(raw || "").trim();
  if (!q) return { type: "empty" };

  if (q === "curators" || q === "curator" || q.startsWith("curators")) {
    return { type: "curators", filter: q.replace(/^curators?\s*/i, "").trim() };
  }

  if (
    q === "филиалы" ||
    q === "филиал" ||
    q === "branches" ||
    q === "branch" ||
    q.startsWith("филиалы") ||
    q.startsWith("филиал ") ||
    q.startsWith("branches") ||
    q.startsWith("branch ")
  ) {
    return {
      type: "branches",
      filter: q.replace(/^(филиалы|филиал|branches|branch)\s*/i, "").trim(),
    };
  }

  if (q === "callers" || q === "caller" || q.startsWith("callers") || q.startsWith("прозвон")) {
    return { type: "callers", filter: q.replace(/^(callers?|прозвон\w*)\s*/i, "").trim() };
  }

  if (q === "profits" || q.startsWith("profits?")) {
    const params = new URLSearchParams(q.includes("?") ? q.split("?")[1] : "");
    const groupBy = params.get("group_by");
    if (groupBy === "month" || groupBy === "day") {
      return { type: "profits_group", mode: groupBy };
    }
    return { type: "profits_list" };
  }

  if (q === "wallet" || q === "transactions" || q.startsWith("wallet?")) {
    return { type: "wallet" };
  }

  if (q === "feedback" || q === "fb" || q.startsWith("feedback ") || q.startsWith("fb ")) {
    return {
      type: "feedback",
      filter: q.replace(/^(feedback|fb)\s*/i, "").trim(),
    };
  }

  if (q === "logs" || q === "log" || q.startsWith("logs ") || q.startsWith("log ")) {
    return {
      type: "logs",
      filter: q.replace(/^logs?\s*/i, "").trim(),
    };
  }

  return { type: "postbot", query: q };
}

function articleResult({ id, title, description, messageText }) {
  return {
    type: "article",
    id: String(id).slice(0, 64),
    title,
    description,
    input_message_content: {
      message_text: messageText,
      parse_mode: "HTML",
    },
  };
}

async function buildProfitsListResults(user, currencyCtx) {
  const rows = await listUserProfits(user, 40);
  if (!rows.length) {
    return [
      articleResult({
        id: "profits-empty",
        title: "Профитов пока нет",
        description: "Когда начислят — появятся здесь",
        messageText: "Профитов пока нет.",
      }),
    ];
  }

  return rows.map((row, idx) => {
    const amount = formatDisplayAmount(row.workerShare, currencyCtx);
    const when = formatDateTime(row.createdAt);
    return articleResult({
      id: `profit-${row._id || idx}`,
      title: "Профит",
      description: `${amount} · ${when}`,
      messageText: [
        "<b>Профит</b>",
        `Сумма: ${amount}`,
        `Дата: ${when}`,
      ].join("\n"),
    });
  });
}

async function buildProfitsGroupResults(user, mode, currencyCtx) {
  const rows = await groupUserProfits(user, mode);
  if (!rows.length) {
    return [
      articleResult({
        id: "profits-group-empty",
        title: "Нет данных",
        description: "Профитов за период нет",
        messageText: "Профитов пока нет.",
      }),
    ];
  }

  return rows.map((row, idx) => {
    const amount = formatDisplayAmount(row.total, currencyCtx);
    let title;
    if (mode === "day") {
      title = `${String(row.day).padStart(2, "0")}.${String(row.month).padStart(2, "0")}.${row.year}`;
    } else {
      title = `${MONTHS_RU[row.month] || row.month} ${row.year}`;
    }
    const description = `${row.count} профита — ${amount}`;
    return articleResult({
      id: `pg-${mode}-${row.year}-${row.month}-${row.day || 0}-${idx}`,
      title,
      description,
      messageText: `<b>${title}</b>\n${description}`,
    });
  });
}

async function buildWalletResults(user, currencyCtx) {
  const [profits, withdrawals] = await Promise.all([
    listUserProfits(user, 40),
    listUserRequests(user.telegramId, 40),
  ]);

  const items = [];
  for (const p of profits) {
    items.push({
      kind: "in",
      at: new Date(p.createdAt).getTime(),
      amountUsd: p.workerShare,
      id: `in-${p._id}`,
    });
  }
  for (const w of withdrawals) {
    items.push({
      kind: "out",
      at: new Date(w.createdAt).getTime(),
      amountUsd: w.amountUsd,
      id: `out-${w._id}`,
    });
  }

  items.sort((a, b) => b.at - a.at);

  if (!items.length) {
    return [
      articleResult({
        id: "wallet-empty",
        title: "История пуста",
        description: "Пока нет операций",
        messageText: "История транзакций пуста.",
      }),
    ];
  }

  return items.slice(0, 40).map((item) => {
    const amount = formatDisplayAmount(item.amountUsd, currencyCtx);
    const when = formatDateLong(item.at);
    if (item.kind === "in") {
      return articleResult({
        id: item.id,
        title: "Пополнение",
        description: `Сумма: ${amount}`,
        messageText: [
          "<b>Пополнение</b>",
          `Сумма: ${amount}`,
          `Дата: ${when}`,
        ].join("\n"),
      });
    }
    return articleResult({
      id: item.id,
      title: "Вывод",
      description: `Сумма: ${amount}`,
      messageText: [
        "<b>Вывод</b>",
        `Сумма: ${amount}`,
        `Дата: ${when}`,
      ].join("\n"),
    });
  });
}

async function buildFeedbackResults(telegramId, filter = "") {
  let rows = await listUserFeedback(telegramId, 40);
  const needle = String(filter || "").trim().toLowerCase();
  if (needle) {
    rows = rows.filter((row) => {
      const hay = [
        row.type,
        typeLabel(row.type),
        row.status,
        statusLabel(row.status),
        row.text,
        String(row._id),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  if (!rows.length) {
    return [
      articleResult({
        id: "feedback-empty",
        title: "Обращений пока нет",
        description: "Напишите первое через меню фидбека",
        messageText: "Обращений пока нет.\nОткройте /feedback и нажмите «Написать обращение».",
      }),
    ];
  }

  return rows.map((row, idx) => {
    const id = String(row._id || idx);
    const title = `${typeLabel(row.type)} · ${statusLabel(row.status)}`;
    const description = truncate(row.text, 80);
    return {
      type: "article",
      id: `fb-${id}`.slice(0, 64),
      title,
      description,
      input_message_content: {
        message_text: buildFeedbackInlinePreviewHtml(row),
        parse_mode: "HTML",
      },
      // Маркер для via-замены, если chosen_inline_result опаздывает.
      reply_markup: {
        inline_keyboard: [[{ text: "…", callback_data: `feedback:inline:${id}` }]],
      },
    };
  });
}

/** userId → { type, targetId, at } — для замены via-сообщения на карточку с фото */
const pendingRoleCards = new Map();
const pendingLogCards = new Map();
const pendingFeedbackCards = new Map();
const PENDING_TTL_MS = 20_000;

async function profileTitle(telegram, user) {
  try {
    const chat = await telegram.getChat(Number(user.telegramId));
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
    if (name) return name.slice(0, 64);
  } catch (_) {
    /* ignore */
  }
  if (user.username) return `@${user.username}`.slice(0, 64);
  return `ID ${user.telegramId}`.slice(0, 64);
}

async function buildRoleResults(telegram, {
  filter = "",
  listFn,
  emptyId,
  emptyTitle,
  emptyText,
  idPrefix,
  descriptionPrefix,
  percentKey,
  minProfitsKey,
  buildCardHtml,
  cardKeyboard,
}) {
  let rows = await listFn();
  const needle = String(filter || "").trim().toLowerCase().replace(/^@/, "");
  if (needle) {
    rows = rows.filter((u) => {
      const uname = String(u.username || "").toLowerCase();
      const id = String(u.telegramId || "");
      return uname.includes(needle) || id.includes(needle);
    });
  }

  if (!rows.length) {
    return [
      articleResult({
        id: emptyId,
        title: emptyTitle,
        description: "Список пуст",
        messageText: emptyText,
      }),
    ];
  }

  const results = [];
  for (const row of rows.slice(0, 50)) {
    const title = await profileTitle(telegram, row);
    const thumb = await getProfileThumbnail(telegram, row);
    const percent = Number(row[percentKey]) || 80;
    const minProfits = Math.max(0, Number(row[minProfitsKey]) || 0);
    const item = {
      type: "article",
      id: `${idPrefix}-${row.telegramId}`.slice(0, 64),
      title,
      description: `${descriptionPrefix} · ${percent}% · от ${minProfits} проф.`,
      input_message_content: {
        message_text: buildCardHtml(row),
        parse_mode: "HTML",
      },
      reply_markup: cardKeyboard(row).reply_markup,
    };
    if (thumb?.url) {
      item.thumbnail_url = thumb.url;
      item.thumbnail_width = thumb.width;
      item.thumbnail_height = thumb.height;
    }
    results.push(item);
  }
  return results;
}

function parseRoleCardSelection(ctx) {
  const buttons = (ctx.message?.reply_markup?.inline_keyboard || []).flat();
  for (const btn of buttons) {
    const apply = String(btn.callback_data || "").match(/^curator:apply:(\d+)$/);
    if (apply) return { type: "curator", targetId: apply[1] };
    const branchApply = String(btn.callback_data || "").match(/^br:apply:([a-f0-9]{24})$/i);
    if (branchApply) return { type: "branch", targetId: branchApply[1] };
    const branchCard = String(btn.callback_data || "").match(/^br:card:([a-f0-9]{24})/i);
    if (branchCard) return { type: "branch", targetId: branchCard[1] };
    if (String(btn.callback_data || "") === "br:create") {
      return { type: "branch_create", targetId: "create" };
    }
  }

  const pending = pendingRoleCards.get(String(ctx.from?.id || ""));
  if (pending && Date.now() - pending.at < PENDING_TTL_MS) {
    pendingRoleCards.delete(String(ctx.from.id));
    return { type: pending.type, targetId: pending.targetId };
  }

  for (const btn of buttons) {
    const url = String(btn.url || "");
    const m = url.match(/^https?:\/\/t\.me\/([A-Za-z0-9_]+)/i);
    if (m) return { type: "caller_username", username: m[1] };
  }

  // Фото-карточка без кнопок (нет username у прозвонщицы) — только через pending.
  return null;
}

async function replaceViaRoleCard(ctx) {
  // Только via-сообщения с карточкой куратора/прозвонщицы (текст или фото).
  const hasCardMarkup = (ctx.message?.reply_markup?.inline_keyboard || []).flat().some((btn) => {
    const data = String(btn.callback_data || "");
    const url = String(btn.url || "");
    return data.startsWith("curator:apply:") || data.startsWith("br:apply:") || data.startsWith("br:card:") || data === "br:create" || /^https?:\/\/t\.me\//i.test(url);
  });
  const pending = pendingRoleCards.get(String(ctx.from?.id || ""));
  const hasPending = pending && Date.now() - pending.at < PENDING_TTL_MS;
  if (!hasCardMarkup && !hasPending) return false;

  const selection = parseRoleCardSelection(ctx);
  if (!selection) return false;

  let user = null;
  let html = "";
  let keyboard = null;

  if (selection.type === "curator") {
    user = await getUserByTelegramId(selection.targetId);
    if (!user?.isCurator) return false;
    html = buildCuratorCardHtml(user);
    keyboard = curatorCardKeyboard(user);
  } else if (selection.type === "branch") {
    const {
      getActiveBranchById,
      getBranchStats,
      buildBranchCardHtml,
      branchCardKeyboard,
    } = require("../services/branchService");
    const branch = await getActiveBranchById(selection.targetId);
    if (!branch) return false;
    const owner = await getUserByTelegramId(branch.ownerTelegramId);
    const stats = await getBranchStats(branch, "all");
    const viewer = await getUserByTelegramId(ctx.from.id);
    const isOwner = viewer && String(viewer.telegramId) === String(branch.ownerTelegramId);
    const isMember = viewer && String(viewer.branchId) === String(branch._id);
    html = buildBranchCardHtml(branch, owner, stats, `$${Number(stats.total || 0).toFixed(2)}`);
    keyboard = branchCardKeyboard(branch, { isOwner, isMember });
    user = owner;
  } else if (selection.type === "branch_create") {
    const chatId = ctx.chat?.id;
    const messageId = ctx.message?.message_id;
    if (!chatId || !messageId) return false;
    try {
      await ctx.telegram.deleteMessage(chatId, messageId);
    } catch (_) {
      /* already gone */
    }
    const { startCreateFlow } = require("./branchHandler");
    await startCreateFlow(ctx);
    return true;
  } else if (selection.type === "caller") {
    user = await getUserByTelegramId(selection.targetId);
    if (!user?.isCaller) return false;
    html = buildCallerCardHtml(user);
    keyboard = callerCardKeyboard(user);
  } else if (selection.type === "caller_username") {
    const callers = await listCallers();
    user = callers.find(
      (c) => String(c.username || "").toLowerCase() === selection.username.toLowerCase()
    );
    if (!user) return false;
    html = buildCallerCardHtml(user);
    keyboard = callerCardKeyboard(user);
  } else {
    return false;
  }

  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (!chatId || !messageId) return false;

  try {
    await ctx.telegram.deleteMessage(chatId, messageId);
  } catch (_) {
    /* already gone */
  }

  const photoId = user?.telegramId
    ? await getProfilePhotoFileId(ctx.telegram, user.telegramId)
    : null;
  const extra = {
    parse_mode: "HTML",
    reply_markup: keyboard?.reply_markup,
  };

  let sent;
  if (photoId) {
    sent = await ctx.telegram.sendPhoto(chatId, photoId, {
      ...extra,
      caption: html,
    });
  } else {
    sent = await ctx.telegram.sendMessage(chatId, html, extra);
  }

  if (ctx.session && sent?.message_id) {
    ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
  }
  return true;
}

async function replaceViaFeedbackCard(ctx) {
  const text = String(ctx.message?.text || ctx.message?.caption || "");
  const isPreview = /Загрузка обращения/i.test(text);

  let ticketId = null;
  const pending = pendingFeedbackCards.get(String(ctx.from?.id || ""));
  if (pending && Date.now() - pending.at < PENDING_TTL_MS) {
    ticketId = String(pending.ticketId);
    pendingFeedbackCards.delete(String(ctx.from.id));
  }

  const buttons = (ctx.message?.reply_markup?.inline_keyboard || []).flat();
  for (const button of buttons) {
    const m = String(button.callback_data || "").match(/^feedback:inline:([a-f0-9]{24})$/i);
    if (m) {
      ticketId = m[1];
      break;
    }
  }

  if (!ticketId) return false;
  if (
    !isPreview &&
    !pending &&
    !buttons.some((b) => /^feedback:inline:/.test(String(b.callback_data || "")))
  ) {
    return false;
  }

  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (!chatId || !messageId) return false;

  try {
    await ctx.telegram.deleteMessage(chatId, messageId);
  } catch (_) {
    /* already gone */
  }

  try {
    const ticket = await getFeedbackById(ticketId);
    if (!ticket) {
      await ctx.telegram.sendMessage(
        chatId,
        `${pe("error")} Обращение не найдено.`,
        { parse_mode: "HTML", reply_markup: feedbackTicketKeyboard().reply_markup }
      );
      return true;
    }

    const isOwner = String(ticket.telegramId) === String(ctx.from.id);
    const isAdmin = isAdminTelegramId(ctx.from.id);
    if (!isOwner && !isAdmin) {
      await ctx.telegram.sendMessage(
        chatId,
        `${pe("lock")} Это обращение другого пользователя.`,
        { parse_mode: "HTML" }
      );
      return true;
    }

    const sent = await ctx.telegram.sendMessage(chatId, buildUserTicketHtml(ticket), {
      parse_mode: "HTML",
      reply_markup: feedbackTicketKeyboard().reply_markup,
    });
    if (ctx.session && sent?.message_id) {
      ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
    }
    return true;
  } catch (error) {
    logger.warn("replaceViaFeedbackCard failed", ticketId, error.message);
    await ctx.telegram.sendMessage(
      chatId,
      `${pe("error")} Не удалось загрузить обращение: ${error.message}`,
      { parse_mode: "HTML", reply_markup: feedbackTicketKeyboard().reply_markup }
    );
    return true;
  }
}

async function buildLogsResults(filter = "") {
  try {
    // Если фильтр — чистый ID, пробуем точечный fetch.
    if (/^\d+$/.test(filter)) {
      try {
        const account = await fetchSteamAccountById(filter);
        return [buildLogInlineArticle(account)];
      } catch (_) {
        /* fall through to list */
      }
    }

    const rows = await listSteamAccountsForAdmin({ offset: 0, limit: 30, filter });
    if (!rows.length) {
      return [
        articleResult({
          id: "logs-empty",
          title: "Логи не найдены",
          description: filter ? `Нет совпадений: ${filter}` : "Панель не вернула аккаунты",
          messageText: `${pe("info")} Логи не найдены.`,
        }),
      ];
    }
    return rows.map((row) => buildLogInlineArticle(row));
  } catch (error) {
    logger.warn("inline logs failed", error.message);
    return [
      articleResult({
        id: "logs-error",
        title: "Ошибка панели",
        description: String(error.message || "unknown").slice(0, 64),
        messageText: `${pe("error")} Не удалось загрузить логи: ${error.message}`,
      }),
    ];
  }
}

function buildLogInlineArticle(account) {
  const id = String(account?.id || "");
  const login = account?.username || account?.steamInfo?.nickname || "—";
  const kind = kindLabel(account);
  const total = accountTotalUsd(account);
  return {
    type: "article",
    id: `log-${id}`.slice(0, 64),
    title: `#${id} · ${String(login).slice(0, 40)}`,
    description: `${kind} · $${Number(total).toFixed(2)}`,
    input_message_content: {
      message_text: buildAdminLogInlinePreviewHtml(account),
      parse_mode: "HTML",
    },
    // Маркер для via-замены, если chosen_inline_result опаздывает.
    reply_markup: {
      inline_keyboard: [[{ text: "…", callback_data: `admin:log:inline:${id}` }]],
    },
  };
}

async function replaceViaLogCard(ctx) {
  if (!isAdminTelegramId(ctx.from?.id)) return false;

  const text = String(ctx.message?.text || ctx.message?.caption || "");
  const isPreview =
    /Загрузка полной карточки/i.test(text) || /Лог\s*#\d+/i.test(text);

  let logId = null;
  const pending = pendingLogCards.get(String(ctx.from?.id || ""));
  if (pending && Date.now() - pending.at < PENDING_TTL_MS) {
    logId = String(pending.logId);
    pendingLogCards.delete(String(ctx.from.id));
  }

  if (!logId) {
    const fromText = text.match(/Лог\s*#(\d+)/i);
    if (fromText) logId = fromText[1];
  }

  const buttons = (ctx.message?.reply_markup?.inline_keyboard || []).flat();
  for (const button of buttons) {
    const m = String(button.callback_data || "").match(/^admin:log:inline:(\d+)$/);
    if (m) {
      logId = m[1];
      break;
    }
  }

  // Нужен ID и признак, что это наша inline-превьюшка (или был pending).
  if (!logId) return false;
  if (!isPreview && !pending && !buttons.some((b) => /^admin:log:inline:/.test(String(b.callback_data || "")))) {
    return false;
  }

  const chatId = ctx.chat?.id;
  const messageId = ctx.message?.message_id;
  if (!chatId || !messageId) return false;

  try {
    await ctx.telegram.deleteMessage(chatId, messageId);
  } catch (_) {
    /* already gone */
  }

  try {
    const account = await fetchSteamAccountById(logId);
    const sent = await sendAdminLogCard(ctx.telegram, chatId, account);
    if (ctx.session && sent?.message_id) {
      ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
    }
    return true;
  } catch (error) {
    logger.warn("replaceViaLogCard failed", logId, error.message);
    await ctx.telegram.sendMessage(
      chatId,
      `${pe("error")} Не удалось загрузить лог #${logId}: ${error.message}`,
      {
        parse_mode: "HTML",
        reply_markup: adminResultKeyboard("admin:logs").reply_markup,
      }
    );
    return true;
  }
}

async function buildCuratorsResults(telegram, filter = "") {
  return buildRoleResults(telegram, {
    filter,
    listFn: listCurators,
    emptyId: "curators-empty",
    emptyTitle: "Кураторов пока нет",
    emptyText: `${pe("info")} Кураторов пока нет. Загляни позже.`,
    idPrefix: "curator",
    descriptionPrefix: "Куратор",
    percentKey: "curatorPercent",
    minProfitsKey: "curatorMinProfits",
    buildCardHtml: buildCuratorCardHtml,
    cardKeyboard: curatorCardKeyboard,
  });
}

async function buildCallersResults(telegram, filter = "") {
  return buildRoleResults(telegram, {
    filter,
    listFn: listCallers,
    emptyId: "callers-empty",
    emptyTitle: "Прозвонщиц пока нет",
    emptyText: `${pe("info")} Прозвонщиц пока нет. Загляни позже.`,
    idPrefix: "caller",
    descriptionPrefix: "Прозвонщица",
    percentKey: "callerPercent",
    minProfitsKey: "callerMinProfits",
    buildCardHtml: buildCallerCardHtml,
    cardKeyboard: callerCardKeyboard,
  });
}

async function buildBranchesResults(telegram, filter = "", from = null) {
  const {
    listActiveBranches,
    getBranchStats,
    getOwnedBranch,
    buildBranchCardHtml,
    branchCardKeyboard,
    clampBranchPercent,
    BRANCH_CREATE_MIN_PROFITS_USD,
  } = require("../services/branchService");
  const { getUserByTelegramId: getUser } = require("../services/userService");
  const { Markup } = require("telegraf");
  const viewer = from?.id ? await getUser(String(from.id)) : null;
  const owned = viewer ? await getOwnedBranch(viewer.telegramId) : null;
  const results = [];
  const createThumb = await getBranchInlineThumb("create");
  const branchThumb = await getBranchInlineThumb("branch");

  if (!owned && viewer && !viewer.branchId) {
    const createItem = {
      type: "article",
      id: "branch-create",
      title: "Создать филиал",
      description: `Статистика от $${BRANCH_CREATE_MIN_PROFITS_USD} · бесплатно`,
      input_message_content: {
        message_text: `${pe("success")} Создать филиал`,
        parse_mode: "HTML",
      },
      reply_markup: Markup.inlineKeyboard([
        [btn("Создать филиал", "br:create", "success")],
      ]).reply_markup,
    };
    applyInlineThumb(createItem, createThumb);
    results.push(createItem);
  }

  let rows = await listActiveBranches();
  const needle = String(filter || "").trim().toLowerCase();
  if (needle) {
    rows = rows.filter((b) => String(b.name || "").toLowerCase().includes(needle));
  }

  if (!rows.length && !results.length) {
    return [
      articleResult({
        id: "branches-empty",
        title: "Филиалов пока нет",
        description: "Список пуст",
        messageText: `${pe("info")} Филиалов пока нет. Создай первый.`,
      }),
    ];
  }

  for (const branch of rows.slice(0, 40)) {
    const owner = await getUser(branch.ownerTelegramId);
    const stats = await getBranchStats(branch, "all");
    const isOwner = viewer && String(viewer.telegramId) === String(branch.ownerTelegramId);
    const isMember = viewer && String(viewer.branchId) === String(branch._id);
    const ownerThumb = owner ? await getProfileThumbnail(telegram, owner) : null;
    const item = {
      type: "article",
      id: `branch-${branch._id}`.slice(0, 64),
      title: String(branch.name || "Филиал").slice(0, 64),
      description: `${clampBranchPercent(branch.percent)}% · ${stats.members} уч. · касса $${Number(stats.total || 0).toFixed(0)}`,
      input_message_content: {
        message_text: buildBranchCardHtml(branch, owner, stats, `$${Number(stats.total || 0).toFixed(2)}`),
        parse_mode: "HTML",
      },
      reply_markup: branchCardKeyboard(branch, { isOwner, isMember }).reply_markup,
    };
    applyInlineThumb(item, ownerThumb || branchThumb);
    results.push(item);
  }

  return results.slice(0, 50);
}

async function handlePostbotInline(ctx, query) {
  if (!isAdminTelegramId(ctx.from.id)) {
    await ctx.answerInlineQuery([], { cache_time: 1, is_personal: true });
    return;
  }

  let results = [];
  if (query) {
    const post = await getPostByCode(query);
    if (post) {
      const item = buildInlineResult(post);
      if (item) results = [item];
    } else {
      const posts = await listSavedPosts(20, 0);
      const filtered = posts.filter(
        (p) =>
          p.code.includes(query) ||
          String(p.name || "").toLowerCase().includes(query.toLowerCase())
      );
      results = filtered.map((p) => buildInlineResult(p)).filter(Boolean).slice(0, 20);
    }
  } else {
    const posts = await listSavedPosts(20, 0);
    results = posts.map((p) => buildInlineResult(p)).filter(Boolean);
  }

  await ctx.answerInlineQuery(results, { cache_time: 5, is_personal: true });
}

function registerInlineHandlers(bot) {
  bot.on("chosen_inline_result", async (ctx) => {
    const resultId = String(ctx.chosenInlineResult?.result_id || "");
    const roleMatch = /^(curator|caller)-(\d+)$/.exec(resultId);
    if (roleMatch) {
      pendingRoleCards.set(String(ctx.from.id), {
        type: roleMatch[1],
        targetId: roleMatch[2],
        at: Date.now(),
      });
      return;
    }

    const branchCreateMatch = resultId === "branch-create";
    if (branchCreateMatch) {
      pendingRoleCards.set(String(ctx.from.id), {
        type: "branch_create",
        targetId: "create",
        at: Date.now(),
      });
      return;
    }

    const branchMatch = /^branch-([a-f0-9]{24})$/i.exec(resultId);
    if (branchMatch) {
      pendingRoleCards.set(String(ctx.from.id), {
        type: "branch",
        targetId: branchMatch[1],
        at: Date.now(),
      });
      return;
    }

    const logMatch = /^log-(\d+)$/.exec(resultId);
    if (logMatch && isAdminTelegramId(ctx.from.id)) {
      pendingLogCards.set(String(ctx.from.id), {
        logId: logMatch[1],
        at: Date.now(),
      });
      return;
    }

    const feedbackMatch = /^fb-([a-f0-9]{24})$/i.exec(resultId);
    if (feedbackMatch) {
      pendingFeedbackCards.set(String(ctx.from.id), {
        ticketId: feedbackMatch[1],
        at: Date.now(),
      });
    }
  });

  bot.on("message", async (ctx, next) => {
    const via = ctx.message?.via_bot;
    if (!via || Number(via.id) !== Number(ctx.botInfo?.id)) {
      return next();
    }

    try {
      const replacedFeedback = await replaceViaFeedbackCard(ctx);
      if (replacedFeedback) return;

      if (isAdminTelegramId(ctx.from?.id)) {
        const replacedLog = await replaceViaLogCard(ctx);
        if (replacedLog) return;
      }
      const replaced = await replaceViaRoleCard(ctx);
      if (replaced) return;
    } catch (error) {
      logger.error("Failed to replace inline card", error);
    }
    return next();
  });

  bot.on("inline_query", async (ctx) => {
    try {
      const parsed = parseInlineQuery(ctx.inlineQuery.query);

      if (parsed.type === "logs") {
        if (!isAdminTelegramId(ctx.from.id)) {
          await ctx.answerInlineQuery([], { cache_time: 1, is_personal: true });
          return;
        }
        const results = await buildLogsResults(parsed.filter);
        await ctx.answerInlineQuery(results, { cache_time: 1, is_personal: true });
        return;
      }

      if (parsed.type === "branches") {
        const results = await buildBranchesResults(ctx.telegram, parsed.filter, ctx.from);
        await ctx.answerInlineQuery(results, { cache_time: 1, is_personal: true });
        return;
      }

      if (parsed.type === "curators") {
        const results = await buildCuratorsResults(ctx.telegram, parsed.filter);
        await ctx.answerInlineQuery(results, { cache_time: 1, is_personal: false });
        return;
      }

      if (parsed.type === "callers") {
        const results = await buildCallersResults(ctx.telegram, parsed.filter);
        await ctx.answerInlineQuery(results, { cache_time: 1, is_personal: false });
        return;
      }

      if (parsed.type === "profits_list" || parsed.type === "profits_group" || parsed.type === "wallet") {
        const user = await getUserByTelegramId(ctx.from.id);
        const allowed =
          user &&
          (user.isTeamMember || user.role === "admin" || isAdminTelegramId(ctx.from.id));
        if (!allowed) {
          await ctx.answerInlineQuery([], { cache_time: 1, is_personal: true });
          return;
        }

        const currencyCtx = await getCurrencyContext();
        let results = [];

        if (parsed.type === "profits_list") {
          results = await buildProfitsListResults(user, currencyCtx);
        } else if (parsed.type === "profits_group") {
          results = await buildProfitsGroupResults(user, parsed.mode, currencyCtx);
        } else {
          results = await buildWalletResults(user, currencyCtx);
        }

        await ctx.answerInlineQuery(results, { cache_time: 2, is_personal: true });
        return;
      }

      if (parsed.type === "feedback") {
        const results = await buildFeedbackResults(ctx.from.id, parsed.filter);
        await ctx.answerInlineQuery(results, { cache_time: 2, is_personal: true });
        return;
      }

      if (parsed.type === "empty") {
        if (isAdminTelegramId(ctx.from.id)) {
          await handlePostbotInline(ctx, "");
          return;
        }
        await ctx.answerInlineQuery([], { cache_time: 1, is_personal: true });
        return;
      }

      await handlePostbotInline(ctx, parsed.query || "");
    } catch (error) {
      logger.error("Inline query failed", error);
      try {
        await ctx.answerInlineQuery([], { cache_time: 1, is_personal: true });
      } catch (_) {
        /* ignore */
      }
    }
  });
}

module.exports = { registerInlineHandlers };
