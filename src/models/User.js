const mongoose = require("mongoose");
const { encryptSecret, decryptSecret } = require("../utils/secretBox");

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true, unique: true, index: true },
    username: { type: String, default: "" },
    firstName: { type: String, default: "" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isTeamMember: { type: Boolean, default: false },
    isCurator: { type: Boolean, default: false, index: true },
    curatorDescription: { type: String, default: "" },
    curatorPercent: { type: Number, default: 80, min: 1, max: 100 },
    curatorMinProfits: { type: Number, default: 0, min: 0 },
    /** Telegram ID куратора, к которому привязан воркер */
    curatorTelegramId: { type: String, default: "", index: true },
    /** ID филиала (Branch._id), в котором состоит воркер */
    branchId: { type: String, default: "", index: true },
    branchJoinedAt: { type: Date, default: null },
    /** Админ выдал право создать филиал без оплаты $100 */
    canCreateBranch: { type: Boolean, default: false, index: true },
    isCaller: { type: Boolean, default: false, index: true },
    callerDescription: { type: String, default: "" },
    callerPercent: { type: Number, default: 80, min: 1, max: 100 },
    callerMinProfits: { type: Number, default: 0, min: 0 },
    /** Telegram ID прозвонщицы, к которой привязан воркер */
    callerTelegramId: { type: String, default: "", index: true },
    isBanned: { type: Boolean, default: false },
    isModerator: { type: Boolean, default: false, index: true },
    warns: [
      {
        reason: { type: String, default: "" },
        adminId: { type: String, default: "" },
        adminName: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    profitPercent: { type: Number, default: 70, min: 1, max: 100 },
    totalProfit: { type: Number, default: 0, min: 0 },
    /** Funds locked by active withdrawal requests; maintained transactionally. */
    reservedWithdrawalUsd: { type: Number, default: 0, min: 0 },
    /** Funds from auto LZT sales still under marketplace hold/guarantee. */
    frozenSaleUsd: { type: Number, default: 0, min: 0 },
    /** Auto-list valid logs on LZT via UProject SellLZT. */
    autoSellLogs: { type: Boolean, default: true },
    bio: { type: String, default: "" },
    isAnonymous: { type: Boolean, default: false },
    /** Публичный FAKE-TAG в профитах при скрытом нике (до 6 символов, a-z0-9). */
    fakeProfitTag: { type: String, default: "", maxlength: 6 },
    /** Custom avatar for Garbona panel (public URL). */
    avatarUrl: { type: String, default: "" },
    panelUsername: { type: String, default: "" },
    // Stored encrypted at rest; Mongoose getter keeps existing callers from handling ciphertext.
    panelPassword: {
      type: String,
      default: "",
      set: encryptSecret,
      get: decryptSecret,
    },
    /** Хеш пароля входа в веб-панель Garbona (salt:hash, scrypt). */
    appPasswordHash: { type: String, default: "" },
    /** TOTP-секрет 2FA; наличие секрета включает второй шаг входа. */
    appTotpSecret: {
      type: String,
      default: "",
      set: encryptSecret,
      get: decryptSecret,
    },
    /** SHA-256 HMAC recovery-кодов; открытые значения никогда не сохраняются. */
    appRecoveryCodeHashes: { type: [String], default: [] },
    appTotpEnabledAt: { type: Date, default: null },
    panelCreatedAt: { type: Date, default: null },
    /** Версия обязательных Steam-настроек, применённых к аккаунту UProject. */
    panelSteamSettingsVersion: { type: Number, default: 0 },
    panelSteamSettingsConfiguredAt: { type: Date, default: null },
    panelSteamSettingsError: { type: String, default: "", maxlength: 300 },
    /** Публичный кастомный ID участника команды (до 12 символов). */
    customId: { type: String, default: "", maxlength: 12 },
    /** Linked Discord account after verification. */
    discordId: { type: String, default: "" },
    discordUsername: { type: String, default: "" },
    discordVerifiedAt: { type: Date, default: null },
    payoutMethod: { type: String, default: "" },
    payoutAddress: { type: String, default: "" },
    payoutRequisites: {
      type: [
        {
          _id: false,
          id: { type: String, required: true },
          method: { type: String, required: true },
          address: { type: String, default: "" },
        },
      ],
      default: [],
    },
    /** Индекс HD-деривации персонального казначейского кошелька (BIP32, hardened). Присваивается один раз. */
    treasuryWalletIndex: { type: Number, default: null, index: true },
    /** Публичные адреса персонального кошелька воркера (кошелёк команды, не воркера). */
    treasuryAddresses: {
      usdt_trc20: { type: String, default: "" },
      usdt_bep20: { type: String, default: "" },
      ton_gram: { type: String, default: "" },
    },
    /** Реальный on-chain остаток на персональном кошельке воркера, USD-эквивалент. */
    treasuryWalletBalanceUsd: {
      usdt_trc20: { type: Number, default: 0, min: 0 },
      usdt_bep20: { type: Number, default: 0, min: 0 },
      ton_gram: { type: Number, default: 0, min: 0 },
    },
    /** Прочитанные алерты панели (id: paused:1, ban:1:google, …). */
    panelReadAlertIds: { type: [String], default: [] },
    /** Скрытые алерты для новых воркеров (история до первого входа). */
    panelHiddenAlertIds: { type: [String], default: [] },
    panelAlertsBootstrapped: { type: Boolean, default: false },
    teamReferrals: [
      {
        domainId: { type: Number, required: true },
        path: { type: String, required: true },
        panelLinkId: { type: Number, default: null },
      },
    ],
    /** First paid-touch ad campaign attribution. */
    campaignId: { type: String, default: "", index: true },
    campaignSlug: { type: String, default: "" },
    campaignAttributedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

userSchema.index({ campaignId: 1, campaignAttributedAt: 1 });

userSchema.index(
  { customId: 1 },
  {
    unique: true,
    partialFilterExpression: { customId: { $type: "string", $gt: "" } },
  }
);

userSchema.index(
  { discordId: 1 },
  {
    unique: true,
    partialFilterExpression: { discordId: { $type: "string", $gt: "" } },
  }
);

module.exports = mongoose.model("User", userSchema);
