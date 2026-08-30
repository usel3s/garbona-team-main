import { useEffect, useState, type ReactNode } from "react";
import {
  dismissToast,
  installWorkerToast,
  restoreWorkerToast,
  subscribe,
  type ActionToast,
} from "../../actionToast";
import { toastText } from "../../toastCopy";
import { UploadCard } from "./upload-ui";

export function ActionToastHost() {
  const [toasts, setToasts] = useState<ActionToast[]>([]);

  useEffect(() => {
    installWorkerToast();
    return subscribe(setToasts);
  }, []);

  useEffect(() => () => restoreWorkerToast(), []);

  if (!toasts.length) return <div className="gbu-host" aria-live="polite" />;

  return (
    <div className="gbu-host" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <UploadCard
          key={toast.id}
          status={toast.status}
          progress={toast.progress}
          title={toast.title}
          description={toast.description}
          primaryButtonText={toast.primaryButtonText}
          secondaryButtonText={toast.secondaryButtonText}
          onClose={() => dismissToast(toast.id)}
          onPrimaryButtonClick={() => {
            if (toast.status === "error" && toast.onRetry) toast.onRetry();
            dismissToast(toast.id);
          }}
          onSecondaryButtonClick={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}

export function withActionToasts(node: ReactNode) {
  return (
    <>
      <ActionToastHost />
      {node}
    </>
  );
}

export function UploadToastGallery() {
  return (
    <section className="gbu-gallery" aria-label={toastText("waitTitle")}>
      <UploadCard
        status="uploading"
        progress={68}
        title="Just a minute..."
        description="Your file is uploading right now. Just give us a second to finish your upload."
        primaryButtonText="Cancel"
      />
      <UploadCard
        status="success"
        title="Your file was uploaded!"
        description="Your file was succesfully uploaded. You can copy the link to your clipboard."
        primaryButtonText="Copy Link"
        secondaryButtonText="Done"
      />
      <UploadCard
        status="error"
        title="We are so sorry!"
        description="There was and error and your file could not be uploaded. Would you like to try again?"
        primaryButtonText="Retry"
        secondaryButtonText="Cancel"
      />
    </section>
  );
}
