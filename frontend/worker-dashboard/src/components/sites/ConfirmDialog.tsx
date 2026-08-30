import { useEffect, useRef } from "react";
import { sitesText } from "../../sitesCopy";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = sitesText("actionDelete"),
  cancelLabel = sitesText("cancel"),
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      return;
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="gbs-dialog gbs-confirm"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <form
        method="dialog"
        className="gbs-dialog__body"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <h3 className="gbs-dialog__title">{title}</h3>
        {message ? <p className="gbs-dialog__message">{message}</p> : null}
        <div className="gbs-dialog__actions">
          <button type="button" className="gbd-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={`gbd-button ${danger ? "gbs-button--danger" : "gbd-button--primary"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
