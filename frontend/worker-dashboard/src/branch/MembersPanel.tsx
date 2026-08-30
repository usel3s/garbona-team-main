import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Percent,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { DynamicsChart } from "../components/DynamicsChart";
import { TickSlider } from "../components/ui/tick-slider";
import { KebabMenu, type KebabItem } from "../components/sites/KebabMenu";
import type { BranchRecord } from "../Branch";
import {
  MOCK_APPLICATIONS,
  MOCK_INVITES,
  MOCK_MEMBERS,
  formatUsd,
  makeBranchSeries,
  pluralRu,
} from "./mock";
import {
  ROLE_LABELS,
  type BranchApplication,
  type BranchApplicationStatus,
  type BranchInvite,
  type BranchMemberRole,
  type BranchMemberRow,
} from "./types";
import "./branch-cabinet.css";
import "../dashboard.css";

type ChartPeriod = "7" | "14" | "all";

const ROLE_RANK: Record<BranchMemberRole, number> = {
  owner: 4,
  deputy: 3,
  recruiter: 2,
  member: 1,
};

const PROMOTE: Partial<Record<BranchMemberRole, BranchMemberRole>> = {
  member: "recruiter",
  recruiter: "deputy",
};

const DEMOTE: Partial<Record<BranchMemberRole, BranchMemberRole>> = {
  deputy: "recruiter",
  recruiter: "member",
};

