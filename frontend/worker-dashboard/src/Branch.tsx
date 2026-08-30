import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleDollarSign,
  FileText,
  GitBranch,
  Plus,
  ShieldCheck,
  Users,
  UserPlus,
  X,
} from "lucide-react";
import { useRef } from "react";
import { EmptyState } from "./components/ui/empty-state";
import { AvatarFileUpload } from "./components/ui/file-upload-1";
import { TickSlider } from "./components/ui/tick-slider";
import { OverviewPanel } from "./branch/OverviewPanel";
import { MembersPanel } from "./branch/MembersPanel";
import { SettingsPanel } from "./branch/SettingsPanel";
import { ManualsPanel } from "./branch/ManualsPanel";
import {
  MAX_BRANCH_DESCRIPTION,
  type BranchSection,
} from "./branch/types";
import {
  branchApi,
  readableBranchError,
  type BranchOverviewPayload,
  type BranchMembersPayload,
} from "./branchApi";
import "./branch-page.css";

export type { BranchSection };
export type { BranchMemberRow } from "./branch/types";

export type BranchMembership = "none" | "member" | "owner";

const MAX_PERCENT = 10;
const MIN_PROFITS = 100;
const PALETTES = [
  { from: "#06352c", to: "#00c48c", accent: "#00c48c" },
  { from: "#0b2a3d", to: "#5ec8ff", accent: "#7dd3fc" },
  { from: "#2e1d08", to: "#e8b86d", accent: "#e8b86d" },
  { from: "#2a1230", to: "#e879c0", accent: "#f0abfc" },
  { from: "#122016", to: "#86efac", accent: "#4ade80" },
  { from: "#1a1433", to: "#a78bfa", accent: "#c4b5fd" },
  { from: "#2a1212", to: "#fb7185", accent: "#fb7185" },
  { from: "#0e2430", to: "#2dd4bf", accent: "#2dd4bf" },
] as const;

export type BranchOwner = {
  username?: string;
  firstName?: string;
  telegramId?: string;
  avatarUrl?: string;
};

export type BranchRecord = {
  id: string;
  name: string;
  description: string;
  percent: number;
  members: number;
  total: number;
  profitCount?: number;
  owner: BranchOwner;
  createdAt: string;
  avatarUrl?: string;
  tone?: number;
  isOwner?: boolean;
  isMember?: boolean;
  acceptingApplications?: boolean;
};

export const MOCK_BRANCHES: BranchRecord[] = [
  {
    id: "north",
    name: "North",
    description:
      "EU-трафик, аккуратный прогрев и быстрый разбор логов. Ищем 2–3 воркера на постоянку.",
    percent: 5,
    members: 14,
    total: 48210.4,
    profitCount: 186,
    owner: { username: "northwind", firstName: "Марк" },
    createdAt: "2026-03-12",
    tone: 0,
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=North&backgroundColor=00c48c",
    acceptingApplications: true,
  },
  {
    id: "atlas",
    name: "Atlas",
    description: "США и Канада. Свои домены, своя аналитика, онбординг за день.",
    percent: 7,
    members: 9,
    total: 27140,
    profitCount: 94,
    owner: { username: "atlas_lead", firstName: "Илья" },
    createdAt: "2026-01-28",
    tone: 1,
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=Atlas&backgroundColor=38bdf8",
    acceptingApplications: true,
  },
  {
    id: "helix",
    name: "Helix",
    description: "Ночная смена. Фокус на мобильный трафик и короткие сессии.",
    percent: 4,
    members: 22,
    total: 61308.9,
    profitCount: 241,
    owner: { firstName: "Лера" },
    createdAt: "2025-11-04",
    tone: 3,
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=Helix&backgroundColor=e879c0",
    acceptingApplications: false,
  },
  {
    id: "dover",
    name: "Dover",
    description: "Небольшая команда. Высокий чек, мало шума, разбор в тот же день.",
    percent: 8,
    members: 5,
    total: 15420,
    profitCount: 38,
    owner: { username: "dover", firstName: "Никита" },
    createdAt: "2026-06-02",
    tone: 4,
    acceptingApplications: true,
  },
];

/** Demo owned branch — North marked as owner for cabinet previews. */
export const OWNED_BRANCH: BranchRecord = {
  ...MOCK_BRANCHES[0],
  isOwner: true,
  acceptingApplications: true,
};

const SECTION_TO_VIEW: Record<BranchSection, string> = {
  catalog: "branch",
  create: "branch-create",
  overview: "branch-overview",
  members: "branch-members",
  settings: "branch-settings",
  manuals: "branch-manuals",
};

export function branchSectionToView(section: BranchSection): string {
  return SECTION_TO_VIEW[section];
}

