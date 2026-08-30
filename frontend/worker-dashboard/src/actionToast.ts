import { toastText } from "./toastCopy";

export type ToastStatus = "uploading" | "success" | "error";

export type ActionToast = {
  id: string;
  status: ToastStatus;
  progress?: number;
  title: string;
  description: string;
  primaryButtonText: string;
  secondaryButtonText?: string;
  sticky?: boolean;
  pace?: "fast" | "slow";
  onRetry?: () => void;
};

type Listener = (toasts: ActionToast[]) => void;

const MAX_VISIBLE = 3;
const SUCCESS_MS = 4200;
const ERROR_MS = 6400;

let toasts: ActionToast[] = [];
const listeners = new Set<Listener>();
const dismissTimers = new Map<string, number>();
const progressTimers = new Map<string, number>();
let previousToast: Window["WorkerToast"] | undefined;
let installed = false;

function emit() {
  const snapshot = toasts;
  listeners.forEach((listener) => listener(snapshot));
}

function nextId() {
  return globalThis.crypto?.randomUUID?.() || `toast-${Date.now()}-${Math.random()}`;
}

function clearTimers(id: string) {
  const dismissAt = dismissTimers.get(id);
  if (dismissAt) window.clearTimeout(dismissAt);
  dismissTimers.delete(id);
  const progressAt = progressTimers.get(id);
  if (progressAt) window.clearTimeout(progressAt);
  progressTimers.delete(id);
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

export function dismissToast(id: string) {
  clearTimers(id);
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

function scheduleDismiss(id: string, ms: number) {
  clearTimers(id);
  if (ms <= 0) return;
  dismissTimers.set(
    id,
    window.setTimeout(() => dismissToast(id), ms),
  );
}

function tickProgress(id: string, current: number) {
  const toast = toasts.find((item) => item.id === id);
  if (!toast || toast.status !== "uploading") return;
  const slow = toast.pace === "slow";
  const next = Math.min(
    slow ? 92 : 88,
    current + (slow ? 1 + Math.random() * 2 : 3 + Math.random() * 9),
  );
  updateToast(id, { progress: Math.round(next) });
  progressTimers.set(
    id,
    window.setTimeout(() => tickProgress(id, next), slow ? 1100 : 280),
  );
}

function startProgress(id: string, initial?: number) {
  const start = initial ?? 18;
  progressTimers.set(
    id,
    window.setTimeout(() => tickProgress(id, start), 240),
  );
}

export function updateToast(id: string, patch: Partial<ActionToast>) {
  const current = toasts.find((toast) => toast.id === id);
  if (!current) return;
  const next = { ...current, ...patch };
  toasts = toasts.map((toast) => (toast.id === id ? next : toast));
  if (next.status !== "uploading") {
    const progressAt = progressTimers.get(id);
    if (progressAt) window.clearTimeout(progressAt);
    progressTimers.delete(id);
    if (!next.sticky) {
      scheduleDismiss(id, next.status === "error" ? ERROR_MS : SUCCESS_MS);
    }
  }
  emit();
}

export function pushToast(input: Omit<ActionToast, "id"> & { id?: string }) {
  const id = input.id || nextId();
  while (toasts.length >= MAX_VISIBLE) {
    dismissToast(toasts[0].id);
  }
  const toast: ActionToast = { ...input, id };
  toasts = [...toasts, toast];
  if (toast.status === "uploading") {
    startProgress(id, toast.progress);
  } else if (!toast.sticky) {
    scheduleDismiss(id, toast.status === "error" ? ERROR_MS : SUCCESS_MS);
  }
  emit();
  return id;
}

export function friendlyToastError(error: unknown): string {
  if (previousToast?.friendlyError) {
    return previousToast.friendlyError(error);
  }
  const status = Number(
    error && typeof error === "object" && "status" in error
      ? (error as { status?: number }).status
      : 0,
  );
  const raw = String(
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? (error as { message?: string }).message
        : error || "",
  ).trim();
  const lower = raw.toLowerCase();

  if (status === 401 || /unauthorized|session|сесси/i.test(raw)) {
    return "Сессия истекла. Войдите снова.";
  }
  if (status === 403 || /forbidden|нет доступа|access denied/i.test(raw)) {
    return "Недостаточно прав для этого действия.";
  }
  if (
    status === 409 ||
    /request failed with status code 409/i.test(lower)
  ) {
    if (raw && !/^request failed with status code/i.test(raw) && raw.length > 8) {
      return raw;
    }
    return "Этот адрес уже занят. Укажи другой path или оставь поле пустым.";
  }
  if (status >= 500 || /http 5\d\d|internal|server error/i.test(lower)) {
    return "Сервер временно недоступен. Попробуйте ещё раз чуть позже.";
  }
  if (/network|failed to fetch|load failed|offline/i.test(lower)) {
    return "Нет соединения. Проверьте интернет.";
  }
  return raw || toastText("errorBody");
}

export function showLoadingToast(
  description: string,
  title = toastText("waitTitle"),
  options?: { slow?: boolean },
) {
  return pushToast({
    status: "uploading",
    progress: options?.slow ? 6 : 22,
    title,
    description: description || toastText("waitBody"),
    primaryButtonText: toastText("cancel"),
    sticky: true,
    pace: options?.slow ? "slow" : "fast",
  });
}

export function showSuccessToast(title: string, description = toastText("successBody")) {
  return pushToast({
    status: "success",
    title,
    description,
    primaryButtonText: toastText("done"),
  });
}

export function showErrorToast(
  error: unknown,
  options?: { title?: string; onRetry?: () => void },
) {
  const description =
    typeof error === "string" ? error : friendlyToastError(error);
  return pushToast({
    status: "error",
    title: options?.title || toastText("errorTitle"),
    description: description || toastText("errorBody"),
    primaryButtonText: options?.onRetry ? toastText("retry") : toastText("close"),
    secondaryButtonText: options?.onRetry ? toastText("cancel") : undefined,
    onRetry: options?.onRetry,
  });
}

export async function runToastAction<T>(
  labels: { loading: string; success: string; successBody?: string },
  task: () => Promise<T>,
  options?: { surfaceError?: boolean },
): Promise<T> {
  const id = showLoadingToast(labels.loading);
  try {
    const result = await task();
    updateToast(id, {
      status: "success",
      progress: undefined,
      title: labels.success,
      description: labels.successBody || toastText("successBody"),
      primaryButtonText: toastText("done"),
      secondaryButtonText: undefined,
      sticky: false,
    });
    return result;
  } catch (error) {
    if (options?.surfaceError === false) {
      dismissToast(id);
    } else {
      updateToast(id, {
        status: "error",
        progress: undefined,
        title: toastText("errorTitle"),
        description: friendlyToastError(error),
        primaryButtonText: toastText("close"),
        secondaryButtonText: toastText("cancel"),
        sticky: false,
      });
    }
    throw error;
  }
}

export function installWorkerToast() {
  if (installed || import.meta.env.MODE === "test") return;
  previousToast = window.WorkerToast;
  installed = true;
  window.WorkerToast = {
    success(message) {
      showSuccessToast(String(message || "").trim() || toastText("successBody"));
    },
    error(error) {
      showErrorToast(error);
    },
    info(message) {
      showSuccessToast(String(message || "").trim() || toastText("successBody"));
    },
    friendlyError: friendlyToastError,
  };
}

export function restoreWorkerToast() {
  if (!installed) return;
  window.WorkerToast = previousToast;
  previousToast = undefined;
  installed = false;
  toasts.forEach((toast) => clearTimers(toast.id));
  toasts = [];
  emit();
}
