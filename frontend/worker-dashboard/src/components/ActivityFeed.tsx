import {
  ChevronLeft,
  ChevronRight,
  FileKey2,
  KeyRound,
  Search,
  SlidersHorizontal,
  Wallet,
  LayoutGrid,
  Store,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { text } from "../copy";
import type {
  ActivityEvent,
  ActivityFilters,
  ActivitySort,
  ActivityStatusFilter,
  ActivityType,
} from "../types";
import { formatDate, formatMoney } from "../utils";
import { CountryFlag } from "./CountryFlag";
import { SelectMenu } from "./SelectMenu";
import { StatusBadge } from "./StatusBadge";

const ACTIVITY_PAGE_SIZE = 5;

function shortGameName(name: string): string {
  if (/counter.?strike/i.test(name)) return "CS:2";
  if (/^dota/i.test(name)) return "Dota 2";
  if (/pubg/i.test(name)) return "PUBG";
  if (/^rust$/i.test(name)) return "Rust";
  if (/team fortress/i.test(name)) return "TF2";
  return name.length > 14 ? `${name.slice(0, 12)}…` : name;
}

async function copyId(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    window.WorkerToast?.success?.(text("activity.copied"));
  } catch {
    window.WorkerToast?.error?.(text("activity.copyId"));
  }
}

export function ActivityToolbar({
  filters,
  onChange,
}: {
  filters: ActivityFilters;
  onChange(filters: ActivityFilters): void;
}) {
  return (
    <div className="gbd-activity-toolbar">
      <label className="gbd-search">
        <Search size={16} aria-hidden="true" />
        <span className="gbd-sr-only">{text("activity.search")}</span>
        <input
          type="search"
          value={filters.query}
          placeholder={text("activity.search")}
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
        />
      </label>
      <div className="gbd-filter-group">
        <SlidersHorizontal size={15} aria-hidden="true" />
        <SelectMenu
          className="gbd-filter-select"
          value={filters.type}
          ariaLabel={text("activity.typeAll")}
          options={[
            { value: "all", label: text("activity.typeAll") },
            { value: "log", label: text("activity.logs") },
            { value: "mafile", label: text("activity.mafiles") },
          ]}
          onChange={(type) =>
            onChange({
              ...filters,
              type: type as ActivityFilters["type"],
            })
          }
        />
        <SelectMenu
          className="gbd-filter-select"
          value={filters.status}
          ariaLabel={text("activity.statusAll")}
          options={[
            { value: "all", label: text("activity.statusAll") },
            { value: "valid", label: text("activity.valid") },
            { value: "invalid", label: text("activity.invalid") },
            { value: "mafile", label: text("activity.mafiles") },
            { value: "sold", label: text("activity.sold") },
            { value: "on_sale", label: text("activity.onSale") },
            { value: "processed", label: text("activity.processed") },
            { value: "other", label: text("activity.other") },
          ]}
          onChange={(status) =>
            onChange({
              ...filters,
              status: status as ActivityStatusFilter,
            })
          }
        />
        <SelectMenu
          className="gbd-filter-select gbd-filter-select--sort"
          value={filters.sort}
          ariaLabel={text("activity.sortNewest")}
          align="right"
          options={[
            { value: "date-desc", label: text("activity.sortNewest") },
            { value: "date-asc", label: text("activity.sortOldest") },
            { value: "price-desc", label: text("activity.sortExpensive") },
            { value: "price-asc", label: text("activity.sortCheapest") },
          ]}
          onChange={(sort) =>
            onChange({
              ...filters,
              sort: sort as ActivitySort,
            })
          }
        />
      </div>
    </div>
  );
}

