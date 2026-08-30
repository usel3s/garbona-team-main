import {
  Check,
  CheckCircle2,
  ExternalLink,
  FileKey2,
  Gamepad2,
  KeyRound,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { text } from "../copy";
import { showLoadingToast, updateToast } from "../actionToast";
import { toastText } from "../toastCopy";
import type {
  ActivityEvent,
  DashboardApi,
  InventoryGroup,
  InventoryItem,
  GameSummary,
} from "../types";
import {
  formatDate,
  formatMoney,
  inventoryGroups,
  mergeActivity,
  normalizeActivityStatus,
  resolveSkinRarity,
  compareInventoryByRarity,
} from "../utils";
import { CountryFlag } from "./CountryFlag";
import { StatusBadge } from "./StatusBadge";

type ActionName = "refresh" | "check-valid" | "sell" | "process";

function splitItemName(name: string): { title: string; subtitle: string } {
  const pipe = name.split("|").map((part) => part.trim());
  if (pipe.length >= 2) {
    return { title: pipe[0], subtitle: pipe.slice(1).join(" | ") };
  }
  const parts = name.split(/\s+/);
  if (parts.length > 2) {
    return {
      title: parts.slice(0, 2).join(" "),
      subtitle: parts.slice(2).join(" "),
    };
  }
  return { title: name, subtitle: "" };
}

function InventoryItemCard({ item }: { item: InventoryItem }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(item.iconUrl) && !broken;
  const { title, subtitle } = splitItemName(item.name);
  const rarity = resolveSkinRarity(item);

  return (
    <article className="gbd-item-card" data-rarity={rarity}>
      <div className="gbd-item-card__meta">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <div className="gbd-item-card__art">
        <span className="gbd-item-card__glow" aria-hidden="true" />
        {showImage ? (
          <img
            src={item.iconUrl}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <ShoppingBag size={36} aria-hidden="true" />
        )}
      </div>
      <div className="gbd-item-card__foot">
        <b>{formatMoney(item.priceUsd)}</b>
        {item.amount > 1 ? <em>×{item.amount}</em> : null}
      </div>
    </article>
  );
}

function toastSuccess(message: string) {
  window.WorkerToast?.success?.(message);
}

function toastError(error: unknown) {
  if (window.WorkerToast?.error) window.WorkerToast.error(error);
}

function Inventory({ event }: { event: ActivityEvent }) {
  const groups = useMemo(() => inventoryGroups(event), [event]);
  const [activeKey, setActiveKey] = useState("");

  useEffect(() => {
    const first = groups.find((group) => group.itemCount > 0) || groups[0];
    setActiveKey(first ? String(first.appid || first.name) : "");
  }, [groups]);

  if (!groups.length) return null;

  const active =
    groups.find((group) => String(group.appid || group.name) === activeKey) ||
    groups[0];
  const totalItems = groups.reduce(
    (sum, group) => sum + (group.itemCount || group.items.length),
    0,
  );
  const totalValue =
    groups.reduce((sum, group) => sum + group.totalUsd, 0) ||
    event.inventoryUsd ||
    0;

  return (
    <section className="gbd-modal__inventory">
      <div className="gbd-modal__inventory-head">
        <div>
          <h3>{text("drawer.inventory")}</h3>
          <p>
            {text("drawer.inventorySummary", {
              count: totalItems,
              total: formatMoney(totalValue),
            })}
          </p>
        </div>
      </div>

      <div className="gbd-game-tabs" role="tablist">
        {groups.map((group) => {
          const key = String(group.appid || group.name);
          const count = group.itemCount || group.items.length;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={key === activeKey}
              className={`gbd-game-tab${key === activeKey ? " is-active" : ""}`}
              key={key}
              onClick={() => setActiveKey(key)}
            >
              {shortGameName(group)} ({count}) {formatMoney(group.totalUsd)}
            </button>
          );
        })}
      </div>

      {!active.items.length ? (
        <div className="gbd-modal__empty">
          <PackageOpen size={20} />
          {text("drawer.noItems")}
        </div>
      ) : (
        <div className="gbd-item-grid">
          {[...active.items]
            .sort(compareInventoryByRarity)
            .map((item, index) => (
              <InventoryItemCard
                item={item}
                key={`${item.name}:${index}`}
              />
            ))}
        </div>
      )}
    </section>
  );
}

