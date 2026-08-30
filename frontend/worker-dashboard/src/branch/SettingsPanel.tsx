import { useState } from "react";
import {
  AlertTriangle,
  Bell,
  FileText,
  Globe,
  LayoutGrid,
  Plus,
  ScrollText,
  Settings2,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Switch } from "../components/ui/switch";
import { AvatarFileUpload } from "../components/ui/file-upload-1";
import { TickSlider } from "../components/ui/tick-slider";
import { AddDomainDialog } from "../components/sites/AddDomainDialog";
import { ConfirmDialog } from "../components/sites/ConfirmDialog";
import type { DomainCreatePayload } from "../sitesTypes";
import type { BranchRecord } from "../Branch";
import {
  AUDIT_EVENTS,
  BRANCH_DOMAINS,
  BRANCH_TEMPLATES,
  CUSTOM_ROLES,
  formatShortDate,
} from "./mock";
import {
  MAX_BRANCH_DESCRIPTION,
  PERMISSION_FLAGS,
  type CustomRole,
} from "./types";
import "./branch-cabinet.css";
import "../sites.css";

const MAX_PERCENT = 10;

const TABS = [
  { id: "general", title: "Общее", icon: LayoutGrid },
  { id: "roles", title: "Роли", icon: Shield },
  { id: "domain", title: "Домен", icon: Globe },
  { id: "templates", title: "Шаблоны", icon: FileText },
  { id: "audit", title: "Аудит", icon: ScrollText },
  { id: "notifications", title: "Уведомления", icon: Bell },
  { id: "danger", title: "Опасная зона", icon: AlertTriangle },
] as const;

type SettingsTab = (typeof TABS)[number]["id"];
type AuditFilter = "all" | "members" | "roles" | "apps";

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
  onChange(next: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className="gbr-set__switch">
      <div>
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        label={title}
      />
    </div>
  );
}

