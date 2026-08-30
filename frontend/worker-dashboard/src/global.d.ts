import type { DashboardRenderContext } from "./types";

export {};

declare global {
  interface Window {
    WorkerAPI?: {
      get<T = unknown>(path: string, options?: { force?: boolean }): Promise<T>;
      post<T = unknown>(path: string, body?: unknown): Promise<T>;
      patch<T = unknown>(path: string, body?: unknown): Promise<T>;
      del<T = unknown>(path: string): Promise<T>;
      bust(pathPrefix?: string): void;
    };
    WorkerViews: Record<
      string,
      ((context: DashboardRenderContext) => Promise<void> | void) | unknown
    >;
    WorkerFormat?: {
      money(value: number): string;
      date(value: string): string;
      shortDayLabel(value: string): string;
      shortDayTime(value: string): string;
      checkDateTime(value: string): string;
      appAsset(path: string): string;
      escapeHtml?(value: string): string;
    };
    WorkerI18n?: {
      t(key: string, variables?: Record<string, string | number>): string;
      lang(): "ru" | "en" | string;
    };
    WorkerPrefs?: {
      get(): {
        lang?: string;
        theme?: string;
        currency?: string;
        rate?: number;
        defaultPeriod?: number;
      };
      set?(patch: Record<string, unknown>): void;
    };
    WorkerToast?: {
      success(message: string): void;
      error(error: unknown): void;
      info(message: string): void;
      friendlyError?(error: unknown): string;
    };
    WorkerShell?: {
      navigate(viewId: string, options?: { refresh?: boolean; historyMode?: string }): Promise<void> | void;
      currentView(): string;
      refreshBranchNav?(): Promise<void>;
      branchMembership?(): string;
    };
    WorkerDashboard?: {
      mount(context: DashboardRenderContext): Promise<void>;
      unmount(): void;
    };
    WorkerSites?: {
      mount(context: DashboardRenderContext): Promise<void>;
      unmount(): void;
    };
  }
}