function hashName(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

function identityFor(name: string, tone?: number) {
  const palette = PALETTES[(tone ?? hashName(name)) % PALETTES.length];
  const initial = (name.trim().charAt(0) || "Ф").toUpperCase();
  return { ...palette, initial };
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(Number(value) || 0);
}

function pluralRu(count: number, one: string, few: string, many: string) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function branchAgeDays(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const ms = Date.now() - date.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function formatBranchAge(value: string) {
  const days = branchAgeDays(value);
  if (days == null) return "—";
  return `${days} ${pluralRu(days, "день", "дня", "дней")}`;
}

function ownerLabel(owner: BranchOwner) {
  if (owner.username) return `@${owner.username}`;
  if (owner.firstName) return owner.firstName;
  if (owner.telegramId) return owner.telegramId;
  return "владелец";
}

function resolveSection(
  section: BranchSection | undefined,
  membership: BranchMembership,
): BranchSection {
  if (section) return section;
  if (membership === "owner" || membership === "member") return "overview";
  return "catalog";
}

function seedBranches(
  membership: BranchMembership,
  initialBranches?: BranchRecord[],
  initialBranch?: BranchRecord | null,
): BranchRecord[] {
  const base =
    initialBranches ??
    (initialBranch ? [initialBranch] : [...MOCK_BRANCHES]);

  if (membership === "owner") {
    return base.map((branch) =>
      branch.id === "north" || branch.isOwner
        ? { ...branch, isOwner: true, isMember: false }
        : { ...branch, isOwner: false },
    );
  }

  if (membership === "member") {
    const hasMember = base.some((branch) => branch.isMember);
    if (hasMember) return base;
    return base.map((branch, index) =>
      index === 0
        ? { ...branch, isMember: true, isOwner: false }
        : { ...branch, isMember: false, isOwner: false },
    );
  }

  return base.map((branch) => ({
    ...branch,
    isOwner: false,
    isMember: false,
  }));
}

function BranchAvatar({
  name,
  avatarUrl,
  tone,
  size = "md",
}: {
  name: string;
  avatarUrl?: string;
  tone?: number;
  size?: "sm" | "md" | "lg" | "hero";
}) {
  const identity = identityFor(name, tone);
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(avatarUrl) && !failed;

  return (
    <div
      className={`gbr-avatar gbr-avatar--${size}`}
      style={
        {
          "--gbr-accent": identity.accent,
          "--gbr-from": identity.from,
          "--gbr-to": identity.to,
        } as CSSProperties
      }
    >
      {showPhoto ? (
        <img src={avatarUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{identity.initial}</span>
      )}
    </div>
  );
}

function BranchCard({
  branch,
  joinState,
  joinLocked,
  onOpen,
  onJoin,
  onCancel,
}: {
  branch: BranchRecord;
  joinState: "idle" | "pending" | "member" | "owner";
  joinLocked: boolean;
  onOpen(branch: BranchRecord): void;
  onJoin(id: string): void;
  onCancel(id: string): void;
}) {
  const identity = identityFor(branch.name, branch.tone);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showPhoto = Boolean(branch.avatarUrl) && !avatarFailed;
  const appsClosed = branch.acceptingApplications === false;

  const action =
    joinState === "owner"
      ? { label: "Ваш филиал", disabled: true, ghost: true, kind: "noop" as const }
      : joinState === "member"
        ? { label: "Вы в команде", disabled: true, ghost: true, kind: "noop" as const }
        : joinState === "pending"
          ? { label: "Отменить заявку", disabled: false, ghost: true, kind: "cancel" as const }
          : {
              label: appsClosed
                ? "Заявки закрыты"
                : joinLocked
                  ? "Есть другая заявка"
                  : "Вступить",
              disabled: appsClosed || joinLocked,
              ghost: appsClosed,
              kind: "join" as const,
            };

  return (
    <article
      className="gbr-tile"
      role="button"
      tabIndex={0}
      aria-label={`Подробнее о филиале ${branch.name}`}
      style={
        {
          "--gbr-accent": identity.accent,
          "--gbr-from": identity.from,
          "--gbr-to": identity.to,
        } as CSSProperties
      }
      onClick={() => onOpen(branch)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(branch);
        }
      }}
    >
      <div className="gbr-tile__stage" aria-hidden="true">
        <div className="gbr-tile__glow" />
        {showPhoto ? (
          <img
            className="gbr-tile__avatar"
            src={branch.avatarUrl}
            alt=""
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <div className="gbr-tile__avatar gbr-tile__avatar--mark">
            <span>{identity.initial}</span>
          </div>
        )}
        <div className="gbr-tile__shade" />
      </div>

      <div className="gbr-tile__body">
        <div>
          <div className="gbr-tile__chips">
            <span className="gbr-chip">{branch.percent}%</span>
            {joinState === "owner" ? <span className="gbr-chip is-own">Ваш</span> : null}
            {joinState === "member" ? <span className="gbr-chip is-own">Участник</span> : null}
            {joinState === "pending" ? <span className="gbr-chip is-pending">Заявка</span> : null}
            {appsClosed && joinState === "idle" ? (
              <span className="gbr-chip">Заявки закрыты</span>
            ) : null}
          </div>
          <h2>{branch.name}</h2>
          <p className="gbr-tile__desc">
            {branch.description.trim() || "Описание пока не указано."}
          </p>
        </div>

        <dl className="gbr-tile__stats">
          <div>
            <dt>Профитов на</dt>
            <dd>{formatUsd(branch.total)}</dd>
          </div>
          <div>
            <dt>Участники</dt>
            <dd>
              {branch.members}{" "}
              <small>
                {pluralRu(branch.members, "человек", "человека", "человек")}
              </small>
            </dd>
          </div>
          <div>
            <dt>Существует</dt>
            <dd>{formatBranchAge(branch.createdAt)}</dd>
          </div>
        </dl>

        <footer className="gbr-tile__foot">
          <div className="gbr-tile__owner">
            <span className="gbr-tile__owner-mark" aria-hidden="true">
              {(ownerLabel(branch.owner).replace(/^@/, "").charAt(0) || "?").toUpperCase()}
            </span>
            <div>
              <small>Владелец</small>
              <strong>{ownerLabel(branch.owner)}</strong>
            </div>
          </div>
          <button
            type="button"
            className={`gbr__btn${action.ghost ? " is-ghost" : ""}`}
            disabled={action.disabled}
            title={
              action.kind === "join" && appsClosed
                ? "Филиал не принимает заявки из каталога"
                : action.kind === "join" && joinLocked
                  ? "Сначала отмени текущую заявку"
                : undefined
            }
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (action.kind === "cancel") onCancel(branch.id);
              else if (action.kind === "join") onJoin(branch.id);
            }}
          >
            {action.kind === "join" ? <UserPlus size={15} strokeWidth={2} /> : null}
            {action.label}
          </button>
        </footer>
      </div>
    </article>
  );
}

