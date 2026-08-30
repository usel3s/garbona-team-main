import {
  Globe,
  Link2,
  PauseCircle,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { sitesText } from "../../sitesCopy";

export function SitesHeader({
  onAddDomain,
}: {
  onAddDomain(): void;
}) {
  return (
    <header className="gbs-head">
      <div className="gbs-head__copy">
        <h1>
          <Globe size={22} aria-hidden="true" />
          {sitesText("pageTitle")}
        </h1>
        <p>{sitesText("pageSubtitle")}</p>
      </div>
      <button
        type="button"
        className="gbd-button gbd-button--primary gbs-add-btn"
        onClick={onAddDomain}
      >
        <Plus size={16} aria-hidden="true" />
        {sitesText("addDomain")}
      </button>
    </header>
  );
}

export function SitesSummary({
  total,
  active,
  paused,
  links,
}: {
  total: number;
  active: number;
  paused: number;
  links: number;
}) {
  const items = [
    { tone: "all", icon: Globe, label: sitesText("summaryAll"), value: total },
    {
      tone: "active",
      icon: ShieldCheck,
      label: sitesText("summaryActive"),
      value: active,
    },
    {
      tone: "paused",
      icon: PauseCircle,
      label: sitesText("summaryPaused"),
      value: paused,
    },
    {
      tone: "links",
      icon: Link2,
      label: sitesText("summaryLinks"),
      value: links,
    },
  ] as const;

  return (
    <section className="gbs-summary" aria-label={sitesText("overviewLabel")}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className={`gbs-summary__item is-${item.tone}`} key={item.tone}>
            <span className="gbs-summary__icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className="gbs-summary__copy">
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}
