import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { sitesText } from "../../sitesCopy";
import type {
  LinkPayload,
  LinkWindowType,
  SiteLink,
  SiteTemplate,
} from "../../sitesTypes";
import { normalizeRedirectInput } from "../../sitesUtils";
import { Search } from "lucide-react";
import { closeExclusiveMenus } from "./KebabMenu";

interface LinkFormState {
  path: string;
  templateId: string;
  templateName: string;
  windowType: LinkWindowType;
  iframe: boolean;
  cloaking: boolean;
  logError: boolean;
  mafileError: boolean;
  mafileSteamRedirect: boolean;
  tradeError: boolean;
  logRedirect: string;
  tradeRedirect: string;
  mafileRedirect: string;
}

function defaultFormState(templates: SiteTemplate[]): LinkFormState {
  const first = templates[0];
  return {
    path: "",
    templateId: first?.id ? String(first.id) : "",
    templateName: first?.name || "",
    windowType: "FakeWindow",
    iframe: true,
    cloaking: false,
    logError: true,
    mafileError: false,
    mafileSteamRedirect: true,
    tradeError: true,
    logRedirect: "",
    tradeRedirect: "",
    mafileRedirect: "",
  };
}

function useModalOpen(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

function linkToFormState(link: SiteLink, templates: SiteTemplate[]): LinkFormState {
  const base = defaultFormState(templates);
  return {
    ...base,
    path: String(link.path || "").replace(/^\/+/, ""),
    templateId: link.template ? String(link.template) : "",
    templateName: link.templateName || "",
    windowType: link.windowType || "FakeWindow",
    iframe: link.iframe !== false,
    cloaking: Boolean(link.cloaking),
    logError: link.steam?.logError !== false,
    mafileError: Boolean(link.steam?.mafileError),
    mafileSteamRedirect: link.steam?.mafileSteamRedirect !== false,
    tradeError: link.steam?.tradeError !== false,
    logRedirect: String(link.steam?.logRedirect || "").trim(),
    tradeRedirect: String(link.steam?.tradeRedirect || "").trim(),
    mafileRedirect: String(link.steam?.mafileRedirect || "").trim(),
  };
}

interface LinkFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  link?: SiteLink | null;
  templates: SiteTemplate[];
  busy?: boolean;
  onClose(): void;
  onSubmit(payload: LinkPayload): Promise<void>;
}

