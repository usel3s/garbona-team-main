import type { DashboardRenderContext } from "./types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function string(value: unknown, fallback = ""): string {
  return value == null ? fallback : String(value);
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requireWorkerApi() {
  if (!window.WorkerAPI) {
    throw new Error("Settings API is unavailable");
  }
  return window.WorkerAPI;
}

export interface PayoutMethod {
  id: string;
  label: string;
  feeUsd: number;
  linkPayout: boolean;
  nicknamePayout: boolean;
}

export interface PayoutRequisite {
  id: string;
  method: string;
  address: string;
}

export interface SettingsUser {
  username: string;
  telegramId: string;
  appLogin: string;
  hasAppPassword: boolean;
  hasTwoFactor: boolean;
  recoveryCodesRemaining: number;
  isAnonymous: boolean;
  autoSellLogs: boolean;
  fakeProfitTag: string;
  bio: string;
  payoutMethod: string;
  payoutAddress: string;
  payoutRequisites: PayoutRequisite[];
}

export interface SettingsPayload {
  user: SettingsUser;
  methods: PayoutMethod[];
  minWithdrawalUsd: number;
  supportUrl: string;
}

function normalizeRequisite(raw: unknown, index: number): PayoutRequisite {
  const row = record(raw);
  return {
    id: string(row.id, `req-${index}`),
    method: string(row.method),
    address: string(row.address),
  };
}

function normalizeMethod(raw: unknown): PayoutMethod {
  const row = record(raw);
  return {
    id: string(row.id),
    label: string(row.label, string(row.id)),
    feeUsd: number(row.feeUsd),
    linkPayout: Boolean(row.linkPayout),
    nicknamePayout: Boolean(row.nicknamePayout) || string(row.id) === "lolz",
  };
}

function normalizeUser(raw: unknown): SettingsUser {
  const user = record(raw);
  const requisites = list(user.payoutRequisites).map(normalizeRequisite);
  if (
    !requisites.length &&
    (string(user.payoutMethod) || string(user.payoutAddress))
  ) {
    requisites.push({
      id: "legacy",
      method: string(user.payoutMethod),
      address: string(user.payoutAddress),
    });
  }
  return {
    username: string(user.username),
    telegramId: string(user.telegramId),
    appLogin: string(user.appLogin || user.username || user.telegramId),
    hasAppPassword: Boolean(user.hasAppPassword),
    hasTwoFactor: Boolean(user.hasTwoFactor),
    recoveryCodesRemaining: number(user.recoveryCodesRemaining),
    isAnonymous: Boolean(user.isAnonymous),
    autoSellLogs: user.autoSellLogs !== false,
    fakeProfitTag: string(user.fakeProfitTag).replace(/^#+/, ""),
    bio: string(user.bio),
    payoutMethod: string(user.payoutMethod),
    payoutAddress: string(user.payoutAddress),
    payoutRequisites: requisites.filter((row) => row.method),
  };
}

export function normalizeSettings(raw: unknown): SettingsPayload {
  const data = record(raw);
  return {
    user: normalizeUser(data.user),
    methods: list(data.methods).map(normalizeMethod).filter((row) => row.id),
    minWithdrawalUsd: number(data.minWithdrawalUsd),
    supportUrl: string(data.supportUrl),
  };
}

export const settingsApi = {
  async get(force = false): Promise<SettingsPayload> {
    const raw = await requireWorkerApi().get("/settings", { force });
    return normalizeSettings(raw);
  },

  async patch(body: UnknownRecord): Promise<SettingsPayload["user"]> {
    const raw = await requireWorkerApi().patch("/settings", body);
    return normalizeUser(record(raw).user || raw);
  },

  async changePassword(payload: {
    currentPassword?: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ ok: boolean; hasAppPassword: boolean }> {
    const raw = await requireWorkerApi().post("/settings/password", payload);
    const data = record(raw);
    return {
      ok: data.ok !== false,
      hasAppPassword: Boolean(data.hasAppPassword ?? true),
    };
  },

  async beginTwoFactor(currentPassword: string): Promise<TwoFactorSetup> {
    const raw = record(await requireWorkerApi().post("/settings/2fa/setup", { currentPassword }));
    return {
      secret: string(raw.secret),
      otpauthUri: string(raw.otpauthUri),
      qrSvg: string(raw.qrSvg),
      setupToken: string(raw.setupToken),
      expiresInSeconds: number(raw.expiresInSeconds, 600),
    };
  },

  async confirmTwoFactor(setupToken: string, code: string): Promise<RecoveryCodesResult> {
    return normalizeRecoveryCodes(await requireWorkerApi().post("/settings/2fa/confirm", { setupToken, code }));
  },

  async regenerateRecoveryCodes(currentPassword: string, code: string): Promise<RecoveryCodesResult> {
    return normalizeRecoveryCodes(await requireWorkerApi().post("/settings/2fa/recovery-codes", { currentPassword, code }));
  },

  async disableTwoFactor(currentPassword: string, code: string): Promise<{ ok: boolean }> {
    const raw = record(await requireWorkerApi().post("/settings/2fa/disable", { currentPassword, code }));
    return { ok: raw.ok !== false };
  },
};

export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
  setupToken: string;
  expiresInSeconds: number;
}

export interface RecoveryCodesResult {
  ok: boolean;
  recoveryCodes: string[];
  recoveryCodesRemaining: number;
}

function normalizeRecoveryCodes(raw: unknown): RecoveryCodesResult {
  const data = record(raw);
  return {
    ok: data.ok !== false,
    recoveryCodes: list(data.recoveryCodes).map((code) => string(code)).filter(Boolean),
    recoveryCodesRemaining: number(data.recoveryCodesRemaining),
  };
}

export function settingsFromContext(
  context?: DashboardRenderContext | null,
): Partial<SettingsUser> {
  const user = record(context?.user);
  return {
    username: string(user.username),
    telegramId: string(user.telegramId),
    appLogin: string(user.appLogin || user.username),
  };
}

export function readableSettingsError(error: unknown): string {
  const key = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    invalid_current_password: "Неверный текущий пароль",
    invalid_two_factor: "Неверный или устаревший код",
    password_required: "Сначала установите пароль для входа",
    setup_expired: "Время подключения истекло. Начните заново",
    two_factor_enabled: "Двухфакторная аутентификация уже включена",
    two_factor_disabled: "Двухфакторная аутентификация не включена",
  };
  if (messages[key]) return messages[key];
  const friendly = window.WorkerToast?.friendlyError?.(error);
  if (friendly) return friendly;
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось сохранить настройки";
}
