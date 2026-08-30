import * as React from "react";
import { X, ArrowDownCircle, CheckCircle, XCircle } from "lucide-react";
import clsx from "clsx";
import { toastText } from "../../toastCopy";
import "./upload-ui.css";

export interface UploadCardProps {
  status: "uploading" | "success" | "error";
  progress?: number;
  title: string;
  description: string;
  primaryButtonText: string;
  onPrimaryButtonClick?: () => void;
  secondaryButtonText?: string;
  onSecondaryButtonClick?: () => void;
  onClose?: () => void;
}

export const UploadCard: React.FC<UploadCardProps> = ({
  status,
  progress,
  title,
  description,
  primaryButtonText,
  onPrimaryButtonClick,
  secondaryButtonText,
  onSecondaryButtonClick,
  onClose,
}) => {
  const clamped =
    typeof progress === "number"
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : undefined;

  const renderIcon = () => {
    switch (status) {
      case "uploading":
        return <ArrowDownCircle className="icon" aria-hidden="true" />;
      case "success":
        return <CheckCircle className="icon" aria-hidden="true" />;
      case "error":
        return <XCircle className="icon" aria-hidden="true" />;
      default:
        return null;
    }
  };

  return (
    <div
      className={clsx("gbu-card", "is-entering", {
        "is-uploading": status === "uploading",
        "is-success": status === "success",
        "is-error": status === "error",
      })}
      role={status === "error" ? "alert" : "status"}
    >
      <button
        type="button"
        className="gbu-close"
        aria-label={toastText("dismiss")}
        onClick={onClose}
      >
        <X size={16} />
      </button>
      <div className="gbu-body">
        <span className="gbu-icon">{renderIcon()}</span>
        <div className="gbu-copy">
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
          {status === "uploading" && (
            <div className="gbu-progress">
              <div className="gbu-progress-track">
                {clamped != null ? (
                  <div className="gbu-progress-meta">{clamped}%</div>
                ) : null}
                <div
                  className={clsx("gbu-progress-bar", {
                    "is-indeterminate": clamped == null,
                  })}
                  style={
                    {
                      "--progress-width": `${clamped ?? 0}%`,
                    } as React.CSSProperties
                  }
                >
                  <div className="gbu-progress-bar__fill" />
                </div>
              </div>
              <button
                type="button"
                className="gbu-btn"
                onClick={onPrimaryButtonClick}
              >
                {primaryButtonText}
              </button>
            </div>
          )}
        </div>
      </div>
      {(status === "success" || status === "error") && (
        <div className="gbu-actions">
          <button type="button" className="gbu-btn" onClick={onPrimaryButtonClick}>
            {primaryButtonText}
          </button>
          {secondaryButtonText ? (
            <button
              type="button"
              className="gbu-btn"
              onClick={onSecondaryButtonClick}
            >
              {secondaryButtonText}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};
