"use client";

import { useEffect, useState } from "react";
import { FileUpload } from "@ark-ui/react/file-upload";
import { User } from "lucide-react";
import "./file-upload-1.css";

export type AvatarFileUploadProps = {
  /** Current preview URL (object URL, data URL, or remote). */
  value?: string;
  onChange?: (next: { url: string; file: File | null }) => void;
  labels?: {
    upload?: string;
    change?: string;
    remove?: string;
  };
};

/**
 * Compact avatar image uploader (Ark FileUpload), styled for the worker panel
 * dark theme — no Tailwind required in this island.
 */
export function AvatarFileUpload({
  value,
  onChange,
  labels,
}: AvatarFileUploadProps) {
  const [localUrl, setLocalUrl] = useState(value || "");
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    setLocalUrl(value || "");
  }, [value]);

  useEffect(() => {
    return () => {
      if (localUrl.startsWith("blob:")) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  const hasImage = Boolean(localUrl);
  const uploadLabel = labels?.upload ?? "Загрузить";
  const changeLabel = labels?.change ?? "Заменить";
  const removeLabel = labels?.remove ?? "Удалить";

  return (
    <FileUpload.Root
      maxFiles={1}
      accept="image/*"
      className="gfu-root"
      onFileAccept={(details) => {
        const file = details.files[0];
        if (!file) return;
        if (localUrl.startsWith("blob:")) URL.revokeObjectURL(localUrl);
        const url = URL.createObjectURL(file);
        setLocalUrl(url);
        setFileName(file.name);
        onChange?.({ url, file });
      }}
      onFileReject={() => {
        /* keep previous */
      }}
    >
      <div className="gfu-row">
        <div className="gfu-preview" aria-hidden={!hasImage}>
          {hasImage ? (
            <img src={localUrl} alt="" />
          ) : (
            <User size={18} strokeWidth={1.7} />
          )}
        </div>

        <FileUpload.Trigger className="gfu-trigger">
          {hasImage ? changeLabel : uploadLabel}
        </FileUpload.Trigger>
      </div>

      {hasImage && fileName ? (
        <div className="gfu-meta">
          <span className="gfu-name" title={fileName}>
            {fileName}
          </span>
          <button
            type="button"
            className="gfu-remove"
            onClick={() => {
              if (localUrl.startsWith("blob:")) URL.revokeObjectURL(localUrl);
              setLocalUrl("");
              setFileName("");
              onChange?.({ url: "", file: null });
            }}
          >
            {removeLabel}
          </button>
        </div>
      ) : null}

      <FileUpload.HiddenInput />
    </FileUpload.Root>
  );
}

export default AvatarFileUpload;