function ActivityHoverTip({ event }: { event: ActivityEvent }) {
  const tradable = event.inventoryBreakdown?.tradable;
  const games =
    event.gamesCount != null
      ? String(event.gamesCount)
      : event.games?.length
        ? String(event.games.length)
        : null;

  const rows: Array<{
    icon?: ReactNode;
    label: string;
    value: string;
    mono?: boolean;
  }> = [
    {
      icon: <Wallet size={12} aria-hidden="true" />,
      label: text("activity.tipBalance"),
      value: formatMoney(event.balanceUsd || 0),
    },
    {
      icon: <LayoutGrid size={12} aria-hidden="true" />,
      label: text("activity.tipInventory"),
      value: formatMoney(event.inventoryUsd || 0),
    },
  ];

  if (tradable != null) {
    rows.push({
      icon: <Store size={12} aria-hidden="true" />,
      label: text("activity.tipTradable"),
      value: formatMoney(tradable),
    });
  }
  if (event.steamId) {
    rows.push({
      label: text("activity.tipSteamId"),
      value: event.steamId,
      mono: true,
    });
  }
  if (event.level != null) {
    rows.push({
      label: text("activity.tipLevel"),
      value: String(event.level),
    });
  }
  if (games) {
    rows.push({
      label: text("activity.tipGames"),
      value: games,
    });
  }

  return (
    <div className="gbd-activity-tip" role="tooltip">
      {rows.map((row) => (
        <div className="gbd-activity-tip__row" key={row.label}>
          <span className="gbd-activity-tip__label">
            {row.icon}
            {row.label}
          </span>
          <strong className={row.mono ? "gbd-activity-tip__mono" : undefined}>
            {row.value}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function ActivityItem({
  event,
  onOpen,
}: {
  event: ActivityEvent;
  onOpen(event: ActivityEvent): void;
}) {
  const isMafile = event.eventType === "mafile";
  const Icon = isMafile ? FileKey2 : KeyRound;
  const typeLabel = text(isMafile ? "activity.mafiles" : "activity.logs");
  const gamePills = (event.games || [])
    .filter((game) => (game.itemCount || 0) > 0 || (game.inventoryUsd || 0) > 0)
    .slice(0, 2);
  const extraGames = Math.max(
    0,
    (event.gamesCount || event.games?.length || 0) - gamePills.length,
  );
  return (
    <article
      className={`gbd-activity-item gbd-activity-item--${event.eventType}`}
      onClick={() => onOpen(event)}
    >
      <div className="gbd-activity-item__idcol">
        <button
          type="button"
          className="gbd-activity-id"
          title={text("activity.copyId")}
          onClick={(click) => {
            click.stopPropagation();
            void copyId(event.id);
          }}
        >
          #{event.id}
        </button>
        <strong className="gbd-activity-item__user" title={event.sourcePage || undefined}>
          {event.sourcePage || "—"}
        </strong>
      </div>

      <div className="gbd-activity-item__body">
        <div className="gbd-activity-item__facts">
          <span className="gbd-activity-fact gbd-activity-fact--type">
            <span className="gbd-activity-item__icon" aria-hidden="true">
              <Icon size={12} strokeWidth={1.8} />
            </span>
            {typeLabel}
          </span>
          {event.level != null ? (
            <span className="gbd-activity-fact">{event.level} LVL</span>
          ) : null}
          {event.country ? (
            <span
              className="gbd-activity-fact gbd-activity-fact--flag"
              title={event.country}
              aria-label={event.country}
            >
              <CountryFlag code={event.country} />
            </span>
          ) : null}
          <span className="gbd-activity-fact">{formatDate(event.createdAt)}</span>
          {event.accountTag ? (
            <span className="gbd-account-tag" title="Заметка администратора">
              #{event.accountTag}
            </span>
          ) : null}
        </div>
        {(gamePills.length > 0 || extraGames > 0) && (
          <div className="gbd-activity-games">
            {gamePills.map((game) => (
              <span className="gbd-activity-game" key={game.appid || game.name}>
                {shortGameName(game.name)}
              </span>
            ))}
            {extraGames > 0 ? (
              <span className="gbd-activity-game gbd-activity-game--more">
                +{extraGames}
              </span>
            ) : null}
          </div>
        )}
        <ActivityHoverTip event={event} />
      </div>

      <div className="gbd-activity-item__side">
        <strong>{formatMoney(event.priceUsd)}</strong>
        <div className="gbd-activity-item__badges">
          <StatusBadge event={event} />
        </div>
      </div>

      <button
        type="button"
        className="gbd-activity-item__open"
        onClick={(click) => {
          click.stopPropagation();
          onOpen(event);
        }}
        aria-label={`${text("activity.open")}: #${event.id}`}
      >
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </article>
  );
}

function ActivityPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange(page: number): void;
}) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  const visiblePages =
    totalPages <= 5
      ? pages
      : pages.filter(
          (value) =>
            value === 1 ||
            value === totalPages ||
            Math.abs(value - page) <= 1,
        );

  return (
    <nav
      className="gbd-activity-pagination"
      aria-label={text("activity.pagination")}
    >
      <button
        type="button"
        className="gbd-activity-pagination__arrow"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label={text("activity.pagePrev")}
      >
        <ChevronLeft size={15} aria-hidden="true" />
        <span>{text("activity.pagePrev")}</span>
      </button>

      <div className="gbd-activity-pagination__center">
        <div className="gbd-activity-pagination__pages" aria-hidden="true">
          {visiblePages.map((value, index) => {
            const prev = visiblePages[index - 1];
            const needsGap = prev != null && value - prev > 1;
            return (
              <span key={value} className="gbd-activity-pagination__page-wrap">
                {needsGap ? (
                  <span className="gbd-activity-pagination__gap">…</span>
                ) : null}
                <button
                  type="button"
                  className={`gbd-activity-pagination__page${
                    value === page ? " is-active" : ""
                  }`}
                  aria-current={value === page ? "page" : undefined}
                  onClick={() => onChange(value)}
                >
                  {value}
                </button>
              </span>
            );
          })}
        </div>
        <span className="gbd-activity-pagination__info">
          {text("activity.pageInfo", { page, total: totalPages })}
        </span>
      </div>

      <button
        type="button"
        className="gbd-activity-pagination__arrow"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label={text("activity.pageNext")}
      >
        <span>{text("activity.pageNext")}</span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </nav>
  );
}

export function ActivityFeed({
  allEvents,
  events,
  filters,
  onFiltersChange,
  onOpen,
}: {
  allEvents: ActivityEvent[];
  events: ActivityEvent[];
  filters: ActivityFilters;
  onFiltersChange(filters: ActivityFilters): void;
  onOpen(event: ActivityEvent): void;
}) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [filters, events.length]);

  const totalPages = Math.max(1, Math.ceil(events.length / ACTIVITY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pagedEvents = useMemo(() => {
    const start = (currentPage - 1) * ACTIVITY_PAGE_SIZE;
    return events.slice(start, start + ACTIVITY_PAGE_SIZE);
  }, [currentPage, events]);

  return (
    <section className="gbd-activity-card" aria-labelledby="gbd-activity-title">
      <div className="gbd-section-head">
        <div>
          <h2 id="gbd-activity-title">{text("activity.title")}</h2>
          <p>{text("activity.subtitle", { count: events.length })}</p>
        </div>
      </div>
      <ActivityToolbar filters={filters} onChange={onFiltersChange} />
      {!events.length ? (
        <div className="gbd-activity-empty">
          <Search size={22} aria-hidden="true" />
          <strong>
            {allEvents.length
              ? text("activity.noResults")
              : text("activity.empty")}
          </strong>
        </div>
      ) : (
        <>
          <div className="gbd-activity-list">
            {pagedEvents.map((event) => (
              <ActivityItem
                event={event}
                key={`${event.eventType}:${event.id}`}
                onOpen={onOpen}
              />
            ))}
          </div>
          <ActivityPagination
            page={currentPage}
            totalPages={totalPages}
            onChange={setPage}
          />
        </>
      )}
    </section>
  );
}

export type { ActivityType };
