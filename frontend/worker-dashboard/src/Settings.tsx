import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Check,
  Copy,
  CreditCard,
  Download,
  KeyRound,
  Palette,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  UserRound,
} from "lucide-react";
import { Switch } from "./components/ui/switch";
import {
  readableSettingsError,
  settingsApi,
  settingsFromContext,
  type PayoutMethod,
  type PayoutRequisite,
  type SettingsUser,
  type TwoFactorSetup,
} from "./settingsApi";
import type { DashboardRenderContext } from "./types";
import "./settings-page.css";

const TABS = [
  { id: "profile", title: "Профиль", icon: UserRound },
  { id: "security", title: "Безопасность", icon: KeyRound },
  { id: "notifications", title: "Уведомления", icon: Bell },
  { id: "appearance", title: "Оформление", icon: Palette },
  { id: "payouts", title: "Выплаты", icon: CreditCard },
] as const;

type SettingsTab = (typeof TABS)[number]["id"];

function isNickPayoutMethod(method?: PayoutMethod | null) {
  return Boolean(method?.nicknamePayout) || method?.id === "lolz";
}

function loginFromUsername(username?: string) {
  const value = String(username || "").replace(/^@/, "").trim();
  return value || "—";
}

function toastOk(message: string) {
  window.WorkerToast?.success?.(message);
}

function toastErr(error: unknown) {
  if (window.WorkerToast?.error) {
    window.WorkerToast.error(error);
    return;
  }
  console.error(readableSettingsError(error));
}

function randomFakeTag() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const len = 4 + Math.floor(Math.random() * 3);
  let tag = "";
  for (let i = 0; i < len; i += 1) {
    tag += chars[Math.floor(Math.random() * chars.length)];
  }
  return tag;
}