function BranchDetailModal({
  branch,
  joinState,
  joinLocked,
  onJoin,
  onCancel,
  onClose,
}: {
  branch: BranchRecord;
  joinState: "idle" | "pending" | "member" | "owner";
  joinLocked: boolean;
  onJoin(id: string): void;
  onCancel(id: string): void;
  onClose(): void;
}) {
  const identity = identityFor(branch.name, branch.tone);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const appsClosed = branch.acceptingApplications === false;

  const action =
    joinState === "owner"
      ? { label: "Ваш филиал", disabled: true, kind: "noop" as const }
      : joinState === "member"
        ? { label: "Вы в команде", disabled: true, kind: "noop" as const }
        : joinState === "pending"
          ? { label: "Отменить заявку", disabled: false, kind: "cancel" as const }
          : {
              label: appsClosed
                ? "Набор приостановлен"
                : joinLocked
                  ? "Есть другая заявка"
                  : "Подать заявку",
              disabled: appsClosed || joinLocked,
              kind: "join" as const,
            };

  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, 140);
  }

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="gbr-detail-overlay"
      data-closing={closing || undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        className="gbr-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gbr-detail-title"
        style={
          {
            "--gbr-accent": identity.accent,
            "--gbr-from": identity.from,
            "--gbr-to": identity.to,
          } as CSSProperties
        }
      >
        <button
          ref={closeRef}
          type="button"
          className="gbr-detail__close"
          aria-label="Закрыть подробности филиала"
          onClick={requestClose}
        >
          <X size={17} strokeWidth={1.8} />
        </button>

        <header className="gbr-detail__hero">
          <div className="gbr-detail__halo" aria-hidden="true" />
          <BranchAvatar
            name={branch.name}
            avatarUrl={branch.avatarUrl}
            tone={branch.tone}
            size="hero"
          />
          <div className="gbr-detail__hero-copy">
            <div className="gbr-tile__chips">
              <span className="gbr-chip">{branch.percent}% комиссия</span>
              <span className={`gbr-chip ${appsClosed ? "" : "is-own"}`}>
                {appsClosed ? "Набор закрыт" : "Принимает заявки"}
              </span>
            </div>
            <p className="gbr-detail__eyebrow">Филиал команды</p>
            <h2 id="gbr-detail-title">{branch.name}</h2>
            <p className="gbr-detail__description">
              {branch.description.trim() || "Владелец пока не добавил описание филиала."}
            </p>
          </div>
        </header>

        <div className="gbr-detail__content">
          <dl className="gbr-detail__stats">
            <div>
              <CircleDollarSign size={16} strokeWidth={1.8} />
              <dt>Общий профит</dt>
              <dd>{formatUsd(branch.total)}</dd>
            </div>
            <div>
              <FileText size={16} strokeWidth={1.8} />
              <dt>Профитов</dt>
              <dd>{branch.profitCount ?? "—"}</dd>
            </div>
            <div>
              <Users size={16} strokeWidth={1.8} />
              <dt>Участников</dt>
              <dd>{branch.members}</dd>
            </div>
            <div>
              <CalendarDays size={16} strokeWidth={1.8} />
              <dt>Возраст</dt>
              <dd>{formatBranchAge(branch.createdAt)}</dd>
            </div>
          </dl>

          <div className="gbr-detail__split">
            <section className="gbr-detail__panel">
              <p className="gbr-detail__label">Владелец</p>
              <div className="gbr-detail__owner">
                <BranchAvatar
                  name={ownerLabel(branch.owner)}
                  avatarUrl={branch.owner.avatarUrl}
                  tone={branch.tone}
                  size="sm"
                />
                <div>
                  <strong>{ownerLabel(branch.owner)}</strong>
                  <span>Управляет командой и заявками</span>
                </div>
              </div>
            </section>

            <section className="gbr-detail__panel">
              <p className="gbr-detail__label">Условия</p>
              <div className="gbr-detail__terms">
                <ShieldCheck size={18} strokeWidth={1.8} />
                <div>
                  <strong>{branch.percent}% с профита</strong>
                  <span>Комиссия филиала списывается с доли воркера</span>
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer className="gbr-detail__footer">
          <p>
            {action.kind === "join"
              ? "После подачи владелец рассмотрит заявку."
              : action.kind === "cancel"
                ? "Заявка ожидает решения владельца."
                : "Подробности и материалы доступны участникам."}
          </p>
          <button
            type="button"
            className={`gbr__btn${action.kind === "cancel" ? " is-ghost" : ""}`}
            disabled={action.disabled}
            onClick={() => {
              if (action.kind === "cancel") onCancel(branch.id);
              if (action.kind === "join") onJoin(branch.id);
              if (action.kind !== "noop") requestClose();
            }}
          >
            {action.kind === "join" ? <UserPlus size={15} strokeWidth={2} /> : null}
            {action.label}
          </button>
        </footer>
      </section>
    </div>
  );
}