export function LinkFormDialog({
  open,
  mode,
  link,
  templates,
  busy = false,
  onClose,
  onSubmit,
}: LinkFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"main" | "advanced">("main");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [windowPickerOpen, setWindowPickerOpen] = useState(false);
  const pickerRef = useModalOpen(pickerOpen);
  const windowPickerRef = useModalOpen(windowPickerOpen);
  const [templateQuery, setTemplateQuery] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<LinkFormState>(() =>
    defaultFormState(templates),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPickerOpen(false);
      setWindowPickerOpen(false);
      return;
    }
    setTab("main");
    setPickerOpen(false);
    setWindowPickerOpen(false);
    setTemplateQuery("");
    setError("");
    setState(
      mode === "edit" && link
        ? linkToFormState(link, templates)
        : defaultFormState(templates),
    );
  }, [open, mode, link, templates]);

  const filteredTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    return templates.filter((template) => {
      const name = String(template.name || "").toLowerCase();
      const id = String(template.id || "");
      return !q || name.includes(q) || id.includes(q);
    });
  }, [templateQuery, templates]);

  const buildPayload = (): LinkPayload => {
    const logRedirect = normalizeRedirectInput(state.logRedirect);
    const tradeRedirect = normalizeRedirectInput(state.tradeRedirect);
    const mafileRedirect = normalizeRedirectInput(state.mafileRedirect);

    if (!state.logError && !logRedirect) {
      throw new Error(sitesText("redirectUrlRequired"));
    }
    if (!state.tradeError && !tradeRedirect) {
      throw new Error(sitesText("redirectUrlRequired"));
    }

    return {
      path: state.path.trim(),
      templateId: state.templateId,
      windowType: state.windowType,
      iframe: state.iframe,
      cloaking: state.cloaking,
      logError: state.logError,
      mafileError: state.mafileError,
      tradeError: state.tradeError,
      logRedirect: state.logError ? "" : logRedirect,
      tradeRedirect: state.tradeError ? "" : tradeRedirect,
      mafileRedirect: state.mafileError ? "" : mafileRedirect,
      mafileSteamRedirect: state.mafileError ? false : !mafileRedirect,
    };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!state.templateId) {
      setError(sitesText("templateNotSelected"));
      return;
    }
    try {
      setError("");
      await onSubmit(buildPayload());
      onClose();
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : sitesText("stateError");
      setError(message);
      if (message === sitesText("redirectUrlRequired")) {
        setTab("advanced");
      }
    }
  };

  return (
    <>
      <dialog
        ref={dialogRef}
        className="gbs-dialog gbs-link-dialog"
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        onClose={onClose}
      >
        <form className="gbs-dialog__body" onSubmit={handleSubmit}>
          <h3 className="gbs-dialog__title">
            {mode === "edit"
              ? sitesText("linkEditTitle")
              : sitesText("linkCreateTitle")}
          </h3>

          <div className="gbs-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={tab === "main" ? "is-active" : ""}
              onClick={() => setTab("main")}
            >
              {sitesText("tabMain")}
            </button>
            <button
              type="button"
              role="tab"
              className={tab === "advanced" ? "is-active" : ""}
              onClick={() => setTab("advanced")}
            >
              {sitesText("tabAdvanced")}
            </button>
          </div>

          {tab === "main" ? (
            <div className="gbs-form-panel">
              <label className="gbs-field">
                <span>
                  {sitesText("pathLabel")}{" "}
                  <small>({sitesText("optional")})</small>
                </span>
                <input
                  className="gbs-input"
                  value={state.path}
                  placeholder={sitesText("linkPathPlaceholder")}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      path: event.target.value,
                    }))
                  }
                />
              </label>

              <div className="gbs-field">
                <span>{sitesText("templateLabel")}</span>
                <button
                  type="button"
                  className="gbs-template-pick"
                  onClick={() => {
                    closeExclusiveMenus();
                    setWindowPickerOpen(false);
                    setPickerOpen(true);
                  }}
                >
                  {state.templateName ||
                    (state.templateId
                      ? `#${state.templateId}`
                      : sitesText("templateNotSelected"))}
                </button>
              </div>

              <div className="gbs-field">
                <span>{sitesText("windowLabel")}</span>
                <button
                  type="button"
                  className="gbs-template-pick"
                  onClick={() => {
                    closeExclusiveMenus();
                    setPickerOpen(false);
                    setWindowPickerOpen(true);
                  }}
                >
                  {sitesText(
                    state.windowType === "CurrentWindow"
                      ? "windowCurrentWindow"
                      : state.windowType === "NewWindow"
                        ? "windowNewWindow"
                        : state.windowType === "AboutBlank"
                          ? "windowAboutBlank"
                          : "windowFakeWindow",
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="gbs-form-panel">
              <p className="gbs-form-section">{sitesText("advancedProtection")}</p>
              <label className="gbs-check">
                <input
                  type="checkbox"
                  checked={state.iframe}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      iframe: event.target.checked,
                    }))
                  }
                />
                <span>{sitesText("useIframe")}</span>
              </label>
              <label className="gbs-check">
                <input
                  type="checkbox"
                  checked={state.cloaking}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      cloaking: event.target.checked,
                    }))
                  }
                />
                <span>{sitesText("cloaking")}</span>
              </label>

              <ActionGroup
                title={sitesText("afterLog")}
                value={state.logError ? "error" : "redirect"}
                redirect={state.logRedirect}
                placeholder={sitesText("redirectUrlPlaceholder")}
                onChange={(next) =>
                  setState((current) => ({
                    ...current,
                    logError: next.mode === "error",
                    logRedirect: next.redirect,
                  }))
                }
              />
              <ActionGroup
                title={sitesText("afterMafile")}
                value={state.mafileError ? "error" : "redirect"}
                redirect={state.mafileRedirect}
                placeholder={sitesText("redirectUrlPlaceholderMafile")}
                onChange={(next) =>
                  setState((current) => ({
                    ...current,
                    mafileError: next.mode === "error",
                    mafileRedirect: next.redirect,
                    mafileSteamRedirect:
                      next.mode === "error" ? false : !next.redirect.trim(),
                  }))
                }
              />
              <ActionGroup
                title={sitesText("afterTrade")}
                value={state.tradeError ? "error" : "redirect"}
                redirect={state.tradeRedirect}
                placeholder={sitesText("redirectUrlPlaceholder")}
                onChange={(next) =>
                  setState((current) => ({
                    ...current,
                    tradeError: next.mode === "error",
                    tradeRedirect: next.redirect,
                  }))
                }
              />
            </div>
          )}

          {error ? <div className="gbs-dialog__hint is-error">{error}</div> : null}

          <div className="gbs-dialog__actions">
            <button type="button" className="gbd-button" onClick={onClose}>
              {sitesText("cancel")}
            </button>
            <button
              type="submit"
              className="gbd-button gbd-button--primary"
              disabled={busy}
            >
              {mode === "edit" ? sitesText("submitSave") : sitesText("submitAdd")}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={pickerRef}
        className="gbs-dialog gbs-template-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      >
        <div className="gbs-dialog__body">
          <h3 className="gbs-dialog__title">{sitesText("templatePickTitle")}</h3>
          <label className="gbs-search gbs-search--compact">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={templateQuery}
              placeholder={sitesText("templateSearch")}
              onChange={(event) => setTemplateQuery(event.target.value)}
            />
          </label>
          <div className="gbs-template-grid">
            {filteredTemplates.length ? (
              filteredTemplates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={`gbs-template-card${
                    String(state.templateId) === String(template.id)
                      ? " is-selected"
                      : ""
                  }`}
                  onClick={() => {
                    setState((current) => ({
                      ...current,
                      templateId: String(template.id),
                      templateName: template.name,
                    }));
                  }}
                  onDoubleClick={() => {
                    setState((current) => ({
                      ...current,
                      templateId: String(template.id),
                      templateName: template.name,
                    }));
                    setPickerOpen(false);
                  }}
                >
                  <span className="gbs-template-card__preview">
                    {template.preview ? (
                      <img src={template.preview} alt="" loading="lazy" />
                    ) : (
                      <span>{sitesText("templateNoPreview")}</span>
                    )}
                  </span>
                  <span className="gbs-template-card__meta">
                    <strong>{template.id}</strong>
                    <span>{template.name}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="gbs-empty">{sitesText("noTemplates")}</div>
            )}
          </div>
          <div className="gbs-dialog__actions">
            <button
              type="button"
              className="gbd-button"
              onClick={() => setPickerOpen(false)}
            >
              {sitesText("cancel")}
            </button>
            <button
              type="button"
              className="gbd-button gbd-button--primary"
              disabled={!state.templateId}
              onClick={() => setPickerOpen(false)}
            >
              {sitesText("templateSelect")}
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={windowPickerRef}
        className="gbs-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setWindowPickerOpen(false);
        }}
        onClose={() => setWindowPickerOpen(false)}
      >
        <div className="gbs-dialog__body">
          <h3 className="gbs-dialog__title">{sitesText("windowPickTitle")}</h3>
          <div className="gbs-window-pick">
            {(
              [
                ["FakeWindow", "windowFakeWindow"],
                ["CurrentWindow", "windowCurrentWindow"],
                ["NewWindow", "windowNewWindow"],
                ["AboutBlank", "windowAboutBlank"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`gbs-window-pick__item${
                  state.windowType === value ? " is-selected" : ""
                }`}
                onClick={() => {
                  setState((current) => ({ ...current, windowType: value }));
                  setWindowPickerOpen(false);
                }}
              >
                {sitesText(label)}
              </button>
            ))}
          </div>
          <div className="gbs-dialog__actions">
            <button
              type="button"
              className="gbd-button"
              onClick={() => setWindowPickerOpen(false)}
            >
              {sitesText("cancel")}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function ActionGroup({
  title,
  value,
  redirect,
  placeholder,
  onChange,
}: {
  title: string;
  value: "error" | "redirect";
  redirect: string;
  placeholder: string;
  onChange(next: { mode: "error" | "redirect"; redirect: string }): void;
}) {
  return (
    <div className="gbs-action-group">
      <p>{title}</p>
      <div className="gbs-action-group__radios">
        <label>
          <input
            type="radio"
            checked={value === "error"}
            onChange={() => onChange({ mode: "error", redirect })}
          />
          <span>{sitesText("actionError")}</span>
        </label>
        <label>
          <input
            type="radio"
            checked={value === "redirect"}
            onChange={() => onChange({ mode: "redirect", redirect })}
          />
          <span>{sitesText("actionRedirect")}</span>
        </label>
      </div>
      {value === "redirect" ? (
        <input
          className="gbs-input"
          value={redirect}
          placeholder={placeholder}
          onChange={(event) =>
            onChange({ mode: "redirect", redirect: event.target.value })
          }
        />
      ) : null}
    </div>
  );
}