function PersonAvatar({
  name,
  avatarUrl,
  size = "sm",
}: {
  name: string;
  avatarUrl?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const show = Boolean(avatarUrl) && !failed;

  return (
    <div
      className={`gbc-avatar gbc-avatar--${size}`}
      style={
        {
          "--gbr-from": "#06352c",
          "--gbr-to": "#00c48c",
        } as CSSProperties
      }
    >
      {show ? (
        <img src={avatarUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </div>
  );
}

function DetailDrawer({
  title,
  username,
  avatarUrl,
  note,
  daysActive,
  daysLabel,
  series,
  footer,
  statusLabel,
  onClose,
}: {
  title: string;
  username: string;
  avatarUrl?: string;
  note?: string;
  daysActive: number;
  daysLabel: string;
  series: BranchApplication["profitsSeries"];
  footer?: ReactNode;
  statusLabel?: string;
  onClose(): void;
}) {
  const [period, setPeriod] = useState<ChartPeriod>("14");

  return (
    <div className="gbc-overlay" role="dialog" aria-modal="true">
      <div className="gbc-modal gbc-modal--wide gbc-scroll-hidden">
        <div className="gbc-modal__head">
          <div>
            <h2>{title}</h2>
            {statusLabel ? <p className="gbc-modal__status">{statusLabel}</p> : null}
          </div>
          <button type="button" className="gbc-icon-btn" aria-label="Закрыть" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="gbc-drawer__profile">
          <PersonAvatar name={username} avatarUrl={avatarUrl} size="lg" />
          <div>
            <strong>@{username}</strong>
            <small>
              {daysActive} {pluralRu(daysActive, "день", "дня", "дней")} {daysLabel}
            </small>
          </div>
        </div>

        {note ? <p className="gbc-note">{note}</p> : null}

        <div className="gbc-period" role="tablist" aria-label="Период статистики">
          {(
            [
              { id: "7", label: "7 дней" },
              { id: "14", label: "14 дней" },
              { id: "all", label: "Всё" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={period === tab.id ? "is-active" : undefined}
              onClick={() => setPeriod(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="gbd-dashboard gbc-chart-host" style={{ marginTop: 12 }}>
          <DynamicsChart series={series[period]} compact />
        </div>

        {footer}
      </div>
    </div>
  );
}

function PercentModal({
  username,
  value,
  onSave,
  onClose,
}: {
  username: string;
  value: number;
  onSave(next: number): void;
  onClose(): void;
}) {
  const [percent, setPercent] = useState(value);

  return (
    <div className="gbc-overlay" role="dialog" aria-modal="true">
      <div className="gbc-modal" style={{ width: "min(400px, 100%)" }}>
        <div className="gbc-modal__head">
          <h2>Процент · @{username}</h2>
          <button type="button" className="gbc-icon-btn" aria-label="Закрыть" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <TickSlider
          label={`Индивидуальная комиссия: ${percent}%`}
          value={percent}
          min={0}
          max={10}
          step={1}
          skipInterval={2}
          onChange={setPercent}
        />
        <div className="gbc-drawer__actions">
          <button type="button" className="gbc__btn is-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="gbc__btn"
            onClick={() => {
              onSave(percent);
              onClose();
            }}
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function memberSeries(seed: number): BranchApplication["profitsSeries"] {
  return {
    "7": makeBranchSeries(7, seed),
    "14": makeBranchSeries(14, seed + 2),
    all: makeBranchSeries(30, seed + 5),
  };
}

export function MembersPanel({
  branch,
  isOwner,
  viewerRole: viewerRoleProp,
  initialMembers,
  initialApplications,
  initialInvites,
  live = false,
  onAcceptApplication,
  onRejectApplication,
  onKickMember,
}: {
  branch: BranchRecord;
  isOwner: boolean;
  viewerRole?: BranchMemberRole;
  initialMembers?: BranchMemberRow[];
  initialApplications?: BranchApplication[];
  initialInvites?: BranchInvite[];
  live?: boolean;
  onAcceptApplication?(id: string): Promise<void> | void;
  onRejectApplication?(id: string): Promise<void> | void;
  onKickMember?(member: BranchMemberRow): Promise<void> | void;
}) {
  const viewerRole: BranchMemberRole =
    viewerRoleProp ?? (isOwner ? "owner" : "member");

  const canManageApps =
    viewerRole === "owner" ||
    viewerRole === "deputy" ||
    viewerRole === "recruiter";
  const canManageMembers = viewerRole === "owner" || viewerRole === "deputy";
  const canSetPercents = !live && (viewerRole === "owner" || viewerRole === "deputy");
  const canInvite =
    !live &&
    (viewerRole === "owner" ||
      viewerRole === "deputy" ||
      viewerRole === "recruiter");

  const [applications, setApplications] = useState(
    initialApplications ?? MOCK_APPLICATIONS,
  );
  const [appTab, setAppTab] = useState<BranchApplicationStatus>("pending");
  const [members, setMembers] = useState(initialMembers ?? MOCK_MEMBERS);
  const [invites, setInvites] = useState(initialInvites ?? (live ? [] : MOCK_INVITES));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [selectedApp, setSelectedApp] = useState<BranchApplication | null>(null);
  const [statsMember, setStatsMember] = useState<BranchMemberRow | null>(null);
  const [percentMember, setPercentMember] = useState<BranchMemberRow | null>(null);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    if (initialMembers) setMembers(initialMembers);
  }, [initialMembers]);

  useEffect(() => {
    if (initialApplications) setApplications(initialApplications);
  }, [initialApplications]);

  useEffect(() => {
    if (initialInvites) setInvites(initialInvites);
  }, [initialInvites]);

  const filteredApps = applications.filter((item) => item.status === appTab);
  const pendingCount = applications.filter((item) => item.status === "pending").length;
  const pendingInvites = invites.filter((item) => item.status === "pending");

  const statsSeries = useMemo(() => {
    if (!statsMember) return null;
    const seed = Number(statsMember.id.replace(/\D/g, "")) || 40;
    return memberSeries(seed);
  }, [statsMember]);

  async function decide(id: string, accept: boolean) {
    if (busyId) return;
    setBusyId(id);
    try {
      if (accept) await onAcceptApplication?.(id);
      else await onRejectApplication?.(id);
      const now = new Date().toISOString();
      setApplications((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: accept ? "accepted" : "rejected",
                decidedAt: now,
                decidedBy: "@you",
              }
            : item,
        ),
      );
      setSelectedApp(null);
      setAppTab(accept ? "accepted" : "rejected");
    } finally {
      setBusyId("");
    }
  }

  function sendInvite() {
    const username = inviteUsername.replace(/^@/, "").trim().toLowerCase();
    if (username.length < 3) {
      setInviteError("Укажите Telegram username — минимум 3 символа.");
      return;
    }
    if (members.some((m) => m.username.toLowerCase() === username)) {
      setInviteError("Этот пользователь уже в филиале.");
      return;
    }
    if (
      invites.some(
        (item) =>
          item.status === "pending" && item.username.toLowerCase() === username,
      )
    ) {
      setInviteError("Приглашение этому пользователю уже отправлено.");
      return;
    }
    const invite: BranchInvite = {
      id: `inv-${Date.now()}`,
      username,
      invitedBy: "@you",
      invitedAt: new Date().toISOString(),
      status: "pending",
    };
    setInvites((current) => [invite, ...current]);
    setInviteUsername("");
    setInviteError("");
    setInviteOpen(false);
  }

  function cancelInvite(id: string) {
    setInvites((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "cancelled" } : item,
      ),
    );
  }

  function changeRole(id: string, next: BranchMemberRole) {
    if (live) return;
    setMembers((current) =>
      current.map((member) =>
        member.id === id ? { ...member, role: next } : member,
      ),
    );
  }

  async function kick(id: string) {
    const member = members.find((row) => row.id === id);
    if (!member || busyId) return;
    setBusyId(id);
    try {
      await onKickMember?.(member);
      setMembers((current) => current.filter((row) => row.id !== id));
    } finally {
      setBusyId("");
    }
  }

  function kebabFor(member: BranchMemberRow): KebabItem[] {
    const items: KebabItem[] = [
      {
        id: "stats",
        label: "Статистика",
        icon: <BarChart3 size={14} />,
        onSelect: () => setStatsMember(member),
      },
    ];

    // Owner/deputy manage roster — recruiter may accept apps but cannot manage members.
    if (!canManageMembers || member.role === "owner") return items;

    if (!live) {
      const promoteTo = PROMOTE[member.role];
      const demoteTo = DEMOTE[member.role];

      if (promoteTo && ROLE_RANK[viewerRole] > ROLE_RANK[promoteTo]) {
        items.unshift({
          id: "promote",
          label: `Повысить → ${ROLE_LABELS[promoteTo]}`,
          icon: <ArrowUp size={14} />,
          onSelect: () => changeRole(member.id, promoteTo),
        });
      }
      if (demoteTo) {
        items.splice(promoteTo ? 1 : 0, 0, {
          id: "demote",
          label: `Понизить → ${ROLE_LABELS[demoteTo]}`,
          icon: <ArrowDown size={14} />,
          onSelect: () => changeRole(member.id, demoteTo),
        });
      }
      if (canSetPercents) {
        items.push({
          id: "percent",
          label: "Изменить процент",
          icon: <Percent size={14} />,
          onSelect: () => setPercentMember(member),
        });
      }
    }
    items.push({
      id: "kick",
      label: "Выгнать",
      icon: <UserMinus size={14} />,
      danger: true,
      separatorBefore: true,
      onSelect: () => kick(member.id),
    });

    return items;
  }

  return (
    <div className="gbc">
      <header className="gbc__head gbc__head--row">
        <div>
          <p className="gbc__kicker">
            <Users size={14} strokeWidth={1.7} />
            Команда
          </p>
          <h1>Участники</h1>
          <p>
            {branch.name} · {members.length}{" "}
            {pluralRu(members.length, "человек", "человека", "человек")}
            {viewerRole === "recruiter"
              ? " · рекрутер может принимать заявки и приглашать"
              : ""}
          </p>
        </div>
        {canInvite ? (
          <button
            type="button"
            className="gbc__btn"
            onClick={() => {
              setInviteError("");
              setInviteOpen(true);
            }}
          >
            <UserPlus size={15} strokeWidth={2} />
            Пригласить
          </button>
        ) : null}
      </header>

      {canInvite && pendingInvites.length > 0 ? (
        <section style={{ marginBottom: 22 }}>
          <div className="gbc-apps__head">
            <h2>Приглашения</h2>
            <span>{pendingInvites.length}</span>
          </div>
          <div className="gbc-list" style={{ marginTop: 12 }}>
            {pendingInvites.map((invite) => (
              <article key={invite.id} className="gbc-row is-static">
                <PersonAvatar name={invite.username} avatarUrl={invite.avatarUrl} />
                <div className="gbc-row__meta">
                  <strong>@{invite.username}</strong>
                  <small>
                    от {invite.invitedBy} ·{" "}
                    {new Date(invite.invitedAt).toLocaleDateString("ru-RU")}
                  </small>
                </div>
                <span className="gbc-chip is-accent">Ожидает</span>
                <button
                  type="button"
                  className="gbc__btn is-ghost is-sm"
                  onClick={() => cancelInvite(invite.id)}
                >
                  Отменить
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {canManageApps ? (
        <section style={{ marginBottom: 22 }}>
          <div className="gbc-apps__head">
            <h2>Заявки</h2>
            <span>{pendingCount}</span>
          </div>
          <div className="gbc-period" role="tablist" aria-label="Статус заявок">
            {(
              [
                { id: "pending", label: "Новые" },
                { id: "accepted", label: "Принятые" },
                { id: "rejected", label: "Отклонённые" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={appTab === tab.id ? "is-active" : undefined}
                onClick={() => setAppTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {filteredApps.length === 0 ? (
            <p className="gbc-note" style={{ marginTop: 12 }}>
              {appTab === "pending"
                ? `Новых заявок нет. Заявки: ${
                    branch.acceptingApplications === false
                      ? "закрыты"
                      : "открыты"
                  }.`
                : appTab === "accepted"
                  ? "Пока нет принятых заявок."
                  : "Пока нет отклонённых заявок."}
            </p>
          ) : (
            <div className="gbc-list" style={{ marginTop: 12 }}>
              {filteredApps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  className="gbc-row"
                  onClick={() => setSelectedApp(app)}
                >
                  <PersonAvatar name={app.username} avatarUrl={app.avatarUrl} />
                  <div className="gbc-row__meta">
                    <strong>@{app.username}</strong>
                    <small>
                      {app.status === "pending"
                        ? app.note
                        : `${app.decidedBy || "—"} · ${
                            app.decidedAt
                              ? new Date(app.decidedAt).toLocaleDateString("ru-RU")
                              : "—"
                          }`}
                    </small>
                  </div>
                  <div className="gbc-row__profits">{formatUsd(app.profitsTotal)}</div>
                  {app.status !== "pending" ? (
                    <span
                      className={`gbc-chip${
                        app.status === "accepted" ? " is-accent" : ""
                      }`}
                    >
                      {app.status === "accepted" ? "Принята" : "Отклонена"}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <div className="gbc-list">
        {members.map((member) => {
          const items = kebabFor(member);
          return (
            <article key={member.id} className="gbc-row is-static">
              <PersonAvatar name={member.username} avatarUrl={member.avatarUrl} />
              <div className="gbc-row__meta">
                <strong>@{member.username}</strong>
                <small>
                  {member.joinedDays}{" "}
                  {pluralRu(member.joinedDays, "день", "дня", "дней")} в команде
                  {member.percentOverride != null
                    ? ` · ${member.percentOverride}%`
                    : ""}
                </small>
              </div>
              <div className="gbc-row__profits">{formatUsd(member.profits)}</div>
              <span
                className={`gbc-chip${member.role === "owner" ? " is-accent" : " is-own"}`}
              >
                {ROLE_LABELS[member.role]}
              </span>
              {items.length ? (
                <KebabMenu items={items} label={`Действия · @${member.username}`} />
              ) : null}
            </article>
          );
        })}
      </div>

      {selectedApp ? (
        <DetailDrawer
          title="Заявка"
          username={selectedApp.username}
          avatarUrl={selectedApp.avatarUrl}
          note={selectedApp.note}
          daysActive={selectedApp.daysActive}
          daysLabel="на платформе"
          series={selectedApp.profitsSeries}
          statusLabel={
            selectedApp.status === "pending"
              ? undefined
              : selectedApp.status === "accepted"
                ? `Принята ${selectedApp.decidedBy || ""}`.trim()
                : `Отклонена ${selectedApp.decidedBy || ""}`.trim()
          }
          onClose={() => setSelectedApp(null)}
          footer={
            selectedApp.status === "pending" ? (
              <div className="gbc-drawer__actions">
                <button
                  type="button"
                  className="gbc__btn is-ghost"
                  onClick={() => decide(selectedApp.id, false)}
                >
                  Отклонить
                </button>
                <button
                  type="button"
                  className="gbc__btn"
                  onClick={() => decide(selectedApp.id, true)}
                >
                  Принять
                </button>
              </div>
            ) : null
          }
        />
      ) : null}

      {statsMember && statsSeries ? (
        <DetailDrawer
          title="Статистика"
          username={statsMember.username}
          avatarUrl={statsMember.avatarUrl}
          daysActive={statsMember.joinedDays}
          daysLabel="в команде"
          series={statsSeries}
          onClose={() => setStatsMember(null)}
        />
      ) : null}

      {percentMember ? (
        <PercentModal
          username={percentMember.username}
          value={percentMember.percentOverride ?? branch.percent}
          onClose={() => setPercentMember(null)}
          onSave={(next) => {
            setMembers((current) =>
              current.map((member) =>
                member.id === percentMember.id
                  ? { ...member, percentOverride: next }
                  : member,
              ),
            );
          }}
        />
      ) : null}

      {inviteOpen ? (
        <div className="gbc-overlay" role="dialog" aria-modal="true" aria-labelledby="invite-title">
          <div className="gbc-modal" style={{ width: "min(400px, 100%)" }}>
            <div className="gbc-modal__head">
              <h2 id="invite-title">Пригласить в филиал</h2>
              <button
                type="button"
                className="gbc-icon-btn"
                aria-label="Закрыть"
                onClick={() => setInviteOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="gbc-note" style={{ marginTop: 0 }}>
              Введите Telegram username. Приглашённый войдёт в филиал без заявки из
              каталога.
            </p>
            <label className="gbc-field">
              <span>Username</span>
              <input
                value={inviteUsername}
                onChange={(event) => {
                  setInviteUsername(event.target.value);
                  setInviteError("");
                }}
                placeholder="@username"
                autoComplete="off"
                autoFocus
              />
            </label>
            {inviteError ? <p className="gbc-field__error">{inviteError}</p> : null}
            <div className="gbc-drawer__actions">
              <button
                type="button"
                className="gbc__btn is-ghost"
                onClick={() => setInviteOpen(false)}
              >
                Отмена
              </button>
              <button type="button" className="gbc__btn" onClick={sendInvite}>
                Отправить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
