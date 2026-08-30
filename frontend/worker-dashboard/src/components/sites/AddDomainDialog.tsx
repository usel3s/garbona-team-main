import { Cloud, CloudCheck, Globe2, HelpCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { sitesText } from "../../sitesCopy";
import type { DomainCreatePayload } from "../../sitesTypes";

type WizardStep = "name" | "method" | "bind" | "done";
type BindType = "ip" | "cloudflare";

interface AddDomainDialogProps {
  open: boolean;
  busy?: boolean;
  bindIp?: string;
  bindNs?: string[];
  onClose(): void;
  onPrepare(domain: string): Promise<{
    ip?: string;
    ns?: string[];
    existing?: boolean;
  }>;
  onSubmit(payload: DomainCreatePayload): Promise<void>;
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

function StepTrail({ step }: { step: WizardStep }) {
  const items: Array<{ id: WizardStep; label: string }> = [
    { id: "name", label: sitesText("wizardStepName") },
    { id: "method", label: sitesText("wizardStepMethod") },
    { id: "bind", label: sitesText("wizardStepBind") },
  ];
  const order: WizardStep[] = ["name", "method", "bind", "done"];
  const current = Math.min(order.indexOf(step), 2);

  return (
    <nav className="gbs-wizard__trail" aria-label="Шаги">
      {items.map((item, index) => (
        <span key={item.id} className="gbs-wizard__trail-item">
          {index > 0 ? <span className="gbs-wizard__trail-sep">›</span> : null}
          <span
            className={`gbs-wizard__trail-label${
              index <= current ? " is-active" : ""
            }`}
          >
            {item.label}
          </span>
        </span>
      ))}
    </nav>
  );
}

export function AddDomainDialog({
  open,
  busy = false,
  bindIp = "",
  bindNs = [],
  onClose,
  onPrepare,
  onSubmit,
}: AddDomainDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tipId = useId();
  const [step, setStep] = useState<WizardStep>("name");
  const [domain, setDomain] = useState("");
  const [bindType, setBindType] = useState<BindType>("ip");
  const [isTransit, setIsTransit] = useState(false);
  const [ip, setIp] = useState(bindIp);
  const [ns, setNs] = useState<string[]>(bindNs);
  const [hint, setHint] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [finishLeft, setFinishLeft] = useState(6);
  const [openedExisting, setOpenedExisting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      return;
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setStep("name");
      setDomain("");
      setBindType("ip");
      setIsTransit(false);
      setIp(bindIp);
      setNs(bindNs);
      setHint("");
      setPreparing(false);
      setFinishLeft(6);
      setOpenedExisting(false);
    }
  }, [open, bindIp, bindNs]);

  useEffect(() => {
    if (step !== "done" || !open) return;
    setFinishLeft(6);
    const timer = window.setInterval(() => {
      setFinishLeft((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          onClose();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step, open, onClose]);

  const goMethod = async () => {
    const next = normalizeDomain(domain);
    if (!next || !next.includes(".")) {
      setHint(sitesText("stateError"));
      return;
    }
    setDomain(next);
    setHint("");
    setPreparing(true);
    try {
      const info = await onPrepare(next);
      if (info.existing) {
        await onSubmit({ domain: next });
        setOpenedExisting(true);
        setStep("done");
        return;
      }
      setIp(info.ip || "");
      setNs(Array.isArray(info.ns) ? info.ns.filter(Boolean) : []);
      setStep("method");
    } catch (error) {
      setHint(error instanceof Error ? error.message : sitesText("stateError"));
    } finally {
      setPreparing(false);
    }
  };

  const goBind = () => {
    if (bindType === "cloudflare" && ns.length < 2) {
      setHint("Cloudflare NS сейчас недоступны. Выберите IP.");
      return;
    }
    setHint("");
    setStep("bind");
  };

  const finishAdd = async () => {
    setHint("");
    try {
      await onSubmit({
        domain: normalizeDomain(domain),
        bindType,
        isTransit,
      });
      setStep("done");
    } catch (error) {
      setHint(error instanceof Error ? error.message : sitesText("stateError"));
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="gbs-wizard"
      onCancel={(event) => {
        event.preventDefault();
        if (step !== "done") onClose();
      }}
      onClose={onClose}
    >
      <div className="gbs-wizard__panel">
        {step !== "done" ? <StepTrail step={step} /> : null}

        {step === "name" ? (
          <>
            <header className="gbs-wizard__head">
              <h3>{sitesText("wizardNameTitle")}</h3>
              <p>{sitesText("wizardNameHint")}</p>
            </header>
            <label className="gbs-wizard__field">
              <span>{sitesText("wizardDomainLabel")}</span>
              <input
                className="gbs-wizard__input"
                value={domain}
                placeholder="example.com"
                autoComplete="off"
                autoFocus
                onChange={(event) => setDomain(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void goMethod();
                  }
                }}
              />
            </label>
            <div className="gbs-wizard__transit">
              <div className="gbs-wizard__transit-row">
                <label className="gbs-wizard__switch">
                  <input
                    type="checkbox"
                    checked={isTransit}
                    onChange={(event) => setIsTransit(event.target.checked)}
                  />
                  <span className="gbs-wizard__switch-ui" aria-hidden="true" />
                  <span className="gbs-wizard__switch-label">
                    {sitesText("wizardTransit")}
                  </span>
                </label>
                <span className="gbs-wizard__help-wrap">
                  <button
                    type="button"
                    className="gbs-wizard__help"
                    aria-label="Подсказка"
                    aria-describedby={tipId}
                  >
                    <HelpCircle size={14} />
                  </button>
                  <span
                    className="gbs-wizard__tip"
                    id={tipId}
                    role="tooltip"
                    aria-hidden="true"
                  >
                    <p>{sitesText("wizardTransitTip")}</p>
                    <p className="gbs-wizard__tip-example">
                      <strong>{sitesText("wizardTransitExample")}</strong>
                    </p>
                  </span>
                </span>
              </div>
            </div>
            {hint ? <div className="gbs-wizard__error">{hint}</div> : null}
            <div className="gbs-wizard__actions">
              <button
                type="button"
                className="gbd-button gbd-button--primary"
                disabled={busy || preparing || !domain.trim()}
                onClick={() => void goMethod()}
              >
                {sitesText("continue")}
              </button>
              <button
                type="button"
                className="gbd-button"
                onClick={onClose}
              >
                {sitesText("cancel")}
              </button>
            </div>
          </>
        ) : null}

        {step === "method" ? (
          <>
            <header className="gbs-wizard__head">
              <h3>{sitesText("wizardMethodTitle")}</h3>
              <p>{sitesText("wizardMethodHint")}</p>
            </header>
            <div className="gbs-wizard__methods">
              <button
                type="button"
                className={`gbs-wizard__method${bindType === "ip" ? " is-active" : ""}`}
                onClick={() => setBindType("ip")}
              >
                <Globe2 size={16} aria-hidden="true" />
                {sitesText("wizardMethodIp")}
              </button>
              <button
                type="button"
                className={`gbs-wizard__method${bindType === "cloudflare" ? " is-active" : ""}`}
                disabled={ns.length < 2}
                onClick={() => setBindType("cloudflare")}
              >
                <Cloud size={16} aria-hidden="true" />
                {sitesText("wizardMethodCf")}
              </button>
            </div>
            {ns.length < 2 ? (
              <div className="gbs-wizard__error">
                Cloudflare NS сейчас недоступны. Используйте IP.
              </div>
            ) : null}
            {hint ? <div className="gbs-wizard__error">{hint}</div> : null}
            <div className="gbs-wizard__actions">
              <button
                type="button"
                className="gbd-button gbd-button--primary"
                disabled={busy}
                onClick={goBind}
              >
                {sitesText("continue")}
              </button>
              <button
                type="button"
                className="gbd-button"
                disabled={busy}
                onClick={() => setStep("name")}
              >
                {sitesText("backStep")}
              </button>
            </div>
          </>
        ) : null}

        {step === "bind" ? (
          <>
            <header className="gbs-wizard__head">
              <h3>{sitesText("wizardBindTitle")}</h3>
              <p>
                {bindType === "cloudflare"
                  ? sitesText("wizardBindNsHint")
                  : sitesText("wizardBindIpHint")}
              </p>
            </header>
            {bindType === "cloudflare" ? (
              <div className="gbs-wizard__ns">
                <label className="gbs-wizard__field">
                  <span>{sitesText("wizardNs1")}</span>
                  <input
                    className="gbs-wizard__input"
                    value={ns[0] || "—"}
                    readOnly
                  />
                </label>
                <label className="gbs-wizard__field">
                  <span>{sitesText("wizardNs2")}</span>
                  <input
                    className="gbs-wizard__input"
                    value={ns[1] || "—"}
                    readOnly
                  />
                </label>
              </div>
            ) : (
              <label className="gbs-wizard__field">
                <span>{sitesText("wizardIpLabel")}</span>
                <input
                  className="gbs-wizard__input"
                  value={ip || "—"}
                  readOnly
                />
              </label>
            )}
            {hint ? <div className="gbs-wizard__error">{hint}</div> : null}
            <div className="gbs-wizard__actions">
              <button
                type="button"
                className="gbd-button gbd-button--primary"
                disabled={busy}
                onClick={() => void finishAdd()}
              >
                {sitesText("addDomain")}
              </button>
              <button
                type="button"
                className="gbd-button"
                disabled={busy}
                onClick={() => setStep("method")}
              >
                {sitesText("backStep")}
              </button>
            </div>
          </>
        ) : null}

        {step === "done" ? (
          <>
            <header className="gbs-wizard__head gbs-wizard__head--plain">
              <h3>{sitesText("wizardSuccessTitle")}</h3>
            </header>
            <div className="gbs-wizard__success">
              <span className="gbs-wizard__success-icon" aria-hidden="true">
                <CloudCheck size={22} />
              </span>
              <div>
                <strong>
                  {openedExisting
                    ? sitesText("domainExistsOpen")
                    : sitesText("wizardSuccessHeading")}
                </strong>
                <p>
                  {openedExisting ? (
                    sitesText("domainExistsTeam")
                  ) : (
                    <>
                      {sitesText("wizardSuccessBody").split("dnschecker.org")[0]}
                      <a
                        href="https://dnschecker.org"
                        target="_blank"
                        rel="noreferrer"
                      >
                        dnschecker.org
                      </a>
                      {sitesText("wizardSuccessBody").includes("dnschecker.org")
                        ? sitesText("wizardSuccessBody").split("dnschecker.org")[1]
                        : null}
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="gbs-wizard__actions">
              <button
                type="button"
                className="gbd-button gbd-button--primary"
                onClick={onClose}
              >
                {sitesText("finish")} ({finishLeft})
              </button>
            </div>
          </>
        ) : null}
      </div>
    </dialog>
  );
}
