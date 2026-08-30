import {
  Check,
  FileKey2,
  KeyRound,
  Layers,
  RefreshCw,
  ShoppingCart,
  Trophy,
  X as XIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { text } from "../copy";
import type { ActivityEvent } from "../types";
import {
  classifyAccountStatus,
  formatDate,
  isOnSaleEvent,
  isProcessedEvent,
  isSoldEvent,
  mafileHoursLeft,
} from "../utils";

type StatusTone =
  | "valid"
  | "invalid"
  | "mafile"
  | "on_sale"
  | "sold"
  | "processed"
  | "processing"
  | "other";

type StatusView = {
  tone: StatusTone;
  label: string;
  meta?: string;
  icon: "check" | "x" | "dot" | "cart" | "sync" | "empty";
  sessionInvalid?: boolean;
  tooltipTitle?: string;
  tooltip?: string;
  tooltipMeta?: string;
};

function formatNotifTime(value?: string): string {
  if (!value) return "";
  const short = window.WorkerFormat?.shortDayTime?.(value);
  if (short && short !== value) return short;
  return formatDate(value);
}

function sessionInvalidView(checkedAt?: string): Pick<
  StatusView,
  "tooltipTitle" | "tooltip" | "tooltipMeta"
> {
  return {
    tooltipTitle: text("status.sessionInvalidTitle"),
    tooltip: text("status.sessionInvalid"),
    tooltipMeta: checkedAt ? formatNotifTime(checkedAt) : undefined,
  };
}

function resolveStatusView(
  event: Pick<
    ActivityEvent,
    | "status"
    | "saleStatus"
    | "processStatus"
    | "createdAt"
    | "eventType"
    | "mafileTime"
    | "mafileSessionHoursLeft"
    | "sessionInvalid"
    | "sessionCheckedAt"
  >,
): StatusView {
  const kind = classifyAccountStatus(event.status);
  if (isSoldEvent(event) || kind === "sold") {
    return { tone: "sold", label: text("activity.sold"), icon: "dot" };
  }
  if (isOnSaleEvent(event) || kind === "on_sale") {
    return { tone: "on_sale", label: text("activity.onSale"), icon: "cart" };
  }
  if (kind === "empty") {
    return { tone: "other", label: text("status.empty"), icon: "empty" };
  }
  if (kind === "hold") {
    return { tone: "processing", label: text("status.hold"), icon: "dot" };
  }
  if (isProcessedEvent(event) || kind === "processed") {
    return { tone: "processed", label: text("activity.processed"), icon: "check" };
  }
  const process = String(event.processStatus || "").toLowerCase();
  if (process === "pending" || kind === "processing") {
    return {
      tone: "processing",
      label: text("status.processing"),
      icon: "sync",
    };
  }
  if (kind === "locked") {
    return { tone: "invalid", label: text("status.locked"), icon: "x" };
  }

  const isMafile =
    kind === "mafile" ||
    (event.eventType === "mafile" && kind === "other");
  const sessionInvalid =
    Boolean(event.sessionInvalid) || (isMafile && kind === "invalid");
  const hours = isMafile ? mafileHoursLeft(event) : 0;

  if (kind === "invalid") {
    return { tone: "invalid", label: text("status.invalid"), icon: "x" };
  }
  if (sessionInvalid && isMafile) {
    return {
      tone: "mafile",
      label: text("status.mafile"),
      meta: hours > 0 ? `${hours}ч` : undefined,
      icon: "dot",
      sessionInvalid: true,
      ...sessionInvalidView(event.sessionCheckedAt),
    };
  }
  if (isMafile) {
    return {
      tone: "mafile",
      label: text("status.mafile"),
      meta: hours > 0 ? `${hours}ч` : undefined,
      icon: "dot",
    };
  }
  if (kind === "valid") {
    return { tone: "valid", label: text("status.valid"), icon: "check" };
  }
  const raw = String(event.status || "").trim();
  if (raw && raw !== "—" && raw !== "-" && raw !== "none") {
    return { tone: "other", label: raw, icon: "empty" };
  }
  return { tone: "other", label: text("status.other"), icon: "empty" };
}

function StatusIcon({ kind }: { kind: StatusView["icon"] }) {
  if (kind === "check") return <Check size={11} strokeWidth={2.4} aria-hidden="true" />;
  if (kind === "x") return <XIcon size={11} strokeWidth={2.4} aria-hidden="true" />;
  if (kind === "cart") return <ShoppingCart size={11} strokeWidth={2.2} aria-hidden="true" />;
  if (kind === "sync") return <RefreshCw size={11} strokeWidth={2.2} aria-hidden="true" />;
  if (kind === "empty") {
    return <i className="gbd-status__ring" aria-hidden="true" />;
  }
  return <i className="gbd-status__dot" aria-hidden="true" />;
}

export function StatusBadge({
  event,
  status,
}: {
  event?: Pick<
    ActivityEvent,
    | "status"
    | "saleStatus"
    | "processStatus"
    | "createdAt"
    | "eventType"
    | "mafileTime"
    | "mafileSessionHoursLeft"
    | "sessionInvalid"
    | "sessionCheckedAt"
  >;
  /** @deprecated prefer `event` */
  status?: string;
}) {
  const view = event
    ? resolveStatusView(event)
    : resolveStatusView({
        status: status || "",
        eventType: /mafile/i.test(status || "") ? "mafile" : "log",
        createdAt: "",
      });
  const tipId = useId();
  const badgeRef = useRef<HTMLSpanElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const showTip = Boolean(view.tooltipTitle && tipPos);

  const openTip = () => {
    if (!view.tooltipTitle) return;
    const rect = badgeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 360;
    const height = 108;
    const below = rect.bottom + 8;
    const top =
      below + height > window.innerHeight - 12
        ? Math.max(12, rect.top - height - 8)
        : below;
    setTipPos({
      top,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
    });
  };

  return (
    <>
      <span
        ref={badgeRef}
        className={`gbd-status gbd-status--${view.tone}${
          view.sessionInvalid ? " is-session-invalid" : ""
        }`}
        tabIndex={view.tooltipTitle ? 0 : undefined}
        aria-describedby={showTip ? tipId : undefined}
        onMouseEnter={openTip}
        onMouseLeave={() => setTipPos(null)}
        onFocus={openTip}
        onBlur={() => setTipPos(null)}
      >
        <StatusIcon kind={view.icon} />
        <span className="gbd-status__label">{view.label}</span>
        {view.meta ? <em className="gbd-status__meta">{view.meta}</em> : null}
      </span>
      {showTip && tipPos
        ? createPortal(
            <div
              id={tipId}
              className="gbd-status-tip"
              role="tooltip"
              style={{ top: tipPos.top, left: tipPos.left }}
            >
              <div className="gbd-status-tip__card is-danger">
                <span className="gbd-status-tip__accent" aria-hidden="true" />
                <span className="gbd-status-tip__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 4 21 20H3L12 4Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 9v5M12 17h.01"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className="gbd-status-tip__body">
                  <span className="gbd-status-tip__head">
                    <strong>{view.tooltipTitle}</strong>
                    {view.tooltipMeta ? <time>{view.tooltipMeta}</time> : null}
                  </span>
                  {view.tooltip ? <span>{view.tooltip}</span> : null}
                </span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export const STAT_ICONS = {
  logs: KeyRound,
  mafiles: FileKey2,
  operations: Layers,
  best: Trophy,
} as const;
