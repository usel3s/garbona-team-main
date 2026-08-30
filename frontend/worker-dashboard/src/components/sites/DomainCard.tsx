import {
  banStatusText,
  formatBanCheckedAt,
  formatShortDateTime,
  linkDisplayUrl,
  safeSiteStats,
  windowTypeLabel,
} from "../../sitesUtils";
import { sitesText } from "../../sitesCopy";
import type { DomainBanChecks, SiteDomain, SiteLink } from "../../sitesTypes";
import {
  Calendar,
  Check,
  ChevronRight,
  Cloud,
  Eye,
  Globe2,
  Link2,
  MoreVertical,
  MousePointer2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { KebabMenu } from "./KebabMenu";

function BanIcon({
  type,
  label,
  banChecks,
}: {
  type: "google" | "cloudflare" | "whois";
  label: string;
  banChecks?: DomainBanChecks;
}) {
  const check = banChecks?.[type];
  const banned = check?.banned === true;
  const ok = check?.clean === true || check?.banned === false;

  return (
    <span
      className={`gbs-mark${banned ? " is-bad" : ok ? " is-ok" : ""}`}
      title={label}
      tabIndex={0}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {type === "google" ? (
        <span className="gbs-mark__g" aria-hidden="true">
          G
        </span>
      ) : type === "cloudflare" ? (
        banned ? (
          <Cloud size={12} aria-hidden="true" />
        ) : (
          <Cloud size={12} aria-hidden="true" />
        )
      ) : banned ? (
        <ShieldAlert size={12} aria-hidden="true" />
      ) : (
        <ShieldCheck size={12} aria-hidden="true" />
      )}
      <span className="gbs-mark__tip" role="tooltip">
        <strong>{label}</strong>
        <span>
          {sitesText("banStatus")} {banStatusText(type, check)}
        </span>
        <span>
          {sitesText("banChecked")} {formatBanCheckedAt(banChecks)}
        </span>
      </span>
    </span>
  );
}

function BanChip({
  type,
  label,
  banChecks,
}: {
  type: "google" | "cloudflare" | "whois";
  label: string;
  banChecks?: DomainBanChecks;
}) {
  const check = banChecks?.[type];
  const banned = check?.banned === true;
  const ok = check?.clean === true || check?.banned === false;

  return (
    <span
      className={`gbs-chip${banned ? " is-bad" : ok ? " is-ok" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {type === "google" ? (
        <span className="gbs-chip__mark" aria-hidden="true">
          G
        </span>
      ) : banned ? (
        <ShieldAlert size={12} aria-hidden="true" />
      ) : (
        <ShieldCheck size={12} aria-hidden="true" />
      )}
      <span>{label}</span>
      <span className="gbs-chip__tip" role="tooltip">
        <strong>{label}</strong>
        <span>
          {sitesText("banStatus")} {banStatusText(type, check)}
        </span>
        <span>
          {sitesText("banChecked")} {formatBanCheckedAt(banChecks)}
        </span>
      </span>
    </span>
  );
}

export function DomainCard({
  domain,
  onOpen,
  onDelete,
}: {
  domain: SiteDomain;
  onOpen(id: number): void;
  onDelete?(domain: SiteDomain): void;
}) {
  const stats = safeSiteStats(domain);
  const hasLinks = Number(domain.linksCount || 0) > 0;
  const live = !domain.isPaused;

  return (
    <article
      className={`gbs-site${domain.isPaused ? " is-paused" : ""}`}
      tabIndex={0}
      role="button"
      aria-label={domain.domain}
      onClick={() => onOpen(domain.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(domain.id);
        }
      }}
    >
      <header className="gbs-site__top">
        <h3>{domain.domain}</h3>
        <div className="gbs-site__badges">
          {domain.isPaused ? (
            <span className="gbs-pill is-stop">{sitesText("paused")}</span>
          ) : domain.isTeamPublic ? (
            <span className="gbs-pill is-team">{sitesText("team")}</span>
          ) : domain.isOwn ? (
            <span className="gbs-pill is-own">{sitesText("own")}</span>
          ) : live ? (
            <span className="gbs-pill is-live">{sitesText("filterActive")}</span>
          ) : null}

          <span className="gbs-mark is-links" title={sitesText("linksCount")}>
            <Link2 size={11} aria-hidden="true" />
            <em>{domain.linksCount || 0}</em>
          </span>

          {domain.isOwn ? (
            <span className="gbs-mark" title={sitesText("own")}>
              <Globe2 size={12} aria-hidden="true" />
            </span>
          ) : null}

          <BanIcon type="cloudflare" label="Cloudflare" banChecks={domain.banChecks} />
          <BanIcon type="google" label="Google" banChecks={domain.banChecks} />
        </div>
      </header>

      <div className="gbs-site__meta">
        <span>
          <Calendar size={12} aria-hidden="true" />
          {formatShortDateTime(domain.createdAt)}
        </span>
        <span title={sitesText("views")}>
          <Eye size={12} aria-hidden="true" />
          {stats.views}
        </span>
        <span title={sitesText("clicks")}>
          <MousePointer2 size={12} aria-hidden="true" />
          {stats.clicks}
        </span>
        <span title={sitesText("auths")}>
          <UserRound size={12} aria-hidden="true" />
          {stats.auths}
        </span>
        <span title={sitesText("validLogs")}>
          <Check size={12} aria-hidden="true" />
          {stats.logs}
        </span>
      </div>

      <footer className="gbs-site__foot">
        <button
          type="button"
          className="gbs-site__cta"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(domain.id);
          }}
        >
          {hasLinks ? (
            <>
              {sitesText("openLinks")}
              <ChevronRight size={14} aria-hidden="true" />
            </>
          ) : (
            <>
              <Plus size={14} aria-hidden="true" />
              {sitesText("createLink")}
            </>
          )}
        </button>
        {domain.isOwn && onDelete ? (
          <div onClick={(event) => event.stopPropagation()}>
            <KebabMenu
              label={sitesText("domainMenu")}
              items={[
                {
                  id: "delete",
                  label: sitesText("deleteDomain"),
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: () => onDelete(domain),
                },
              ]}
            />
          </div>
        ) : (
          <button
            type="button"
            className="gbs-site__more"
            aria-label={sitesText("openDomain")}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(domain.id);
            }}
          >
            <MoreVertical size={15} aria-hidden="true" />
          </button>
        )}
      </footer>
    </article>
  );
}

export function DomainGrid({
  domains,
  onOpen,
  onDelete,
}: {
  domains: SiteDomain[];
  onOpen(id: number): void;
  onDelete?(domain: SiteDomain): void;
}) {
  if (!domains.length) {
    return (
      <div className="gbs-empty">
        <strong>{sitesText("emptyFiltered")}</strong>
      </div>
    );
  }

  return (
    <div className="gbs-site-grid">
      {domains.map((domain) => (
        <DomainCard
          domain={domain}
          key={domain.id}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function BanCheckTools({ banChecks }: { banChecks?: DomainBanChecks }) {
  return (
    <div className="gbs-card__chips">
      <BanChip type="whois" label="Whois" banChecks={banChecks} />
      <BanChip type="cloudflare" label="Cloudflare" banChecks={banChecks} />
      <BanChip type="google" label="Google" banChecks={banChecks} />
    </div>
  );
}

export function LinkRow({
  link,
  domainName,
  domainPaused,
  onEdit,
  onDelete,
}: {
  link: SiteLink;
  domainName: string;
  domainPaused: boolean;
  onEdit(link: SiteLink): void;
  onDelete(link: SiteLink): void;
}) {
  const url = linkDisplayUrl(link, domainName);
  const stats = safeSiteStats(link);

  return (
    <tr>
      <td>
        <a
          className="gbs-link-url"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {url}
        </a>
        <div className="gbs-link-sub">
          {link.templateName || link.template || "—"}
          {link.id ? ` · #${link.id}` : ""}
        </div>
        <div className="gbs-link-flags">
          {link.isPaused ? (
            <span className="gbs-flag gbs-flag--warn">{sitesText("linkPaused")}</span>
          ) : null}
          {link.iframe ? (
            <span className="gbs-flag">{sitesText("badgeIframe")}</span>
          ) : null}
        </div>
      </td>
      <td>{windowTypeLabel(link.windowType)}</td>
      <td className="gbs-td-num">{stats.views}</td>
      <td className="gbs-td-num">{stats.auths}</td>
      <td className="gbs-td-num">{stats.logs}</td>
      <td className="gbs-td-actions">
        <div className="gbs-link-actions">
          {!domainPaused ? (
            <button type="button" className="gbd-button" onClick={() => onEdit(link)}>
              {sitesText("actionEdit")}
            </button>
          ) : null}
          <button
            type="button"
            className="gbd-button gbs-button--danger"
            onClick={() => onDelete(link)}
          >
            {sitesText("actionDelete")}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function LinkCard({
  link,
  domainName,
  domainPaused,
  onEdit,
  onDelete,
}: {
  link: SiteLink;
  domainName: string;
  domainPaused: boolean;
  onEdit(link: SiteLink): void;
  onDelete(link: SiteLink): void;
}) {
  const url = linkDisplayUrl(link, domainName);
  const stats = safeSiteStats(link);

  return (
    <article className="gbs-link-card">
      <div className="gbs-link-card__head">
        <div>
          <a
            className="gbs-link-url"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {url}
          </a>
          <div className="gbs-link-sub">
            {link.templateName || link.template || "—"}
            {link.id ? ` · #${link.id}` : ""}
          </div>
        </div>
        <div className="gbs-link-actions">
          {!domainPaused ? (
            <button type="button" className="gbd-button" onClick={() => onEdit(link)}>
              {sitesText("actionEdit")}
            </button>
          ) : null}
          <button
            type="button"
            className="gbd-button gbs-button--danger"
            onClick={() => onDelete(link)}
          >
            {sitesText("actionDelete")}
          </button>
        </div>
      </div>
      <div className="gbs-link-flags">
        {link.isPaused ? (
          <span className="gbs-flag gbs-flag--warn">{sitesText("linkPaused")}</span>
        ) : null}
        {link.iframe ? <span className="gbs-flag">{sitesText("badgeIframe")}</span> : null}
      </div>
      <div className="gbs-link-card__type">
        <span>{sitesText("colAuthType")}</span>
        <strong>{windowTypeLabel(link.windowType)}</strong>
      </div>
      <div className="gbs-link-card__stats">
        <span>
          <small>{sitesText("views")}</small>
          <strong>{stats.views}</strong>
        </span>
        <span>
          <small>{sitesText("auths")}</small>
          <strong>{stats.auths}</strong>
        </span>
        <span>
          <small>{sitesText("validLogs")}</small>
          <strong>{stats.logs}</strong>
        </span>
      </div>
    </article>
  );
}