export default function SettingsPage({
  context,
  username = "",
}: {
  context?: DashboardRenderContext | null;
  username?: string;
}) {
  const seed = settingsFromContext(context);
  const [tab, setTab] = useState<SettingsTab>("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<SettingsUser | null>(null);
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [hideInRating, setHideInRating] = useState(Boolean(seed.isAnonymous));
  const [autoSell, setAutoSell] = useState(seed.autoSellLogs !== false);
  const [fakeTag, setFakeTag] = useState(String(seed.fakeProfitTag || ""));
  const [bio, setBio] = useState(String(seed.bio || ""));
  const [hasAppPassword, setHasAppPassword] = useState(false);
  const [hasTwoFactor, setHasTwoFactor] = useState(false);
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(0);
  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [requisites, setRequisites] = useState<PayoutRequisite[]>([]);
  const [dark, setDark] = useState(
    () => window.WorkerPrefs?.get()?.theme !== "light",
  );
  const [defaultPeriod, setDefaultPeriod] = useState(
    () => Number(window.WorkerPrefs?.get()?.defaultPeriod || 7) as 7 | 14 | 30,
  );
  const [notifyBans, setNotifyBans] = useState(true);
  const [notifySales, setNotifySales] = useState(true);

  const login = loginFromUsername(
    user?.appLogin || user?.username || username || seed.username,
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    settingsApi
      .get(true)
      .then((data) => {
        if (!active) return;
        setUser(data.user);
        setMethods(data.methods);
        setHideInRating(data.user.isAnonymous);
        setAutoSell(data.user.autoSellLogs);
        setFakeTag(data.user.fakeProfitTag);
        setBio(data.user.bio);
        setHasAppPassword(data.user.hasAppPassword);
        setHasTwoFactor(data.user.hasTwoFactor);
        setRecoveryCodesRemaining(data.user.recoveryCodesRemaining);
        setRequisites(data.user.payoutRequisites);
        setPayoutMethod(data.methods[0]?.id || "");
      })
      .catch((requestError) => {
        if (!active) return;
        setError(readableSettingsError(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedMethod = useMemo(
    () => methods.find((row) => row.id === payoutMethod) || null,
    [methods, payoutMethod],
  );

  const saveProfile = async (next?: {
    isAnonymous?: boolean;
    autoSellLogs?: boolean;
    fakeProfitTag?: string;
    bio?: string;
  }) => {
    setSaving(true);
    try {
      const payload = {
        isAnonymous: next?.isAnonymous ?? hideInRating,
        autoSellLogs: next?.autoSellLogs ?? autoSell,
        bio: next?.bio ?? bio,
        ...(next?.isAnonymous ?? hideInRating
          ? { fakeProfitTag: next?.fakeProfitTag ?? fakeTag }
          : {}),
      };
      const updated = await settingsApi.patch(payload);
      setUser(updated);
      setHideInRating(updated.isAnonymous);
      setAutoSell(updated.autoSellLogs);
      setFakeTag(updated.fakeProfitTag);
      setBio(updated.bio);
      toastOk("Настройки сохранены");
    } catch (requestError) {
      toastErr(requestError);
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    setSaving(true);
    try {
      const result = await settingsApi.changePassword({
        currentPassword: hasAppPassword ? currentPassword : undefined,
        newPassword,
        confirmPassword,
      });
      setHasAppPassword(result.hasAppPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toastOk(hasAppPassword ? "Пароль обновлён" : "Пароль установлен");
    } catch (requestError) {
      toastErr(requestError);
    } finally {
      setSaving(false);
    }
  };

  const beginTwoFactor = async () => {
    setSaving(true);
    try {
      const setup = await settingsApi.beginTwoFactor(twoFactorPassword);
      setTwoFactorSetup(setup);
      setTwoFactorCode("");
      toastOk("Отсканируйте QR-код и подтвердите подключение");
    } catch (requestError) {
      toastErr(requestError);
    } finally {
      setSaving(false);
    }
  };

  const confirmTwoFactor = async () => {
    if (!twoFactorSetup) return;
    setSaving(true);
    try {
      const result = await settingsApi.confirmTwoFactor(twoFactorSetup.setupToken, twoFactorCode);
      setHasTwoFactor(true);
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCodesRemaining(result.recoveryCodesRemaining);
      setTwoFactorSetup(null);
      setTwoFactorPassword("");
      setTwoFactorCode("");
      toastOk("Двухфакторная аутентификация включена");
    } catch (requestError) {
      toastErr(requestError);
    } finally {
      setSaving(false);
    }
  };

  const regenerateRecoveryCodes = async () => {
    setSaving(true);
    try {
      const result = await settingsApi.regenerateRecoveryCodes(twoFactorPassword, twoFactorCode);
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCodesRemaining(result.recoveryCodesRemaining);
      setTwoFactorPassword("");
      setTwoFactorCode("");
      toastOk("Новые recovery-коды созданы. Старые больше не работают");
    } catch (requestError) {
      toastErr(requestError);
    } finally {
      setSaving(false);
    }
  };

  const disableTwoFactor = async () => {
    setSaving(true);
    try {
      await settingsApi.disableTwoFactor(twoFactorPassword, twoFactorCode);
      setHasTwoFactor(false);
      setRecoveryCodes([]);
      setRecoveryCodesRemaining(0);
      setTwoFactorPassword("");
      setTwoFactorCode("");
      toastOk("Двухфакторная аутентификация отключена");
    } catch (requestError) {
      toastErr(requestError);
    } finally {
      setSaving(false);
    }
  };

  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    toastOk("Recovery-коды скопированы");
  };

  const downloadRecoveryCodes = () => {
    const blob = new Blob([`Garbona recovery codes\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "garbona-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveRequisites = async (next: PayoutRequisite[]) => {
    setSaving(true);
    try {
      const updated = await settingsApi.patch({ payoutRequisites: next });
      setUser(updated);
      setRequisites(updated.payoutRequisites);
      toastOk("Реквизиты сохранены");
      return true;
    } catch (requestError) {
      toastErr(requestError);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addRequisite = async () => {
    if (!payoutMethod) {
      toastErr(new Error("Выберите метод выплат"));
      return;
    }
    if (!selectedMethod?.linkPayout && !payoutAddress.trim()) {
      toastErr(
        new Error(
          isNickPayoutMethod(selectedMethod)
            ? "Укажите ник на Lolz"
            : "Укажите адрес для вывода",
        ),
      );
      return;
    }
    const next = [
      {
        id: `tmp-${Date.now()}`,
        method: payoutMethod,
        address: selectedMethod?.linkPayout ? "" : payoutAddress.trim(),
      },
      ...requisites,
    ];
    const ok = await saveRequisites(next);
    if (ok) setPayoutAddress("");
  };

  const removeRequisite = async (id: string) => {
    const previous = requisites;
    const next = requisites.filter((row) => row.id !== id);
    setRequisites(next);
    const ok = await saveRequisites(next);
    if (!ok) setRequisites(previous);
  };

  const methodLabel = (id: string) =>
    methods.find((row) => row.id === id)?.label || id || "—";

  return (
    <div className="gst">
      <header className="gst__head">
        <h1>Настройки</h1>
        <p>Профиль, безопасность и поведение панели</p>
      </header>

      {error ? (
        <div className="gst__alert" role="alert">
          {error}
        </div>
      ) : null}

      <div className="gst__layout">
        <nav className="gst__nav" aria-label="Разделы настроек">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "is-active" : undefined}
              onClick={() => setTab(item.id)}
            >
              <item.icon strokeWidth={1.5} />
              {item.title}
            </button>
          ))}
        </nav>

        <div className="gst__panel" aria-busy={loading || saving}>
          {loading ? <p className="gst__lead">Загружаем настройки…</p> : null}

          {!loading && tab === "profile" ? (
            <>
              <h2>Профиль</h2>
              <p className="gst__lead">Контакт, приватность и автопродажа логов</p>
              <div className="gst__card">
                <ToggleRow
                  title="Скрыть ник в рейтинге"
                  hint="В профитах канала будет FAKE-TAG вместо вашего имени"
                  checked={hideInRating}
                  disabled={saving}
                  onChange={(next) => {
                    setHideInRating(next);
                    void saveProfile({ isAnonymous: next });
                  }}
                />
                {hideInRating ? (
                  <div className="gst__inline-field">
                    <label>
                      Fake-tag
                      <div className="gst__inline-actions">
                        <input
                          value={fakeTag}
                          onChange={(event) => setFakeTag(event.target.value)}
                          placeholder="tag"
                          maxLength={12}
                        />
                        <button
                          type="button"
                          className="gst__btn gst__btn--ghost"
                          disabled={saving}
                          onClick={() => setFakeTag(randomFakeTag())}
                        >
                          Random
                        </button>
                        <button
                          type="button"
                          className="gst__btn"
                          disabled={saving}
                          onClick={() => void saveProfile({ fakeProfitTag: fakeTag })}
                        >
                          Сохранить tag
                        </button>
                      </div>
                    </label>
                  </div>
                ) : null}
                <ToggleRow
                  title="Автоматическая продажа логов"
                  hint="Валидные логи сразу выставляются на продажу. Сумма на холде до снятия гарантии"
                  checked={autoSell}
                  disabled={saving}
                  onChange={(next) => {
                    setAutoSell(next);
                    void saveProfile({ autoSellLogs: next });
                  }}
                />
              </div>
              <div className="gst__card gst__form">
                <label>
                  О себе
                  <textarea
                    rows={3}
                    value={bio}
                    maxLength={500}
                    onChange={(event) => setBio(event.target.value)}
                    placeholder="Коротко о себе"
                  />
                </label>
                <button
                  type="button"
                  className="gst__btn"
                  disabled={saving}
                  onClick={() => void saveProfile({ bio })}
                >
                  Сохранить профиль
                </button>
              </div>
            </>
          ) : null}

          {!loading && tab === "security" ? (
            <>
              <h2>Безопасность</h2>
              <p className="gst__lead">Логин, пароль и двухфакторная защита входа</p>
              <div className="gst__card">
                <StaticRow
                  title="Логин для входа"
                  hint="Это ваш логин для входа в панель."
                  value={login === "—" ? "—" : `@${login}`}
                />
              </div>
              <div className="gst__card gst__form">
                {hasAppPassword ? (
                  <label>
                    Текущий пароль
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </label>
                ) : null}
                <label>
                  Новый пароль
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </label>
                <label>
                  Подтверждение
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="gst__btn"
                  disabled={saving || !newPassword}
                  onClick={() => void savePassword()}
                >
                  {hasAppPassword ? "Сохранить пароль" : "Установить пароль"}
                </button>
              </div>
              <div className="gst__card">
                <div className="gst__row">
                  <div>
                    <strong>Двухфакторная аутентификация</strong>
                    <p>
                      {hasTwoFactor
                        ? `Включена · осталось recovery-кодов: ${recoveryCodesRemaining}`
                        : "Защитите вход кодом из приложения-аутентификатора"}
                    </p>
                  </div>
                  <span className={hasTwoFactor ? "gst__security-status is-on" : "gst__security-status"}>
                    {hasTwoFactor ? <ShieldCheck aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
                    {hasTwoFactor ? "Включена" : "Выключена"}
                  </span>
                </div>
              </div>

              {!hasTwoFactor && !twoFactorSetup ? (
                <div className="gst__card gst__form">
                  <p className="gst__lead">
                    Для подключения сначала подтвердите текущий пароль. Затем добавьте Garbona в Google Authenticator, 1Password, Bitwarden или другое TOTP-приложение.
                  </p>
                  <label>
                    Текущий пароль
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={twoFactorPassword}
                      onChange={(event) => setTwoFactorPassword(event.target.value)}
                    />
                  </label>
                  <button type="button" className="gst__btn" disabled={saving || !hasAppPassword || !twoFactorPassword} onClick={() => void beginTwoFactor()}>
                    <ShieldCheck aria-hidden="true" />
                    Подключить 2FA
                  </button>
                  {!hasAppPassword ? <p className="gst__warning">Сначала установите пароль для входа.</p> : null}
                </div>
              ) : null}

              {twoFactorSetup ? (
                <div className="gst__card gst__two-factor-setup">
                  <div className="gst__qr" aria-label="QR-код для приложения-аутентификатора" dangerouslySetInnerHTML={{ __html: twoFactorSetup.qrSvg }} />
                  <div className="gst__setup-copy">
                    <span className="gst__step">Шаг 1</span>
                    <h3>Отсканируйте QR-код</h3>
                    <p>Если сканирование недоступно, добавьте ключ вручную:</p>
                    <code>{twoFactorSetup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                    <span className="gst__step">Шаг 2</span>
                    <label>
                      Код из приложения
                      <input
                        className="gst__otp"
                        value={twoFactorCode}
                        onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="000 000"
                        maxLength={6}
                      />
                    </label>
                    <div className="gst__actions">
                      <button type="button" className="gst__btn" disabled={saving || twoFactorCode.length !== 6} onClick={() => void confirmTwoFactor()}>
                        <Check aria-hidden="true" />
                        Подтвердить и включить
                      </button>
                      <button type="button" className="gst__btn gst__btn--ghost" disabled={saving} onClick={() => { setTwoFactorSetup(null); setTwoFactorCode(""); }}>
                        Отмена
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {hasTwoFactor ? (
                <div className="gst__card gst__form">
                  <p className="gst__lead">Для отключения защиты или выпуска новых recovery-кодов подтвердите пароль и код из приложения. Вместо TOTP можно ввести recovery-код.</p>
                  <label>
                    Текущий пароль
                    <input type="password" autoComplete="current-password" value={twoFactorPassword} onChange={(event) => setTwoFactorPassword(event.target.value)} />
                  </label>
                  <label>
                    TOTP или recovery-код
                    <input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.toUpperCase().slice(0, 16))} autoComplete="one-time-code" placeholder="000000 или XXXX-XXXX-XXXX" />
                  </label>
                  <div className="gst__actions">
                    <button type="button" className="gst__btn gst__btn--ghost" disabled={saving || !twoFactorPassword || !twoFactorCode} onClick={() => void regenerateRecoveryCodes()}>
                      <RotateCcw aria-hidden="true" />
                      Выпустить новые коды
                    </button>
                    <button type="button" className="gst__btn gst__btn--danger" disabled={saving || !twoFactorPassword || !twoFactorCode} onClick={() => void disableTwoFactor()}>
                      <ShieldOff aria-hidden="true" />
                      Отключить 2FA
                    </button>
                  </div>
                </div>
              ) : null}

              {recoveryCodes.length ? (
                <div className="gst__card gst__recovery" role="status">
                  <div className="gst__recovery-head">
                    <div><strong>Сохраните recovery-коды</strong><p>Каждый код работает один раз. После закрытия этой карточки увидеть их снова нельзя.</p></div>
                    <ShieldCheck aria-hidden="true" />
                  </div>
                  <div className="gst__recovery-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
                  <div className="gst__actions">
                    <button type="button" className="gst__btn gst__btn--ghost" onClick={() => void copyRecoveryCodes()}><Copy aria-hidden="true" />Копировать</button>
                    <button type="button" className="gst__btn gst__btn--ghost" onClick={downloadRecoveryCodes}><Download aria-hidden="true" />Скачать .txt</button>
                    <button type="button" className="gst__btn" onClick={() => setRecoveryCodes([])}><Check aria-hidden="true" />Я сохранил коды</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {!loading && tab === "notifications" ? (
            <>
              <h2>Уведомления</h2>
              <p className="gst__lead">Локальные предпочтения колокольчика на этом устройстве</p>
              <div className="gst__card">
                <ToggleRow
                  title="Бан и пауза доменов"
                  hint="Показывать уведомление, если домен ушёл в бан или на паузу"
                  checked={notifyBans}
                  onChange={setNotifyBans}
                />
                <ToggleRow
                  title="Продажи и холд"
                  hint="Сообщать о продаже лога и удержании средств"
                  checked={notifySales}
                  onChange={setNotifySales}
                />
              </div>
            </>
          ) : null}

          {!loading && tab === "appearance" ? (
            <>
              <h2>Оформление</h2>
              <p className="gst__lead">Тема и период Dashboard по умолчанию</p>
              <div className="gst__card">
                <ToggleRow
                  title="Тёмная тема"
                  hint="Светлая тема доступна, но тёмная — основной вид панели"
                  checked={dark}
                  onChange={(next) => {
                    setDark(next);
                    window.WorkerPrefs?.set?.({ theme: next ? "dark" : "light" });
                  }}
                />
              </div>
              <div className="gst__card">
                <div className="gst__row is-static">
                  <div>
                    <strong>Период Dashboard</strong>
                    <p>Сколько дней показывать при открытии главной</p>
                  </div>
                  <div className="gst__segments">
                    {([7, 14, 30] as const).map((days) => (
                      <button
                        key={days}
                        type="button"
                        className={defaultPeriod === days ? "is-active" : undefined}
                        onClick={() => {
                          setDefaultPeriod(days);
                          window.WorkerPrefs?.set?.({ defaultPeriod: days });
                        }}
                      >
                        {days}д
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {!loading && tab === "payouts" ? (
            <>
              <h2>Выплаты</h2>
              <p className="gst__lead">
                Реквизиты для вывода. Сам вывод — в разделе кошелька.
              </p>
              <div className="gst__card gst__form">
                <label>
                  Метод
                  <select
                    value={payoutMethod}
                    onChange={(event) => setPayoutMethod(event.target.value)}
                  >
                    {methods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.label}
                        {method.feeUsd > 0 ? ` · fee $${method.feeUsd}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {!selectedMethod?.linkPayout ? (
                  <label>
                    {isNickPayoutMethod(selectedMethod) ? "Ник Lolz" : "Адрес / реквизит"}
                    <input
                      value={payoutAddress}
                      onChange={(event) => setPayoutAddress(event.target.value)}
                      placeholder={
                        isNickPayoutMethod(selectedMethod)
                          ? "Ник на Lolz"
                          : "Адрес кошелька"
                      }
                    />
                  </label>
                ) : (
                  <p className="gst__lead">
                    Для этого метода адрес не нужен — выплата уходит по ссылке.
                  </p>
                )}
                <button
                  type="button"
                  className="gst__btn"
                  disabled={saving || !methods.length}
                  onClick={() => void addRequisite()}
                >
                  Добавить реквизит
                </button>
              </div>
              <div className="gst__card">
                {requisites.length === 0 ? (
                  <p className="gst__lead">Пока нет сохранённых реквизитов</p>
                ) : (
                  <ul className="gst__payout-list">
                    {requisites.map((row) => (
                      <li key={row.id}>
                        <div>
                          <strong>{methodLabel(row.method)}</strong>
                          <span>
                            {methods.find((item) => item.id === row.method)?.linkPayout
                              ? "Выплата по ссылке"
                              : row.address || "—"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="gst__btn gst__btn--ghost"
                          disabled={saving}
                          onClick={() => void removeRequisite(row.id)}
                        >
                          Удалить
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StaticRow({
  title,
  hint,
  value,
}: {
  title: string;
  hint: string;
  value: string;
}) {
  return (
    <div className="gst__row is-static">
      <div>
        <strong>{title}</strong>
        <p>{hint}</p>
      </div>
      <span className="gst__value">{value}</span>
    </div>
  );
}

function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="gst__row">
      <div>
        <strong>{title}</strong>
        <p>{hint}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        label={title}
      />
    </div>
  );
}