function formatPlaytime(minutes?: number): string {
  const value = Number(minutes) || 0;
  if (value <= 0) return "";
  const hours = Math.round(value / 60);
  if (hours >= 1) return `${hours} ч`;
  return `${value} м`;
}

function GameTile({ game }: { game: GameSummary }) {
  const skipStoreArt = game.appid === 753;
  const candidates = [
    game.imageUrl,
    game.iconUrl,
    !skipStoreArt && game.appid
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`
      : "",
    !skipStoreArt && game.appid
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`
      : "",
  ].filter(Boolean) as string[];
  const [index, setIndex] = useState(0);
  const src = candidates[index];
  const play = formatPlaytime(game.playtime);
  const value =
    game.inventoryUsd != null
      ? formatMoney(game.inventoryUsd)
      : null;

  useEffect(() => {
    setIndex(0);
  }, [game.appid, game.iconUrl, game.imageUrl]);

  return (
    <article className="gbd-game-tile">
      {src && index < candidates.length ? (
        <div className="gbd-game-tile__art">
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setIndex((value) => value + 1)}
          />
          <span className="gbd-game-tile__shade" aria-hidden="true" />
        </div>
      ) : (
        <div className="gbd-game-tile__art gbd-game-tile__art--empty">
          {game.name.slice(0, 1)}
        </div>
      )}
      <div className="gbd-game-tile__meta">
        <strong>{game.name}</strong>
        <span>{[play, value].filter(Boolean).join(" · ") || "—"}</span>
      </div>
      {game.vac ? <em className="gbd-game-tile__vac">VAC</em> : null}
    </article>
  );
}

function GamesStrip({ event }: { event: ActivityEvent }) {
  const games = useMemo((): GameSummary[] => {
    const source = event.games?.length
      ? event.games
      : inventoryGroups(event).map((group) => ({
          appid: group.appid,
          name: group.name,
          itemCount: group.itemCount || group.items.length,
          inventoryUsd: group.totalUsd,
        }));
    const playable = source.filter((game) => Number(game.appid) !== 753);
    return (playable.length ? playable : source).slice(0, 4);
  }, [event]);

  if (!games.length) return null;

  const total =
    event.gamesCount != null ? event.gamesCount : event.games?.length || games.length;

  return (
    <section className="gbd-modal__games">
      <div className="gbd-modal__section-head">
        <h3>{text("drawer.games")}</h3>
        <span className="gbd-modal__section-count">{String(total)}</span>
      </div>
      <div className="gbd-game-grid">
        {games.map((game) => (
          <GameTile game={game} key={game.appid || game.name} />
        ))}
      </div>
    </section>
  );
}

function shortGameName(group: InventoryGroup): string {
  if (/counter.?strike/i.test(group.name)) return "CS2";
  if (/^dota/i.test(group.name)) return "Dota 2";
  if (/pubg/i.test(group.name)) return "PUBG";
  if (/team fortress/i.test(group.name)) return "TF2";
  return group.name.length > 18 ? `${group.name.slice(0, 16)}…` : group.name;
}

function vacLabel(vac: ActivityEvent["vac"]): string {
  if (!vac) return "0 VAC";
  if (typeof vac === "boolean") return vac ? "VAC" : "0 VAC";
  const count = Number(vac.count || 0);
  return count > 0 ? `${count} VAC` : "0 VAC";
}

