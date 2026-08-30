import prefsUrl from "../../../panel/worker/js/prefs.js?url";
import i18nUrl from "../../../panel/worker/js/i18n.js?url";
import formatUrl from "../../../panel/worker/js/format.js?url";
import dropdownUrl from "../../../panel/worker/js/dropdown.js?url";
import chartsUrl from "../../../panel/worker/js/charts.js?url";

let corePromise: Promise<void> | null = null;
const viewPromises = new Map<string, Promise<void>>();

export function loadClassicScript(src: string) {
  const existing = document.querySelector(
    `script[data-gph-src="${src}"], script[data-gwl-src="${src}"]`,
  );
  if (existing) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.gphSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export function ensureWorkerToast() {
  if (window.WorkerToast) return;
  window.WorkerToast = {
    success(message) {
      console.info(message);
    },
    error(error) {
      console.error(error);
    },
    info(message) {
      console.info(message);
    },
    friendlyError(error) {
      return error instanceof Error ? error.message : String(error ?? "Ошибка");
    },
  };
}

export function ensurePanelCoreRuntime() {
  if (!corePromise) {
    corePromise = (async () => {
      ensureWorkerToast();
      await loadClassicScript(prefsUrl);
      await loadClassicScript(i18nUrl);
      await loadClassicScript(formatUrl);
      await loadClassicScript(dropdownUrl);
      await loadClassicScript(chartsUrl);
    })();
  }
  return corePromise;
}

export function ensurePanelViewRuntime(viewUrl: string) {
  let promise = viewPromises.get(viewUrl);
  if (!promise) {
    promise = (async () => {
      await ensurePanelCoreRuntime();
      await loadClassicScript(viewUrl);
    })();
    viewPromises.set(viewUrl, promise);
  }
  return promise;
}

export const PREVIEW_USER = {
  telegramId: "1029384756",
  username: "demo_operator",
  firstName: "Алекс",
};
