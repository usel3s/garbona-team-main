import { dashboardLanguage } from "./copy";

const RU = {
  waitTitle: "Секунду...",
  waitBody: "Операция выполняется. Это займёт немного времени.",
  successBody: "Действие выполнено. Можно закрыть это уведомление.",
  errorTitle: "Не получилось",
  errorBody: "Попробуйте ещё раз или закройте уведомление.",
  done: "Готово",
  close: "Закрыть",
  cancel: "Отмена",
  retry: "Повторить",
  dismiss: "Закрыть уведомление",
};

const EN: Record<keyof typeof RU, string> = {
  waitTitle: "Just a minute...",
  waitBody: "This will only take a moment.",
  successBody: "Done. You can close this notification.",
  errorTitle: "We are so sorry!",
  errorBody: "Something went wrong. Would you like to try again?",
  done: "Done",
  close: "Close",
  cancel: "Cancel",
  retry: "Retry",
  dismiss: "Dismiss notification",
};

export type ToastCopyKey = keyof typeof RU;

export function toastText(key: ToastCopyKey): string {
  return (dashboardLanguage() === "en" ? EN : RU)[key];
}