export function EventDrawer({
  event,
  api,
  onClose,
  onEventUpdate,
}: {
  event: ActivityEvent | null;
  api: DashboardApi;
  onClose(): void;
  onEventUpdate(event: ActivityEvent): void;
}) {
  const [detail, setDetail] = useState<ActivityEvent | null>(event);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyAction, setBusyAction] = useState<ActionName | null>(null);
  const [confirmAction, setConfirmAction] = useState<"sell" | "process" | null>(
    null,
  );
  const modalRef = useRef<HTMLElement>(null);
  const eventKey = event
    ? `${event.eventType}:${event.sourceId || event.id}`
    : "";

  useEffect(() => {
    if (!event) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetail(event);
    setLoading(true);
    setLoadError(false);
    setConfirmAction(null);
    api
      .getLogDetail(event.sourceId || event.id)
      .then((result) => {
        if (!active) return;
        const merged = mergeActivity(event, result);
        setDetail(merged);
        onEventUpdate(merged);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(true);
        toastError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, eventKey, onEventUpdate]);

  useEffect(() => {
    if (!event) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.classList.add("gbd-drawer-open");
    requestAnimationFrame(() => {
      modalRef.current
        ?.querySelector<HTMLElement>("[data-autofocus]")
        ?.focus({ preventScroll: true });
    });

    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        onClose();
        return;
      }
      if (keyboardEvent.key !== "Tab" || !modalRef.current) return;
      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault();
        last?.focus();
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("gbd-drawer-open");
      previousFocus?.focus({ preventScroll: true });
    };
  }, [eventKey, onClose]);

  if (!event || !detail) return null;

  const runCheckValid = async () => {
    if (!detail) return;
    const sourceId = detail.sourceId || detail.id;
    setBusyAction("check-valid");
    const toastId = showLoadingToast(
      text("drawer.checkWait"),
      text("drawer.checkWaitTitle"),
      { slow: true },
    );
    try {
      const started = await api.runLogAction(sourceId, "check-valid");
      const taskId = String(started.taskId || "").trim();
      const deadline = Date.now() + 120_000;
      let poll: {
        pending: boolean;
        failed?: boolean;
        log?: ActivityEvent;
      } = { pending: true };

      await new Promise((resolve) => window.setTimeout(resolve, 800));
      while (Date.now() < deadline) {
        if (api.pollCheckValid) {
          poll = await api.pollCheckValid(sourceId, taskId);
          if (!poll.pending) break;
        } else {
          poll = { pending: false, log: undefined };
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }

      if (poll.failed) {
        const nextDetail = {
          ...detail,
          sessionInvalid: true,
          sessionCheckedAt: detail.sessionCheckedAt || new Date().toISOString(),
        };
        setDetail(nextDetail);
        onEventUpdate(nextDetail);
        updateToast(toastId, {
          status: "error",
          progress: undefined,
          title: text("drawer.checkInvalid"),
          description: text("drawer.checkInvalidBody"),
          primaryButtonText: toastText("close"),
          sticky: false,
        });
        return;
      }

      let nextDetail = poll.log;
      if (!nextDetail) {
        nextDetail = mergeActivity(
          detail,
          await api.runLogAction(sourceId, "refresh"),
        );
      }
      setDetail(nextDetail);
      onEventUpdate(nextDetail);

      if (poll.pending) {
        updateToast(toastId, {
          status: "error",
          progress: undefined,
          title: text("drawer.checkTimeout"),
          description: text("drawer.checkTimeoutBody"),
          primaryButtonText: toastText("close"),
          sticky: false,
        });
        return;
      }

      const invalid =
        Boolean(nextDetail.sessionInvalid) ||
        normalizeActivityStatus(nextDetail.status) === "invalid";
      updateToast(toastId, {
        status: invalid ? "error" : "success",
        progress: undefined,
        title: invalid ? text("drawer.checkInvalid") : text("drawer.checkValid"),
        description: invalid
          ? text("drawer.checkInvalidBody")
          : text("drawer.checkValidBody"),
        primaryButtonText: toastText("done"),
        sticky: false,
      });
    } catch {
      const nextDetail = {
        ...detail,
        sessionInvalid: true,
        sessionCheckedAt: detail.sessionCheckedAt || new Date().toISOString(),
      };
      setDetail(nextDetail);
      onEventUpdate(nextDetail);
      updateToast(toastId, {
        status: "error",
        progress: undefined,
        title: text("drawer.checkInvalid"),
        description: text("drawer.checkInvalidBody"),
        primaryButtonText: toastText("close"),
        sticky: false,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runAction = async (action: ActionName) => {
    if (action === "check-valid") {
      await runCheckValid();
      return;
    }
    setBusyAction(action);
    try {
      const result = await api.runLogAction(
        detail.sourceId || detail.id,
        action,
      );
      const merged = mergeActivity(detail, result);
      setDetail(merged);
      onEventUpdate(merged);
      setConfirmAction(null);
      toastSuccess(
        action === "refresh"
          ? text("drawer.updated")
          : text("drawer.actionDone"),
      );
    } catch (error) {
      toastError(error);
    } finally {
      setBusyAction(null);
    }
  };

  const guardedAction = (action: "sell" | "process") => {
    if (confirmAction === action) {
      void runAction(action);
      return;
    }
    setConfirmAction(action);
  };

  const status = normalizeActivityStatus(detail.status);
  const canSell =
    detail.eventType === "log" &&
    status === "valid" &&
    !["pending", "done"].includes(detail.saleStatus || "none");
  const canProcess =
    detail.eventType === "mafile" &&
    status === "mafile" &&
    !["pending", "done"].includes(detail.processStatus || "none");
  const profileUrl =
    detail.steamProfileUrl ||
    (detail.steamId
      ? `https://steamcommunity.com/profiles/${detail.steamId}`
      : "");
  const TypeIcon = detail.eventType === "mafile" ? FileKey2 : KeyRound;
  const itemCount = inventoryGroups(detail).reduce(
    (sum, group) => sum + (group.itemCount || group.items.length),
    0,
  );

  return createPortal(
    <div className="gbd-modal-layer">
      <button
        className="gbd-modal-backdrop"
        type="button"
        onClick={onClose}
        aria-label={text("drawer.close")}
      />
      <aside
        className="gbd-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gbd-modal-title"
      >
        <button
          className="gbd-icon-btn gbd-modal__close"
          type="button"
          onClick={onClose}
          aria-label={text("drawer.close")}
          data-autofocus
        >
          <X size={16} />
        </button>

        <header className="gbd-modal__header">
          <div className="gbd-modal__identity">
            <span
              className={`gbd-modal__avatar gbd-modal__avatar--${detail.eventType}`}
            >
              <TypeIcon size={18} aria-hidden="true" />
            </span>
            <div className="gbd-modal__who">
              <div className="gbd-modal__who-top">
                <h2 id="gbd-modal-title">#{detail.id}</h2>
                <div className="gbd-modal__chips">
                  <StatusBadge event={detail} />
                  {detail.accountTag ? (
                    <span
                      className="gbd-modal__note"
                      title={text("drawer.adminNote")}
                    >
                      <Check size={11} strokeWidth={2.4} aria-hidden="true" />
                      <span className="gbd-modal__note__label">
                        {detail.accountTag}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
              <span>
                {detail.steamId
                  ? `Steam ID ${detail.steamId}`
                  : text("drawer.event", { id: detail.id })}
              </span>
              {detail.sourcePage ? (
                <span className="gbd-modal__source">{detail.sourcePage}</span>
              ) : null}
              <p className="gbd-modal__meta-line">
                {detail.level != null ? (
                  <>
                    <span>
                      {text("drawer.levelValue", {
                        level: String(detail.level),
                      })}
                    </span>
                    <span aria-hidden="true"> · </span>
                  </>
                ) : null}
                {detail.country ? (
                  <>
                    <CountryFlag code={detail.country} />
                    <span aria-hidden="true"> · </span>
                  </>
                ) : null}
                <span>{formatDate(detail.createdAt)}</span>
              </p>
            </div>
          </div>

          <div className="gbd-modal__summary">
            <div>
              <strong>
                {itemCount > 0
                  ? `${itemCount}`
                  : detail.gamesCount != null
                    ? String(detail.gamesCount)
                    : "—"}
              </strong>
              <span>
                {itemCount > 0
                  ? text("drawer.inventory")
                  : text("drawer.games")}
              </span>
            </div>
            <div>
              <strong>{formatMoney(detail.priceUsd)}</strong>
              <span>{text("drawer.total")}</span>
            </div>
            <div>
              <strong>{vacLabel(detail.vac).replace(/ VAC$/i, "")}</strong>
              <span>VAC</span>
            </div>
          </div>
        </header>

        <div className="gbd-modal__scroll">
          {loadError && (
            <div className="gbd-alert">{text("drawer.loadError")}</div>
          )}

          <section className="gbd-modal__stats">
            <div>
              <span>{text("drawer.balance")}</span>
              <strong>{formatMoney(detail.balanceUsd || 0)}</strong>
            </div>
            <div>
              <span>{text("drawer.inventory")}</span>
              <strong>{formatMoney(detail.inventoryUsd || 0)}</strong>
            </div>
            <div>
              <span>{text("drawer.tradable")}</span>
              <strong>
                {formatMoney(detail.inventoryBreakdown?.tradable ?? 0)}
              </strong>
            </div>
            <div>
              <span>{text("drawer.marketable")}</span>
              <strong>
                {formatMoney(detail.inventoryBreakdown?.marketable ?? 0)}
              </strong>
            </div>
          </section>

          <GamesStrip event={detail} />
          <Inventory event={detail} />
        </div>

        <footer className="gbd-modal__footer">
          {confirmAction && (
            <div className="gbd-confirmation" role="alert">
              <CheckCircle2 size={15} aria-hidden="true" />
              <span>{text("drawer.actionHint")}</span>
              <button type="button" onClick={() => setConfirmAction(null)}>
                {text("drawer.cancel")}
              </button>
            </div>
          )}
          <div className="gbd-modal__actions">
            <button
              type="button"
              className="gbd-btn gbd-btn--ghost"
              disabled={loading || busyAction != null}
              onClick={() => void runAction("refresh")}
              aria-label={text("drawer.refresh")}
            >
              <RefreshCw
                className={busyAction === "refresh" ? "is-spinning" : ""}
                size={15}
              />
              <span>{text("drawer.refresh")}</span>
            </button>
            <button
              type="button"
              className="gbd-btn gbd-btn--ghost"
              disabled={loading || busyAction != null}
              onClick={() => void runAction("check-valid")}
              aria-label={text("drawer.check")}
            >
              <ShieldCheck
                className={busyAction === "check-valid" ? "is-spinning" : ""}
                size={15}
              />
              <span>{text("drawer.check")}</span>
            </button>
            {profileUrl ? (
              <a
                className="gbd-btn gbd-btn--ghost"
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={text("drawer.steam")}
              >
                <ExternalLink size={15} />
                <span>{text("drawer.steam")}</span>
              </a>
            ) : (
              <span
                className="gbd-btn gbd-btn--ghost is-disabled"
                aria-disabled="true"
                title={text("drawer.steam")}
              >
                <ExternalLink size={15} />
                <span>{text("drawer.steam")}</span>
              </span>
            )}
            {(canSell || canProcess) && (
              <button
                type="button"
                className="gbd-btn gbd-btn--primary gbd-modal__action-primary"
                disabled={loading || busyAction != null}
                onClick={() => guardedAction(canSell ? "sell" : "process")}
              >
                {canSell ? (
                  <ShoppingBag size={15} />
                ) : (
                  <Gamepad2 size={15} />
                )}
                <span>
                  {confirmAction === (canSell ? "sell" : "process")
                    ? text("drawer.confirm")
                    : text(canSell ? "drawer.sell" : "drawer.process")}
                </span>
              </button>
            )}
          </div>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