function CreateWizard({
  eligible,
  onCancel,
  onCreate,
}: {
  eligible: boolean;
  onCancel(): void;
  onCreate(draft: {
    name: string;
    description: string;
    percent: number;
    avatarUrl: string;
  }): void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [description, setDescription] = useState("");
  const [percent, setPercent] = useState(5);
  const [error, setError] = useState("");

  const nameOk = name.trim().length >= 2 && name.trim().length <= 32;
  const step1Ok = nameOk;
  const step2Ok = percent >= 0 && percent <= MAX_PERCENT;
  const descPreview = description.trim() || "Описание не указано.";

  function next() {
    setError("");
    if (step === 1 && !step1Ok) {
      setError("Название — от 2 до 32 символов.");
      return;
    }
    if (step === 2 && !step2Ok) {
      setError(`Комиссия — от 0 до ${MAX_PERCENT}%.`);
      return;
    }
    setStep((current) => Math.min(3, current + 1));
  }

  function submit() {
    if (!eligible) {
      setError(`Ваша статистика должна быть не менее $${MIN_PROFITS}.`);
      return;
    }
    if (!nameOk) {
      setError("Название — от 2 до 32 символов.");
      return;
    }
    setError("");
    onCreate({
      name: name.trim(),
      description: description.trim().slice(0, MAX_BRANCH_DESCRIPTION),
      percent,
      avatarUrl: avatarUrl.trim(),
    });
  }

  return (
    <div className="gbr is-form is-wizard">
      <header className="gbr__head">
        <div>
          <p className="gbr__kicker">
            <GitBranch size={14} strokeWidth={1.7} />
            Новый филиал
          </p>
          <h1>Создать филиал</h1>
          <p>
            Три шага. Владелец получает процент с профитов участников — до {MAX_PERCENT}%.
          </p>
        </div>
      </header>

      <ol className="gbr-wizard__steps" aria-label="Шаги создания">
        {[
          { n: 1, label: "Имя" },
          { n: 2, label: "Условия" },
          { n: 3, label: "Подтверждение" },
        ].map((item) => (
          <li
            key={item.n}
            className={
              item.n === step ? "is-active" : item.n < step ? "is-done" : undefined
            }
          >
            <span className="gbr-wizard__dot">
              {item.n < step ? <Check size={12} strokeWidth={2.5} /> : item.n}
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ol>

      <div className="gbr__card gbr-wizard__card">
        {!eligible ? (
          <p className="gbr__note is-bad">
            {`Ваша статистика должна быть не менее $${MIN_PROFITS}.`}
          </p>
        ) : null}

        {step === 1 ? (
          <div className="gbr-wizard__panel">
            <label>
              Название
              <input
                value={name}
                maxLength={32}
                placeholder="Например, North"
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="gbr-field">
              <span className="gbr-field__label">
                Аватар <span className="gbr__optional">необязательно</span>
              </span>
              <AvatarFileUpload
                value={avatarUrl}
                onChange={({ url }) => setAvatarUrl(url)}
              />
            </div>
            <div className="gbr-wizard__preview">
              <BranchAvatar name={name || "Ф"} avatarUrl={avatarUrl || undefined} size="lg" />
              <div>
                <strong>{name.trim() || "Название филиала"}</strong>
                <small>Так карточка будет выглядеть в каталоге</small>
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="gbr-wizard__panel">
            <label>
              Описание
              <textarea
                value={description}
                maxLength={MAX_BRANCH_DESCRIPTION}
                rows={4}
                placeholder="Как работаете и кого ищете"
                autoFocus
                onChange={(event) => setDescription(event.target.value)}
              />
              <span className="gbr__optional">
                {description.length}/{MAX_BRANCH_DESCRIPTION}
              </span>
            </label>
            <TickSlider
              label={`Комиссия с профитов участников: ${percent}%`}
              value={percent}
              min={0}
              max={MAX_PERCENT}
              step={1}
              skipInterval={2}
              onChange={setPercent}
            />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="gbr-wizard__panel">
            <div className="gbr-wizard__review">
              <BranchAvatar
                name={name}
                avatarUrl={avatarUrl || undefined}
                size="lg"
              />
              <div>
                <h2>{name.trim()}</h2>
                <p>{descPreview}</p>
              </div>
            </div>

            <ul className="gbr-confirm">
              <li className={nameOk ? "is-ok" : "is-bad"}>
                <Check size={14} strokeWidth={2.5} />
                <div>
                  <strong>Название</strong>
                  <span>{name.trim() || "не заполнено"}</span>
                </div>
              </li>
              <li className="is-ok">
                <Check size={14} strokeWidth={2.5} />
                <div>
                  <strong>Описание</strong>
                  <span>
                    {description.trim()
                      ? `${description.trim().slice(0, 72)}${description.trim().length > 72 ? "…" : ""}`
                      : "без описания"}
                  </span>
                </div>
              </li>
              <li className="is-ok">
                <Check size={14} strokeWidth={2.5} />
                <div>
                  <strong>Аватар</strong>
                  <span>{avatarUrl ? "загружен" : "монограмма из названия"}</span>
                </div>
              </li>
              <li className="is-ok">
                <Check size={14} strokeWidth={2.5} />
                <div>
                  <strong>Комиссия</strong>
                  <span>{percent}% с профитов участников</span>
                </div>
              </li>
              <li className="is-ok">
                <Check size={14} strokeWidth={2.5} />
                <div>
                  <strong>Роль</strong>
                  <span>Вы станете владельцем · 1 участник</span>
                </div>
              </li>
            </ul>

            <p className="gbr-confirm__hint">
              Проверьте данные. После создания филиал появится в каталоге, а вы
              попадёте в личный кабинет владельца.
            </p>
          </div>
        ) : null}

        {error ? <p className="gbr__error">{error}</p> : null}

        <div className="gbr__actions">
          {step > 1 ? (
            <button
              type="button"
              className="gbr__btn is-ghost"
              onClick={() => {
                setError("");
                setStep((current) => current - 1);
              }}
            >
              <ArrowLeft size={15} strokeWidth={2} />
              Назад
            </button>
          ) : (
            <button type="button" className="gbr__btn is-ghost" onClick={onCancel}>
              Отмена
            </button>
          )}
          {step < 3 ? (
            <button type="button" className="gbr__btn" onClick={next}>
              Далее
              <ArrowRight size={15} strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              className="gbr__btn"
              disabled={!eligible}
              onClick={submit}
            >
              Подтвердить и создать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CatalogSection({
  branches,
  pendingBranchId,
  occupied,
  onJoin,
  onCancel,
  onCreate,
}: {
  branches: BranchRecord[];
  pendingBranchId: string | null;
  occupied: boolean;
  onJoin(id: string): void;
  onCancel(id: string): void;
  onCreate(): void;
}) {
  const hasPendingApplication = pendingBranchId != null;
  const [selectedBranch, setSelectedBranch] = useState<BranchRecord | null>(null);

  function joinState(branch: BranchRecord): "idle" | "pending" | "member" | "owner" {
    if (branch.isOwner) return "owner";
    if (branch.isMember) return "member";
    if (pendingBranchId === branch.id) return "pending";
    return "idle";
  }

  if (!branches.length) {
    return (
      <div className="gbr">
        <EmptyState
          code="404"
          title="Филиалов пока нет"
          description="Ты ещё не состоишь в филиале. Создай свою команду или дождись приглашения. Владелец получает до 10% с профитов участников."
          action={
            <button type="button" className="gbr__btn" onClick={onCreate}>
              <Plus size={16} strokeWidth={2} />
              Создать филиал
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="gbr">
      <header className="gbr__head">
        <div>
          <p className="gbr__kicker">
            <GitBranch size={14} strokeWidth={1.7} />
            Филиалы
          </p>
          <h1>Команды проекта</h1>
          <p>
            {branches.length}{" "}
            {pluralRu(branches.length, "филиал", "филиала", "филиалов")}
            {hasPendingApplication
              ? " · есть активная заявка — отмени её, чтобы подать другую"
              : ""}
          </p>
        </div>
        <button type="button" className="gbr__btn" onClick={onCreate}>
          <Plus size={16} strokeWidth={2} />
          Создать филиал
        </button>
      </header>

      <div className="gbr-grid">
        {branches.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            joinState={joinState(branch)}
            joinLocked={
              occupied || (hasPendingApplication && pendingBranchId !== branch.id)
            }
            onOpen={setSelectedBranch}
            onJoin={onJoin}
            onCancel={onCancel}
          />
        ))}
      </div>
      {selectedBranch ? (
        <BranchDetailModal
          branch={selectedBranch}
          joinState={joinState(selectedBranch)}
          joinLocked={
            occupied ||
            (hasPendingApplication && pendingBranchId !== selectedBranch.id)
          }
          onJoin={onJoin}
          onCancel={onCancel}
          onClose={() => setSelectedBranch(null)}
        />
      ) : null}
    </div>
  );
}

export default function BranchPage({
  profitsUsd: profitsUsdProp = 12840.55,
  canCreate: canCreateProp = true,
  initialBranch = null,
  initialBranches,
  section: sectionProp,
  membership: membershipProp = "none",
  onNavigate,
  onLeave,
  onCreated,
  live = false,
}: {
  profitsUsd?: number;
  canCreate?: boolean;
  initialBranch?: BranchRecord | null;
  initialBranches?: BranchRecord[];
  section?: BranchSection;
  membership?: BranchMembership;
  onNavigate?: (section: string) => void;
  onLeave?: () => void;
  onCreated?: (branch: BranchRecord) => void;
  live?: boolean;
}) {
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState("");
  const [membership, setMembership] = useState<BranchMembership>(membershipProp);
  const [profitsUsd, setProfitsUsd] = useState(profitsUsdProp);
  const [canCreate, setCanCreate] = useState(canCreateProp);
  const [needUsd, setNeedUsd] = useState(MIN_PROFITS);
  const [branches, setBranches] = useState<BranchRecord[]>(() =>
    live ? [] : seedBranches(membershipProp, initialBranches, initialBranch),
  );
  const [creating, setCreating] = useState(false);
  const [pendingBranchId, setPendingBranchId] = useState<string | null>(null);
  const [pendingApplicationId, setPendingApplicationId] = useState<string | null>(
    null,
  );
  const [leftLocally, setLeftLocally] = useState(false);
  const [sectionOverride, setSectionOverride] = useState<BranchSection | null>(
    null,
  );
  const [overviewData, setOverviewData] = useState<BranchOverviewPayload | null>(
    null,
  );
  const [membersData, setMembersData] = useState<BranchMembersPayload | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const shellSection = (): BranchSection | undefined => {
    if (sectionProp) return sectionProp;
    const raw = String(
      (window.WorkerViews as { branchSection?: string } | undefined)
        ?.branchSection || "",
    );
    if (
      raw === "catalog" ||
      raw === "create" ||
      raw === "overview" ||
      raw === "members" ||
      raw === "settings" ||
      raw === "manuals"
    ) {
      return raw;
    }
    return undefined;
  };

  const activeSection = resolveSection(
    creating ? "create" : sectionOverride || shellSection(),
    leftLocally ? "none" : membership,
  );

  const eligible = canCreate;
  const occupied = branches.some((branch) => branch.isOwner || branch.isMember);

  const myBranch = useMemo(() => {
    const owned = branches.find((branch) => branch.isOwner);
    if (owned) return owned;
    return branches.find((branch) => branch.isMember) ?? null;
  }, [branches]);

  const isOwner = Boolean(myBranch?.isOwner);

  async function reloadLive() {
    const [me, catalog] = await Promise.all([
      branchApi.me(true),
      branchApi.catalog(true),
    ]);
    setMembership(me.membership);
    setProfitsUsd(me.create.profitsUsd);
    setCanCreate(me.create.canCreate);
    setNeedUsd(me.create.needUsd || MIN_PROFITS);
    setBranches(catalog.branches);
    setPendingBranchId(catalog.pendingApplication?.branchId ?? null);
    setPendingApplicationId(catalog.pendingApplication?.id ?? null);
    setLeftLocally(false);
    void window.WorkerShell?.refreshBranchNav?.();
    return me;
  }

  useEffect(() => {
    if (!live) return;
    let active = true;
    setLoading(true);
    setError("");
    reloadLive()
      .catch((requestError) => {
        if (!active) return;
        setError(readableBranchError(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [live]);

  useEffect(() => {
    if (!live || !myBranch) {
      setOverviewData(null);
      return;
    }
    if (activeSection !== "overview") return;
    let active = true;
    branchApi
      .overview(true)
      .then((data) => {
        if (!active) return;
        setOverviewData(data);
        setBranches((current) =>
          current.map((branch) =>
            branch.id === data.branch.id ? { ...branch, ...data.branch } : branch,
          ),
        );
      })
      .catch(() => {
        /* keep catalog card stats */
      });
    return () => {
      active = false;
    };
  }, [live, myBranch?.id, activeSection]);

  useEffect(() => {
    if (!live || !myBranch) {
      setMembersData(null);
      return;
    }
    if (activeSection !== "members") return;
    let active = true;
    branchApi
      .members(true)
      .then((data) => {
        if (active) setMembersData(data);
      })
      .catch(() => {
        if (active) setMembersData({ members: [], applications: [], invites: [] });
      });
    return () => {
      active = false;
    };
  }, [live, myBranch?.id, activeSection]);

  function navigate(next: BranchSection) {
    setCreating(false);
    setSectionOverride(next);
    if (live) {
      (window.WorkerViews as { branchSection?: string }).branchSection = next;
      const hash = next === "catalog" ? "#branch" : `#branch/${next}`;
      if (location.hash !== hash) {
        history.replaceState(null, "", hash);
      }
    }
    onNavigate?.(next);
  }

  function openCreate() {
    if (onNavigate) {
      onNavigate("create");
      return;
    }
    if (live) {
      navigate("create");
      return;
    }
    setCreating(true);
  }

  function toastErr(err: unknown) {
    if (window.WorkerToast?.error) window.WorkerToast.error(err);
    else console.error(readableBranchError(err));
  }

  function toastOk(message: string) {
    window.WorkerToast?.success?.(message);
  }

  async function applyToBranch(id: string) {
    if (occupied || pendingBranchId != null || busy) return;
    const target = branches.find((branch) => branch.id === id);
    if (target?.acceptingApplications === false) return;
    if (!live) {
      setPendingBranchId(id);
      return;
    }
    setBusy(true);
    try {
      const app = await branchApi.apply(id);
      setPendingBranchId(app.branchId);
      setPendingApplicationId(app.id);
      toastOk("Заявка отправлена");
    } catch (err) {
      toastErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function cancelApplication(id: string) {
    if (!live) {
      setPendingBranchId((current) => (current === id ? null : current));
      return;
    }
    setBusy(true);
    try {
      await branchApi.cancelApplication(pendingApplicationId || undefined);
      setPendingBranchId(null);
      setPendingApplicationId(null);
      toastOk("Заявка отменена");
    } catch (err) {
      toastErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function createBranch(draft: {
    name: string;
    description: string;
    percent: number;
    avatarUrl: string;
  }) {
    if (!live) {
      const created: BranchRecord = {
        id: `local-${Date.now()}`,
        name: draft.name,
        description: draft.description,
        percent: draft.percent,
        members: 1,
        total: 0,
        profitCount: 0,
        owner: { username: "you", firstName: "Вы" },
        createdAt: new Date().toISOString(),
        avatarUrl: draft.avatarUrl || undefined,
        isOwner: true,
        acceptingApplications: true,
        tone: 0,
      };
      setBranches((current) => [
        created,
        ...current.map((branch) => ({
          ...branch,
          isOwner: false,
          isMember: false,
        })),
      ]);
      setPendingBranchId(null);
      setCreating(false);
      setLeftLocally(false);
      setMembership("owner");
      onCreated?.(created);
      if (onNavigate) onNavigate("overview");
      else setCreating(false);
      return;
    }

    setBusy(true);
    try {
      const created = await branchApi.create(draft);
      await reloadLive();
      setCreating(false);
      navigate("overview");
      onCreated?.(created);
      toastOk("Филиал создан");
    } catch (err) {
      toastErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(patch: Partial<BranchRecord>) {
    if (!myBranch) return;
    if (!live) {
      setBranches((current) =>
        current.map((branch) =>
          branch.id === myBranch.id ? { ...branch, ...patch } : branch,
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const updated = await branchApi.patch(patch);
      setBranches((current) =>
        current.map((branch) =>
          branch.id === updated.id ? { ...branch, ...updated } : branch,
        ),
      );
      toastOk("Настройки сохранены");
    } catch (err) {
      toastErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    if (!myBranch) return;
    if (!live) {
      setBranches((current) =>
        current.map((branch) =>
          branch.id === myBranch.id
            ? { ...branch, isMember: false, isOwner: false }
            : branch,
        ),
      );
      setLeftLocally(true);
      setMembership("none");
      onLeave?.();
      if (onNavigate) onNavigate("catalog");
      return;
    }
    setBusy(true);
    try {
      await branchApi.leave();
      await reloadLive();
      navigate("catalog");
      onLeave?.();
      toastOk("Вы покинули филиал");
    } catch (err) {
      toastErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteBranch() {
    if (!myBranch?.isOwner) return;
    if (!live) {
      setBranches((current) =>
        current.filter((branch) => branch.id !== myBranch.id),
      );
      setLeftLocally(true);
      setMembership("none");
      onLeave?.();
      if (onNavigate) onNavigate("catalog");
      else navigate("catalog");
      toastOk("Филиал удалён");
      return;
    }
    setBusy(true);
    try {
      await branchApi.deleteBranch();
      await reloadLive();
      navigate("catalog");
      onLeave?.();
      toastOk("Филиал удалён");
    } catch (err) {
      toastErr(err);
    } finally {
      setBusy(false);
    }
  }

  if (live && loading) {
    return (
      <div className="gbr">
        <div className="gbr-empty">
          <p className="gbr-hint">Загрузка филиала…</p>
        </div>
      </div>
    );
  }

  if (live && error && !branches.length && !myBranch) {
    return (
      <div className="gbr">
        <EmptyState
          code=""
          title="Не удалось открыть филиал"
          description={error}
          action={
            <button
              type="button"
              className="gbr__btn"
              onClick={() => {
                setLoading(true);
                setError("");
                reloadLive()
                  .catch((requestError) =>
                    setError(readableBranchError(requestError)),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Повторить
            </button>
          }
        />
      </div>
    );
  }

  if (activeSection === "create") {
    return (
      <CreateWizard
        eligible={eligible}
        onCancel={() => {
          setCreating(false);
          if (live) navigate("catalog");
          else if (onNavigate) onNavigate("catalog");
        }}
        onCreate={createBranch}
      />
    );
  }

  if (activeSection === "overview") {
    if (!myBranch) {
      return (
        <CatalogSection
          branches={branches}
          pendingBranchId={pendingBranchId}
          occupied={occupied}
          onJoin={applyToBranch}
          onCancel={cancelApplication}
          onCreate={openCreate}
        />
      );
    }
    return (
      <OverviewPanel
        branch={overviewData?.branch || myBranch}
        isOwner={isOwner}
        onNavigate={navigate}
        onLeave={handleLeave}
        pendingApplications={overviewData?.pendingApplications}
        series={
          overviewData
            ? {
                7: overviewData.series["7"],
                14: overviewData.series["14"],
                30: overviewData.series["30"],
              }
            : undefined
        }
        topWorkers={overviewData?.topWorkers}
      />
    );
  }

  if (activeSection === "members") {
    if (!myBranch) {
      return (
        <CatalogSection
          branches={branches}
          pendingBranchId={pendingBranchId}
          occupied={occupied}
          onJoin={applyToBranch}
          onCancel={cancelApplication}
          onCreate={openCreate}
        />
      );
    }
    return (
      <MembersPanel
        branch={myBranch}
        isOwner={isOwner}
        live={live}
        initialMembers={live ? membersData?.members ?? [] : undefined}
        initialApplications={live ? membersData?.applications ?? [] : undefined}
        initialInvites={live ? [] : undefined}
        onAcceptApplication={
          live
            ? async (id) => {
                await branchApi.acceptApplication(id);
                toastOk("Заявка принята");
                const data = await branchApi.members(true);
                setMembersData(data);
                await reloadLive();
              }
            : undefined
        }
        onRejectApplication={
          live
            ? async (id) => {
                await branchApi.rejectApplication(id);
                toastOk("Заявка отклонена");
              }
            : undefined
        }
        onKickMember={
          live
            ? async (member) => {
                const telegramId = member.telegramId || member.id;
                await branchApi.kick(telegramId);
                toastOk("Участник исключён");
                await reloadLive();
              }
            : undefined
        }
      />
    );
  }

  if (activeSection === "manuals") {
    if (!myBranch) {
      return (
        <CatalogSection
          branches={branches}
          pendingBranchId={pendingBranchId}
          occupied={occupied}
          onJoin={applyToBranch}
          onCancel={cancelApplication}
          onCreate={openCreate}
        />
      );
    }
    return <ManualsPanel canEdit={isOwner} initialManuals={live ? [] : undefined} />;
  }

  if (activeSection === "settings") {
    if (myBranch && isOwner) {
      return (
        <SettingsPanel
          branch={myBranch}
          onSave={saveSettings}
          onDelete={handleDeleteBranch}
          deleting={busy}
        />
      );
    }
    if (myBranch) {
      return (
        <OverviewPanel
          branch={overviewData?.branch || myBranch}
          isOwner={false}
          onNavigate={navigate}
          onLeave={handleLeave}
          pendingApplications={overviewData?.pendingApplications}
          series={
            overviewData
              ? {
                  7: overviewData.series["7"],
                  14: overviewData.series["14"],
                  30: overviewData.series["30"],
                }
              : undefined
          }
          topWorkers={overviewData?.topWorkers}
        />
      );
    }
  }

  return (
    <CatalogSection
      branches={branches}
      pendingBranchId={pendingBranchId}
      occupied={occupied}
      onJoin={applyToBranch}
      onCancel={cancelApplication}
      onCreate={openCreate}
    />
  );
}