export function SettingsPanel({
  branch,
  onSave,
  onDelete,
  deleting = false,
}: {
  branch: BranchRecord;
  onSave(next: Partial<BranchRecord>): void;
  onDelete?(): void;
  deleting?: boolean;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [name, setName] = useState(branch.name);
  const [description, setDescription] = useState(branch.description);
  const [percent, setPercent] = useState(branch.percent);
  const [avatarUrl, setAvatarUrl] = useState(branch.avatarUrl || "");
  const [accepting, setAccepting] = useState(branch.acceptingApplications !== false);
  const [autoKick, setAutoKick] = useState(true);
  const [autoKickDays, setAutoKickDays] = useState(14);
  const [saved, setSaved] = useState(false);

  const [roles, setRoles] = useState<CustomRole[]>(CUSTOM_ROLES);
  const [newRoleName, setNewRoleName] = useState("");
  const [newPerms, setNewPerms] = useState<string[]>([]);

  const [domains, setDomains] = useState(BRANCH_DOMAINS);
  const [addDomainOpen, setAddDomainOpen] = useState(false);
  const [addDomainBusy, setAddDomainBusy] = useState(false);

  const [templates, setTemplates] = useState(BRANCH_TEMPLATES);
  const [editingTpl, setEditingTpl] = useState<string | null>(null);
  const [previewTpl, setPreviewTpl] = useState<string | null>(null);
  const [tplTitle, setTplTitle] = useState("");
  const [tplSlug, setTplSlug] = useState("");
  const [tplHtml, setTplHtml] = useState("");

  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");

  const [notifyApp, setNotifyApp] = useState(true);
  const [notifyLeft, setNotifyLeft] = useState(true);
  const [notifyNs, setNotifyNs] = useState(true);
  const [notifyDigest, setNotifyDigest] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const nameOk = name.trim().length >= 2 && name.trim().length <= 32;
  const descLen = description.length;

  function saveGeneral() {
    if (!nameOk) return;
    onSave({
      name: name.trim(),
      description: description.trim().slice(0, MAX_BRANCH_DESCRIPTION),
      percent,
      avatarUrl: avatarUrl.trim() || undefined,
      acceptingApplications: accepting,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  function togglePerm(id: string) {
    setNewPerms((current) =>
      current.includes(id) ? current.filter((p) => p !== id) : [...current, id],
    );
  }

  function createRole() {
    const trimmed = newRoleName.trim();
    if (!trimmed) return;
    setRoles((current) => [
      ...current,
      {
        id: `role-${Date.now()}`,
        name: trimmed,
        locked: false,
        permissions: [...newPerms],
      },
    ]);
    setNewRoleName("");
    setNewPerms([]);
  }

  function deleteRole(id: string) {
    setRoles((current) => {
      const target = current.find((role) => role.id === id);
      if (!target || target.locked) return current;
      return current.filter((role) => role.id !== id);
    });
  }

  async function prepareBranchDomain(domain: string) {
    await new Promise((resolve) => window.setTimeout(resolve, 280));
    const host = domain.trim().toLowerCase();
    if (domains.some((item) => item.host === host)) {
      throw new Error("Этот домен уже добавлен в филиал.");
    }
    return {
      ip: "192.162.199.140",
      ns: ["darwin.ns.cloudflare.com", "maeve.ns.cloudflare.com"],
    };
  }

  async function submitBranchDomain(payload: DomainCreatePayload) {
    setAddDomainBusy(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      const host = payload.domain.trim().toLowerCase();
      if (domains.some((item) => item.host === host)) {
        throw new Error("Этот домен уже добавлен в филиал.");
      }
      setDomains((current) => [
        ...current,
        {
          id: `d-${Date.now()}`,
          host,
          status: "pending_ns",
        },
      ]);
    } finally {
      setAddDomainBusy(false);
    }
  }

  function startEditTemplate(id: string | null) {
    if (!id) {
      setEditingTpl("new");
      setTplTitle("");
      setTplSlug("");
      setTplHtml(
        `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8" /><title>Template</title></head>\n<body></body>\n</html>`,
      );
      return;
    }
    const tpl = templates.find((item) => item.id === id);
    if (!tpl) return;
    setEditingTpl(id);
    setTplTitle(tpl.title);
    setTplSlug(tpl.slug);
    setTplHtml(tpl.html);
  }

  function saveTemplate() {
    const title = tplTitle.trim();
    const slug = tplSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!title || !slug) return;
    const updatedAt = new Date().toISOString().slice(0, 10);
    if (editingTpl === "new") {
      setTemplates((current) => [
        ...current,
        {
          id: `tpl-${Date.now()}`,
          title,
          slug,
          html: tplHtml,
          updatedAt,
        },
      ]);
    } else if (editingTpl) {
      setTemplates((current) =>
        current.map((item) =>
          item.id === editingTpl
            ? { ...item, title, slug, html: tplHtml, updatedAt }
            : item,
        ),
      );
    }
    setEditingTpl(null);
  }

  const previewHtml =
    templates.find((item) => item.id === previewTpl)?.html ||
    (editingTpl ? tplHtml : "");


  const filteredAudit =
    auditFilter === "all"
      ? AUDIT_EVENTS
      : AUDIT_EVENTS.filter((event) => event.category === auditFilter);

  return (
    <div className="gbr-set">
      <header className="gbr-set__head">
        <p className="gbc__kicker">
          <Settings2 size={14} strokeWidth={1.7} />
          Филиал
        </p>
        <h1>Настройки</h1>
        <p>Общее, роли, домен, HTML-шаблоны и аудит команды</p>
      </header>

      <div className="gbr-set__layout">
        <nav className="gbr-set__nav" aria-label="Разделы настроек филиала">
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

        <div className="gbr-set__panel">
          {tab === "general" ? (
            <>
              <h2>Общее</h2>
              <p className="gbr-set__lead">
                Имя, описание, аватар, комиссия и приём заявок
              </p>
              <div className="gbr-set__card">
                <label>
                  Название
                  <input
                    value={name}
                    maxLength={32}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label>
                  Описание
                  <textarea
                    value={description}
                    maxLength={MAX_BRANCH_DESCRIPTION}
                    rows={4}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                  <span className="gbc-char">
                    {descLen}/{MAX_BRANCH_DESCRIPTION}
                  </span>
                </label>
                <div className="gbc-field">
                  <span className="gbc-field__label">Аватар</span>
                  <AvatarFileUpload
                    value={avatarUrl}
                    onChange={({ url }) => setAvatarUrl(url)}
                  />
                </div>
                <TickSlider
                  label={`Комиссия: ${percent}%`}
                  value={percent}
                  min={0}
                  max={MAX_PERCENT}
                  step={1}
                  skipInterval={2}
                  onChange={setPercent}
                />
                <ToggleRow
                  title="Закрыть заявки"
                  hint="Воркеры не смогут подать заявку в ваш филиал из каталога"
                  checked={!accepting}
                  onChange={(closed) => setAccepting(!closed)}
                />
                <ToggleRow
                  title="Автокик неактивных"
                  hint={`Исключать участников без активности через ${autoKickDays} ${autoKickDays === 1 ? "день" : autoKickDays < 5 ? "дня" : "дней"}`}
                  checked={autoKick}
                  onChange={setAutoKick}
                />
                {autoKick ? (
                  <TickSlider
                    label={`Порог неактивности: ${autoKickDays} дн.`}
                    value={autoKickDays}
                    min={7}
                    max={30}
                    step={1}
                    skipInterval={7}
                    onChange={setAutoKickDays}
                  />
                ) : null}
                <p className="gbr-set__lead">
                  Покинуть филиал может только участник. Передача владения — в
                  опасной зоне.
                </p>
                <button
                  type="button"
                  className="gbc__btn"
                  disabled={!nameOk}
                  onClick={saveGeneral}
                >
                  {saved ? "Сохранено" : "Сохранить"}
                </button>
              </div>
            </>
          ) : null}

          {tab === "roles" ? (
            <>
              <h2>Роли</h2>
              <p className="gbr-set__lead">
                Права доступа. Системные роли нельзя удалить — только созданные
                вами. Рекрутер принимает заявки, но не может выгнать владельца.
              </p>
              <div className="gbr-set__card">
                <div className="gbr-set__roles">
                  {roles.map((role) => (
                    <div key={role.id} className="gbr-set__role">
                      <div>
                        <strong>
                          {role.name}
                          {role.locked ? " · системная" : ""}
                        </strong>
                        <small>
                          {role.permissions.length
                            ? role.permissions
                                .map(
                                  (perm) =>
                                    PERMISSION_FLAGS.find((flag) => flag.id === perm)
                                      ?.label || perm,
                                )
                                .join(", ")
                            : "Без особых прав"}
                        </small>
                      </div>
                      <div className="gbr-set__role-aside">
                        {role.locked ? (
                          <span className="gbc-chip is-accent">Locked</span>
                        ) : (
                          <>
                            <span className="gbc-chip">
                              {role.permissions.length} прав
                            </span>
                            <button
                              type="button"
                              className="gbc__btn is-ghost is-sm gbr-set__role-del"
                              aria-label={`Удалить роль ${role.name}`}
                              onClick={() => deleteRole(role.id)}
                            >
                              <Trash2 size={14} />
                              Удалить
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="gbr-set__card gbr-set__role-create">
                <h2>Новая роль</h2>
                <p className="gbr-set__lead">
                  Название и набор прав. Права можно комбинировать.
                </p>
                <label>
                  Название
                  <input
                    value={newRoleName}
                    maxLength={32}
                    placeholder="Например, Модератор"
                    onChange={(event) => setNewRoleName(event.target.value)}
                  />
                </label>
                <div className="gbr-set__perm-list" role="group" aria-label="Права роли">
                  {PERMISSION_FLAGS.map((flag) => {
                    const on = newPerms.includes(flag.id);
                    return (
                      <div
                        key={flag.id}
                        className={`gbr-set__perm${on ? " is-on" : ""}`}
                      >
                        <button
                          type="button"
                          className="gbr-set__perm-copy"
                          onClick={() => togglePerm(flag.id)}
                        >
                          <strong>{flag.label}</strong>
                          <small>{flag.id}</small>
                        </button>
                        <Switch
                          checked={on}
                          onCheckedChange={() => togglePerm(flag.id)}
                          label={flag.label}
                        />
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="gbc__btn"
                  disabled={!newRoleName.trim()}
                  onClick={createRole}
                >
                  <Users size={14} />
                  Создать роль
                </button>
              </div>
            </>
          ) : null}

          {tab === "domain" ? (
            <>
              <h2>Домен</h2>
              <p className="gbr-set__lead">
                Командные домены видны только участникам филиала. Добавление — тот
                же мастер, что и в разделе сайтов: имя, способ привязки, IP/NS.
              </p>
              <div className="gbr-set__card">
                {domains.length ? (
                  <div className="gbr-set__roles">
                    {domains.map((domain) => (
                      <div key={domain.id} className="gbr-set__role">
                        <div>
                          <strong>{domain.host}</strong>
                          <small>
                            {domain.status === "active"
                              ? "Активен"
                              : domain.status === "pending_ns"
                                ? "Ожидает NS"
                                : "Пауза"}
                          </small>
                        </div>
                        <span
                          className={`gbc-chip${
                            domain.status === "active" ? " is-accent" : ""
                          }`}
                        >
                          {domain.status === "pending_ns" ? "NS" : domain.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="gbr-set__lead" style={{ margin: 0 }}>
                    Пока нет доменов филиала.
                  </p>
                )}
                <button
                  type="button"
                  className="gbc__btn"
                  style={{ marginTop: 14 }}
                  onClick={() => setAddDomainOpen(true)}
                >
                  <Plus size={15} strokeWidth={2} />
                  Добавить домен
                </button>
              </div>
              <AddDomainDialog
                open={addDomainOpen}
                busy={addDomainBusy}
                onClose={() => setAddDomainOpen(false)}
                onPrepare={prepareBranchDomain}
                onSubmit={submitBranchDomain}
              />
            </>
          ) : null}

          {tab === "templates" ? (
            <>
              <h2>Шаблоны доменов</h2>
              <p className="gbr-set__lead">
                HTML-страницы только для доменов филиала. Превью ниже — как увидит
                пользователь.
              </p>
              <div className="gbr-set__tpl">
                {templates.map((tpl) => (
                  <article key={tpl.id} className="gbr-set__tpl-card is-html">
                    <div className="gbr-set__tpl-preview">
                      <iframe
                        title={`preview-${tpl.slug}`}
                        srcDoc={tpl.html}
                        sandbox=""
                        loading="lazy"
                      />
                    </div>
                    <div>
                      <strong>{tpl.title}</strong>
                      <small>
                        /{tpl.slug} · обновлён {tpl.updatedAt}
                      </small>
                      <div className="gbr-set__tpl-actions">
                        <button
                          type="button"
                          className="gbc__btn is-ghost is-sm"
                          onClick={() => setPreviewTpl(tpl.id)}
                        >
                          Превью
                        </button>
                        <button
                          type="button"
                          className="gbc__btn is-ghost is-sm"
                          onClick={() => startEditTemplate(tpl.id)}
                        >
                          Редактировать
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="gbc__btn is-ghost"
                  onClick={() => startEditTemplate(null)}
                >
                  Добавить HTML-шаблон
                </button>
              </div>
              {editingTpl ? (
                <div className="gbr-set__card">
                  <label>
                    Название
                    <input
                      value={tplTitle}
                      maxLength={64}
                      onChange={(event) => setTplTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    Slug (путь на домене)
                    <input
                      value={tplSlug}
                      maxLength={48}
                      placeholder="steam-login"
                      onChange={(event) => setTplSlug(event.target.value)}
                    />
                  </label>
                  <label>
                    HTML
                    <textarea
                      value={tplHtml}
                      rows={12}
                      spellCheck={false}
                      className="gbr-set__code"
                      onChange={(event) => setTplHtml(event.target.value)}
                    />
                  </label>
                  <div className="gbr-set__tpl-live">
                    <span>Живое превью</span>
                    <iframe
                      title="live-preview"
                      srcDoc={tplHtml}
                      sandbox=""
                      loading="lazy"
                    />
                  </div>
                  <div className="gbc-drawer__actions">
                    <button
                      type="button"
                      className="gbc__btn is-ghost"
                      onClick={() => setEditingTpl(null)}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      className="gbc__btn"
                      disabled={!tplTitle.trim() || !tplSlug.trim()}
                      onClick={saveTemplate}
                    >
                      Сохранить шаблон
                    </button>
                  </div>
                </div>
              ) : null}
              {previewTpl && !editingTpl ? (
                <div className="gbc-overlay" role="dialog" aria-modal="true">
                  <div className="gbc-modal gbc-modal--wide gbc-scroll-hidden">
                    <div className="gbc-modal__head">
                      <h2>Превью шаблона</h2>
                      <button
                        type="button"
                        className="gbc-icon-btn"
                        aria-label="Закрыть"
                        onClick={() => setPreviewTpl(null)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <iframe
                      className="gbr-set__tpl-frame"
                      title="template-preview"
                      srcDoc={previewHtml}
                      sandbox=""
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === "audit" ? (
            <>
              <h2>Аудит</h2>
              <p className="gbr-set__lead">История действий в филиале</p>
              <div className="gbr-set__filters" role="tablist">
                {(
                  [
                    { id: "all", label: "Все" },
                    { id: "members", label: "Состав" },
                    { id: "roles", label: "Роли" },
                    { id: "apps", label: "Заявки" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={auditFilter === item.id ? "is-active" : undefined}
                    onClick={() => setAuditFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="gbr-set__card">
                <div className="gbr-set__audit">
                  {filteredAudit.map((event) => (
                    <div key={event.id} className="gbr-set__audit-item">
                      <strong>
                        {event.actor} · {event.action}
                        {event.target ? ` · ${event.target}` : ""}
                      </strong>
                      <small>
                        {formatShortDate(event.at)}
                        {event.detail ? ` · ${event.detail}` : ""}
                      </small>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {tab === "notifications" ? (
            <>
              <h2>Уведомления</h2>
              <p className="gbr-set__lead">Что присылать владельцу и замам</p>
              <div className="gbr-set__card">
                <ToggleRow
                  title="Новая заявка"
                  hint="Когда воркер подаёт заявку в филиал"
                  checked={notifyApp}
                  onChange={setNotifyApp}
                />
                <ToggleRow
                  title="Участник покинул"
                  hint="Выход из команды или автокик"
                  checked={notifyLeft}
                  onChange={setNotifyLeft}
                />
                <ToggleRow
                  title="Смена NS домена"
                  hint="Если у командного домена изменились NS-записи"
                  checked={notifyNs}
                  onChange={setNotifyNs}
                />
                <ToggleRow
                  title="Ежедневный дайджест"
                  hint="Сводка профитов и заявок за сутки"
                  checked={notifyDigest}
                  onChange={setNotifyDigest}
                />
              </div>
            </>
          ) : null}

          {tab === "danger" ? (
            <>
              <h2>Опасная зона</h2>
              <p className="gbr-set__lead">Необратимые действия с филиалом</p>
              <div className="gbr-set__card gbr-set__danger">
                <ToggleRow
                  title="Передать владение"
                  hint="Выберите нового владельца. Пока недоступно в превью."
                  checked={false}
                  disabled
                  onChange={() => undefined}
                />
                <button type="button" className="gbc__btn is-ghost" disabled>
                  Передать владение
                </button>
                <button
                  type="button"
                  className="gbc__btn is-danger-ghost"
                  disabled={deleting || !onDelete}
                  onClick={() => setDeleteOpen(true)}
                >
                  {deleting ? "Удаляем…" : "Удалить филиал"}
                </button>
              </div>
              <ConfirmDialog
                open={deleteOpen}
                title="Удалить филиал?"
                message={`Филиал «${branch.name}» будет закрыт. Участники потеряют доступ, заявки отклонятся. Это нельзя отменить.`}
                confirmLabel="Удалить филиал"
                cancelLabel="Отмена"
                onCancel={() => setDeleteOpen(false)}
                onConfirm={() => {
                  setDeleteOpen(false);
                  onDelete?.();
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
