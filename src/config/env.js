const dotenv = require("dotenv");

dotenv.config();

// ── helpers ──────────────────────────────────────────────────────────────────

function csvList(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function csvHostSet(value, fallback = "") {
  return new Set(
    csvList(value || fallback).map((v) =>
      v
        .toLowerCase()
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/+$/, "")
    )
  );
}

function boolFlag(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function num(value, fallback) {
  return Number(value ?? fallback);
}

function str(value, fallback = "") {
  return String(value ?? fallback);
}

function trimUrl(value) {
  return str(value).replace(/\/$/, "");
}

// ── env ──────────────────────────────────────────────────────────────────────

const env = {
  // ── Core / Telegram bot ────────────────────────────────────────────────────
  botToken: process.env.BOT_TOKEN,
  botUsername: str(process.env.BOT_USERNAME).replace(/^@/, ""),
  adminIds: csvList(process.env.ADMIN_IDS),
  mongoUri: process.env.MONGO_URI,
  /** Меню бота: dark | light — PNG в assets/brand/ */
  menuBannerTheme: (() => {
    const v = str(process.env.MENU_BANNER_THEME, "light").toLowerCase();
    return v === "dark" ? "dark" : "light";
  })(),

  // ── Telegram channels & chats ──────────────────────────────────────────────
  applicationsChannelId:
    process.env.APPLICATIONS_CHANNEL_ID || "-5246061488",
  feedbackChannelId: process.env.FEEDBACK_CHANNEL_ID || "",
  payoutRequestsChannelId:
    process.env.PAYOUT_REQUESTS_CHANNEL_ID || "-1003840719737",

  aboutPayoutsChatId:
    process.env.ABOUT_PAYOUTS_CHAT_ID || "-1003821514718",
  aboutWorkersChatId:
    process.env.ABOUT_WORKERS_CHAT_ID || "-1003710871843",
  aboutManualsChatId:
    process.env.ABOUT_MANUALS_CHAT_ID || "-1003731342806",
  aboutInfoChatId: process.env.ABOUT_INFO_CHAT_ID || "-1003600501278",

  /** Канал анонсов / info (первый пост о боте). */
  launchAnnounceChatId:
    process.env.LAUNCH_ANNOUNCE_CHAT_ID ||
    process.env.ABOUT_INFO_CHAT_ID ||
    "-1003600501278",

  /** Числовой ID канала changelogs для публикации ботом. */
  changelogsChatId: process.env.CHANGELOGS_CHAT_ID || "",

  steamProfitChannelId:
    process.env.STEAM_PROFIT_CHANNEL_ID ||
    process.env.STEAM_MANUAL_PROFIT_CHANNEL_ID ||
    process.env.ABOUT_PAYOUTS_CHAT_ID ||
    "-1003821514718",
  /** Ручная отправка карточек из Dashboard. */
  steamManualProfitChannelId:
    process.env.STEAM_MANUAL_PROFIT_CHANNEL_ID || "-1003821514718",
  steamManualTeamChatId:
    process.env.STEAM_MANUAL_TEAM_CHAT_ID || "-1003710871843",
  steamLogSaleChannelId:
    process.env.STEAM_LOG_SALE_CHANNEL_ID || "-1004440736532",
  /** Канал администрации: все пикчи логов / MaFile. */
  steamAdminLogsChannelId:
    process.env.STEAM_ADMIN_LOGS_CHANNEL_ID ||
    process.env.STEAM_LOG_SALE_CHANNEL_ID ||
    "-1004440736532",
  /** Простой текстовый лог событий по логам (новый / валид / автопродажа). */
  steamActivityLogChannelId:
    process.env.STEAM_ACTIVITY_LOG_CHANNEL_ID || "-1004431234688",

  // ── Dynamic pin ────────────────────────────────────────────────────────────
  /** Чат динамического закрепа (по умолчанию чат воркеров). */
  dynamicPinChatId:
    process.env.DYNAMIC_PIN_CHAT_ID ||
    process.env.ABOUT_WORKERS_CHAT_ID ||
    "",
  /** Интервал обновления закрепа, мс (мин. 60с). */
  dynamicPinIntervalMs: num(process.env.DYNAMIC_PIN_INTERVAL_MS, 300000),

  /** Ежедневный дайджест поступлений логов/MaFile в личку админа. */
  dailyArrivalDigestTelegramId: str(process.env.DAILY_ARRIVAL_DIGEST_TELEGRAM_ID, "8647494349"),
  dailyArrivalDigestHourMsk: num(process.env.DAILY_ARRIVAL_DIGEST_HOUR_MSK, 23),
  dailyArrivalDigestMinuteMsk: num(process.env.DAILY_ARRIVAL_DIGEST_MINUTE_MSK, 59),

  // ── Public links / URLs ────────────────────────────────────────────────────
  aboutInfoChannelUrl:
    process.env.ABOUT_INFO_CHANNEL_URL || "https://t.me/garbonainfo",
  aboutDiscordUrl:
    process.env.ABOUT_DISCORD_URL || "https://discord.gg/VNQfrk5Wn5",

  // ── Discord bot ────────────────────────────────────────────────────────────
  discordBotToken: str(process.env.DISCORD_BOT_TOKEN || process.env.TOKEN_DISCORD).trim(),
  discordGuildId: str(
    process.env.DISCORD_GUILD_ID || "1094270557081579552"
  ).trim(),
  discordUnverifiedRoleId: str(
    process.env.DISCORD_UNVERIFIED_ROLE_ID || "1094271461528715496"
  ).trim(),
  discordVerifiedRoleId: str(
    process.env.DISCORD_VERIFIED_ROLE_ID || "1540851475910234143"
  ).trim(),
  discordEmbedRoleId: str(process.env.DISCORD_EMBED_ROLE_ID || "1094277292169109514").trim(),
  discordLogChannelId: str(process.env.DISCORD_LOG_CHANNEL_ID).trim(),
  /** Ban / kick / mute moderation logs (admin category). */
  discordModLogChannelId: str(process.env.DISCORD_MOD_LOG_CHANNEL_ID).trim(),
  /** Bot system / error logs channel. */
  discordSystemLogChannelId: str(process.env.DISCORD_SYSTEM_LOG_CHANNEL_ID).trim(),
  discordRulesUrl: str(process.env.DISCORD_RULES_URL).trim(),
  /** Voice channel users join to create a private room */
  discordVoiceCreateChannelId: str(process.env.DISCORD_VOICE_CREATE_CHANNEL_ID).trim(),
  /** Category for temporary private voice rooms */
  discordVoiceCategoryId: str(process.env.DISCORD_VOICE_CATEGORY_ID).trim(),
  /** Channel for live system status embed */
  discordStatusChannelId: str(
    process.env.DISCORD_STATUS_CHANNEL_ID || "1541568999551279184"
  ).trim(),
  /** Status embed refresh interval, ms (min 30s). */
  discordStatusIntervalMs: num(process.env.DISCORD_STATUS_INTERVAL_MS, 60000),
  /** Channel for Steam log / MaFile arrival cards */
  discordSteamLogsChannelId: str(
    process.env.DISCORD_STEAM_LOGS_CHANNEL_ID || "1541569005058261173"
  ).trim(),
  /** Support panel channel (#поддержка) */
  discordSupportChannelId: str(
    process.env.DISCORD_SUPPORT_CHANNEL_ID || "1541569011396120679"
  ).trim(),
  /** Suggestions forum (#предложения) */
  discordSuggestionsChannelId: str(
    process.env.DISCORD_SUGGESTIONS_CHANNEL_ID || "1541569013296136295"
  ).trim(),
  /** Optional custom emoji id for support select icons */
  discordSupportEmojiId: str(process.env.DISCORD_SUPPORT_EMOJI_ID || "").trim(),
  /** Moderator role (slash mod commands) */
  discordModRoleId: str(
    process.env.DISCORD_MOD_ROLE_ID || "1541572769119076392"
  ).trim(),
  /** Fame / Friend role (slash mod commands) */
  discordFameRoleId: str(
    process.env.DISCORD_FAME_ROLE_ID || "1541573044084936845"
  ).trim(),
  /** Ban restriction role (sees only appeal channel) */
  discordBanRoleId: str(
    process.env.DISCORD_BAN_ROLE_ID || "1541901827958775808"
  ).trim(),
  /** Optional mute role alongside Discord timeout */
  discordMuteRoleId: str(process.env.DISCORD_MUTE_ROLE_ID || "").trim(),
  /** Appeal channel for banned users */
  discordAppealChannelId: str(
    process.env.DISCORD_APPEAL_CHANNEL_ID || "1541901851715174450"
  ).trim(),
  /** Profit milestone roles (lifetime worker share) */
  discordProfitRoleCopperId: str(
    process.env.DISCORD_PROFIT_ROLE_COPPER_ID || "1541905985411481660"
  ).trim(),
  discordProfitRoleSilverId: str(
    process.env.DISCORD_PROFIT_ROLE_SILVER_ID || "1541905986279837766"
  ).trim(),
  discordProfitRoleGoldId: str(
    process.env.DISCORD_PROFIT_ROLE_GOLD_ID || "1541905987290529854"
  ).trim(),
  discordProfitTierCopperUsd: num(process.env.DISCORD_PROFIT_TIER_COPPER_USD, 100),
  discordProfitTierSilverUsd: num(process.env.DISCORD_PROFIT_TIER_SILVER_USD, 500),
  discordProfitTierGoldUsd: num(process.env.DISCORD_PROFIT_TIER_GOLD_USD, 2500),
  discordSetNickname:
    process.env.DISCORD_SET_NICKNAME == null ||
    String(process.env.DISCORD_SET_NICKNAME).trim() === ""
      ? true
      : boolFlag(process.env.DISCORD_SET_NICKNAME),
  supportUrl:
    process.env.SUPPORT_URL ||
    process.env.ABOUT_INFO_CHANNEL_URL ||
    "https://t.me/garbonainfo",
  /** Канонический публичный адрес документации. */
  manualsDocsUrl:
    process.env.MANUALS_DOCS_URL || "https://docs.garbona.cc/docs/#overview",
  /** Канал changelogs (invite / public). */
  changelogsUrl:
    process.env.CHANGELOGS_URL || "https://t.me/+-wlbGOWzsWo1YmIy",

  // ── Wallet / withdrawals ──────────────────────────────────────────────────
  /** Минимальная сумма заявки на вывод, USD. */
  walletMinWithdrawalUsd: num(process.env.WALLET_MIN_WITHDRAWAL_USD, 1),
  /** Комиссия сети при выводе (USD), вычитается из суммы заявки. */
  withdrawFeeUsdtTrc20: num(process.env.WITHDRAW_FEE_USDT_TRC20, 7),
  withdrawFeeUsdtBep20: num(process.env.WITHDRAW_FEE_USDT_BEP20, 1),
  withdrawFeeTonGram: num(process.env.WITHDRAW_FEE_TON_GRAM, 0.1),
  withdrawFeeSolana: num(process.env.WITHDRAW_FEE_SOLANA, 0),

  // ── uProject API ───────────────────────────────────────────────────────────
  uprojectApiBase:
    process.env.UPROJECT_API_BASE || "https://api.uproject.io",
  uprojectApiUrl:
    process.env.UPROJECT_API_URL ||
    "https://api.uproject.io/teams/workers/create",
  uprojectApiKey: process.env.UPROJECT_API_KEY || "",
  // ── Steam API endpoints ────────────────────────────────────────────────────
  steamInfoUrl:
    process.env.STEAM_INFO_URL || "https://api.uproject.io/steam/info",
  steamTasksUrl:
    process.env.STEAM_TASKS_URL || "https://api.uproject.io/steam/tasks",
  steamTaskByIdUrl:
    process.env.STEAM_TASK_BY_ID_URL || "https://api.uproject.io/steam/tasks",
  steamInventoryUrl:
    process.env.STEAM_INVENTORY_URL ||
    "https://api.uproject.io/steam/inventory",

  // ── Steam monitor / share ──────────────────────────────────────────────────
  steamPollIntervalMs: num(process.env.STEAM_POLL_INTERVAL_MS, 30000),
  /** MaFile ниже порога ($) → MaFileToLog + автопродажа. */
  mafileAutoConvertMaxUsd: num(process.env.MAFILE_AUTO_CONVERT_MAX_USD, 15),
  /** Delay between per-worker Steam polls when team API key poll is unavailable. */
  steamPollUserDelayMs: num(process.env.STEAM_POLL_USER_DELAY_MS, 400),
  steamTaskMaxWaitMs: num(process.env.STEAM_TASK_MAX_WAIT_MS, 120000),
  steamTaskPollIntervalMs: num(process.env.STEAM_TASK_POLL_INTERVAL_MS, 3000),
  steamWorkerPercent: num(process.env.STEAM_WORKER_PERCENT, 70),

  // ── LZT Market (status / hold checks only; listing via UProject SellLZT) ───
  lztMarketToken: str(process.env.LZT_MARKET_TOKEN).trim(),
  lztMarketApiBase: trimUrl(
    process.env.LZT_MARKET_API_BASE || "https://prod-api.lzt.market"
  ),
  autoLogSalePollMs: num(process.env.AUTO_LOG_SALE_POLL_MS, 60000),

  // ── Referrals / sites ──────────────────────────────────────────────────────
  referralTemplateId: num(process.env.REFERRAL_TEMPLATE_ID, 8697),
  /**
   * Командные домены, где path рефералки = {customId}token=XXXXXXXX
   * (напр. steemcomnunity.com → ABC12token=QKJXEAYY).
   */
  referralIdvTokenDomains: csvHostSet(
    process.env.REFERRAL_IDV_TOKEN_DOMAINS,
    "steemcommumity.com"
  ),
  /** Вставка между customId и случайной частью (по умолчанию token=). */
  referralIdvTokenPrefix: str(process.env.REFERRAL_IDV_TOKEN_PREFIX, "token="),
  referralIdvTokenLength: num(process.env.REFERRAL_IDV_TOKEN_LENGTH, 16),

  // ── Web panel ──────────────────────────────────────────────────────────────
  /** PORT / PANEL_PORT — админка `/` + воркер `/app` на одном хосте. */
  panelPort: num(process.env.PANEL_PORT || process.env.PORT, 3000),
  panelCookieSecret: str(process.env.PANEL_COOKIE_SECRET).trim(),
  /** Master key for encrypting external panel credentials in MongoDB. */
  panelCredentialsKey: str(process.env.PANEL_CREDENTIALS_KEY).trim(),
  /** Optional one-time initial admin. Never use a default credential. */
  panelBootstrapAdminUsername: str(process.env.PANEL_BOOTSTRAP_ADMIN_USERNAME).trim(),
  panelBootstrapAdminPassword: str(process.env.PANEL_BOOTSTRAP_ADMIN_PASSWORD),
  panelPublicUrl: trimUrl(process.env.PANEL_PUBLIC_URL),
  adminPanelUrl: trimUrl(
    process.env.ADMIN_PANEL_URL || "https://admin.garbona.cc"
  ),
  /** Temporary: skip Telegram Login / session checks for local panel access. */
  panelAuthDisabled: boolFlag(process.env.PANEL_AUTH_DISABLED),
  /** When auth is disabled, impersonate this worker (falls back to first ADMIN_IDS). */
  panelDevTelegramId: str(process.env.PANEL_DEV_TELEGRAM_ID).trim(),

  // ── Treasury / автоматические on-chain выплаты ─────────────────────────────
  /** Мастер-выключатель фичи. Пока false — код не трогает казну, поведение как сегодня. */
  treasuryPayoutEnabled: boolFlag(process.env.TREASURY_PAYOUT_ENABLED),
  /** true по умолчанию: считает и логирует, но не шлёт реальные транзакции. */
  treasuryPayoutDryRun:
    process.env.TREASURY_PAYOUT_DRY_RUN == null
      ? true
      : boolFlag(process.env.TREASURY_PAYOUT_DRY_RUN),

  /** Мастер-казна (пул перед распределением по персональным кошелькам воркеров). */
  treasuryTronPrivateKey: str(process.env.TREASURY_TRON_PRIVATE_KEY).trim(),
  treasuryTronFullHost: trimUrl(process.env.TREASURY_TRON_FULL_HOST || "https://api.trongrid.io"),
  treasuryTronApiKey: str(process.env.TREASURY_TRON_API_KEY).trim(),
  treasuryTronUsdtContract: str(
    process.env.TREASURY_TRON_USDT_CONTRACT,
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
  ),

  treasuryBscPrivateKey: str(process.env.TREASURY_BSC_PRIVATE_KEY).trim(),
  treasuryBscRpcUrl: trimUrl(process.env.TREASURY_BSC_RPC_URL || "https://bsc-dataseed.binance.org"),
  treasuryBscUsdtContract: str(
    process.env.TREASURY_BSC_USDT_CONTRACT,
    "0x55d398326f99059fF775485246999027B3197955"
  ),

  treasuryTonMnemonic: str(process.env.TREASURY_TON_MNEMONIC).trim(),
  treasuryTonApiEndpoint: trimUrl(
    process.env.TREASURY_TON_API_ENDPOINT || "https://toncenter.com/api/v2/jsonRPC"
  ),
  treasuryTonApiKey: str(process.env.TREASURY_TON_API_KEY).trim(),

  /** Отдельная мнемоника — сид для HD-деривации персональных кошельков воркеров
   *  (не мастер-казна выше; компрометация одной не должна раскрывать другую). */
  treasuryMasterMnemonic: str(process.env.TREASURY_MASTER_MNEMONIC).trim(),

  /** Живой курс USD→TON (у TON нет привязки 1:1 к доллару). */
  usdTonPriceApiUrl: str(
    process.env.USD_TON_PRICE_API_URL,
    "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd"
  ),
  usdTonPriceCacheMs: num(process.env.USD_TON_PRICE_CACHE_MS, 300000),

  /** Кому слать алерт при неудачной авто-выплате (fallback — ADMIN_IDS). */
  treasuryPayoutAlertTelegramIds: csvList(process.env.TREASURY_PAYOUT_ALERT_TELEGRAM_IDS),
};

function validateEnv() {
  const required = ["botToken", "mongoUri", "uprojectApiKey"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  if (!env.panelCookieSecret || env.panelCookieSecret.length < 32) {
    throw new Error(
      "PANEL_COOKIE_SECRET must be set to a random string of at least 32 characters (do not reuse BOT_TOKEN)"
    );
  }

  if (!env.panelCredentialsKey || env.panelCredentialsKey.length < 32) {
    throw new Error("PANEL_CREDENTIALS_KEY must be a random string of at least 32 characters");
  }

  if (env.panelAuthDisabled) {
    const publicUrl = String(env.panelPublicUrl || "");
    const looksPublic =
      publicUrl.startsWith("https://") ||
      /bothost\.tech|garbona\./i.test(publicUrl) ||
      process.env.NODE_ENV === "production";
    if (looksPublic) {
      throw new Error(
        "PANEL_AUTH_DISABLED cannot be enabled on a public/production panel URL"
      );
    }
  }

  if (env.treasuryPayoutEnabled) {
    const missingTreasury = [];
    if (!env.treasuryTronPrivateKey) missingTreasury.push("TREASURY_TRON_PRIVATE_KEY");
    if (!env.treasuryBscPrivateKey) missingTreasury.push("TREASURY_BSC_PRIVATE_KEY");
    if (!env.treasuryTonMnemonic) missingTreasury.push("TREASURY_TON_MNEMONIC");
    if (!env.treasuryMasterMnemonic) missingTreasury.push("TREASURY_MASTER_MNEMONIC");
    if (missingTreasury.length) {
      throw new Error(
        `TREASURY_PAYOUT_ENABLED=true, но не заданы: ${missingTreasury.join(", ")}`
      );
    }
  }
}

module.exports = { env, validateEnv };
