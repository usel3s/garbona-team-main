import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

const dialogProto = HTMLDialogElement.prototype;
dialogProto.showModal = function showModal() {
  this.setAttribute("open", "");
};
dialogProto.close = function close() {
  if (!this.hasAttribute("open")) return;
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};

beforeEach(() => {
  window.WorkerViews = {};
  window.WorkerPrefs = {
    get: () => ({
      lang: "ru",
      currency: "USD",
      rate: 1,
      defaultPeriod: 14,
    }),
  };
  window.WorkerFormat = {
    money: (value) => `$${Number(value || 0).toFixed(2)}`,
    date: (value) => new Date(value).toLocaleString("ru-RU"),
    shortDayLabel: (value) => value.slice(5),
    shortDayTime: (value) => value,
    checkDateTime: (value) => value,
    appAsset: (path) => `/app/${path}`,
  };
  window.WorkerI18n = {
    lang: () => "ru",
    t: (key) => key,
  };
  window.WorkerToast = {
    success: () => undefined,
    error: () => undefined,
    info: () => undefined,
  };
  window.history.replaceState({}, "", "/app/");
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("gbd-drawer-open");
});
