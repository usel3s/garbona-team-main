import {
  AppWindow,
  ChevronDown,
  Globe2,
  Monitor,
  Radio,
  Smartphone,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sitesText } from "../../sitesCopy";
import type { AuthJournalSession, SiteLink } from "../../sitesTypes";

function SessionTechIcon({ label }: { label: string }) {
  const key = label.toLowerCase();
  if (
    key.includes("chrome") ||
    key.includes("safari") ||
    key.includes("firefox") ||
    key.includes("edge") ||
    key.includes("browser")
  ) {
    return <Globe2 size={11} aria-hidden="true" />;
  }
  if (key.includes("android") || key.includes("ios") || key.includes("mobile")) {
    return <Smartphone size={11} aria-hidden="true" />;
  }
  if (
    key.includes("win") ||
    key.includes("mac") ||
    key.includes("linux") ||
    key.includes("desktop")
  ) {
    return <AppWindow size={11} aria-hidden="true" />;
  }
  return <Monitor size={11} aria-hidden="true" />;
}

function SessionRow({ session }: { session: AuthJournalSession }) {
  const [open, setOpen] = useState(false);
  const events = session.events || [];
  const canExpand = events.length > 0;

  return (
    <article className={`gbs-journal-row${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="gbs-journal-row__head"
        aria-expanded={open}
        disabled={!canExpand}
        onClick={() => {
          if (canExpand) setOpen((current) => !current);
        }}
      >
        <div className="gbs-journal-row__info">
          <strong>{session.ip}</strong>
          {session.language ? <em>{session.language}</em> : null}
          <div className="gbs-journal-row__tags">
            {session.browser ? (
              <span>
                <SessionTechIcon label={session.browser} />
                {session.browser}
              </span>
            ) : null}
            {session.os ? (
              <span>
                <SessionTechIcon label={session.os} />
                {session.os}
              </span>
            ) : null}
            {session.device ? (
              <span>
                <SessionTechIcon label={session.device} />
                {session.device}
              </span>
            ) : null}
          </div>
        </div>
        <div className="gbs-journal-row__time">
          <strong>{session.online ? sitesText("journalOnline") : session.duration || "—"}</strong>
          <span>
            <Radio size={12} aria-hidden="true" />
            {session.at}
          </span>
        </div>
        {canExpand ? (
          <ChevronDown size={16} className="gbs-journal-row__chevron" aria-hidden="true" />
        ) : (
          <span className="gbs-journal-row__chevron-spacer" aria-hidden="true" />
        )}
      </button>
      {open && events.length ? (
        <ol className="gbs-journal-timeline">
          {events.map((event) => (
            <li key={event.id} className={`is-${event.tone || "default"}`}>
              <p>
                {event.text}{" "}
                {event.tag ? <code>{event.tag}</code> : null}
              </p>
              <time>{event.at}</time>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

export function AuthJournalDialog({
  open,
  link,
  sessions,
  loading,
  onRefresh,
  onClose,
}: {
  open: boolean;
  link: SiteLink | null;
  sessions: AuthJournalSession[];
  loading?: boolean;
  onRefresh?(link: SiteLink): void;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !link) return;
    const timer = window.setInterval(() => refreshRef.current?.(link), 7500);
    return () => window.clearInterval(timer);
  }, [open, link]);

  return (
    <dialog
      ref={dialogRef}
      className="gbs-dialog gbs-journal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="gbs-dialog__body">
        <header className="gbs-journal__head">
          <div>
            <h3 className="gbs-dialog__title">{sitesText("journalTitle")}</h3>
            <p className="gbs-dialog__hint">{sitesText("journalHint")}</p>
          </div>
          <span className="gbs-journal__live">{sitesText("journalLive")}</span>
        </header>
        <div className="gbs-journal__cols">
          <span>{sitesText("journalInfo")}</span>
          <span>{sitesText("journalTime")}</span>
        </div>
        {loading ? (
          <div className="gbs-journal-empty">
            <strong>{sitesText("journalLoading")}</strong>
          </div>
        ) : sessions.length === 0 ? (
          <div className="gbs-journal-empty">
            <strong>{sitesText("journalEmpty")}</strong>
            <span>{sitesText("journalEmptyHint")}</span>
            {link?.path ? (
              <em>/{String(link.path).replace(/^\/+/, "")}</em>
            ) : null}
          </div>
        ) : (
          <div className="gbs-journal__list">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
