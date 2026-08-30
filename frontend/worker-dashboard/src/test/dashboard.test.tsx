import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "../components/ActivityFeed";
import { StatusBadge } from "../components/StatusBadge";
import Dashboard from "../Dashboard";
import {
  isDashboardDemoRequested,
  normalizeOverview,
} from "../api";
import { createMockOverview } from "../mock";
import type {
  ActivityFilters,
  DashboardApi,
  DashboardRenderContext,
} from "../types";
import {
  classifyAccountStatus,
  combineActivity,
  filterActivities,
  activityLookupId,
  mergeLookupActivity,
  isOnSaleEvent,
  mafileHoursLeft,
  normalizeActivityStatus,
} from "../utils";

const context: DashboardRenderContext = {
  main: document.createElement("main"),
  user: {
    telegramId: "100",
    username: "tester",
    firstName: "Тест",
  },
};

function mockApi(): DashboardApi {
  const overview = createMockOverview(14);
  return {
    getOverview: vi.fn().mockResolvedValue(overview),
    getLogDetail: vi.fn().mockResolvedValue(overview.recentLogs[0]),
    runLogAction: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("dashboard data adapter", () => {
  it("normalizes incomplete API responses into safe values", () => {
    const normalized = normalizeOverview(
      {
        user: { username: "worker", walletUsd: "17.50" },
        kpi: { logsPeriod: "4" },
        series: [{ date: "2026-08-20", profitUsd: "8.2" }],
        recentLogs: [{ id: 5, status: "Невалид", priceUsd: "0" }],
      },
      7,
    );

    expect(normalized.days).toBe(7);
    expect(normalized.user.profitTotalUsd).toBe(17.5);
    expect(normalized.kpi.logsPeriod).toBe(4);
    expect(normalized.series[0].profitUsd).toBe(8.2);
    expect(normalized.recentLogs[0].id).toBe("5");
    expect(normalized.recentMafiles).toEqual([]);
  });

  it("only enables URL demo mode through an explicit flag", () => {
    window.history.replaceState({}, "", "/app/?dashboardDemo=1");
    expect(isDashboardDemoRequested()).toBe(true);
    window.history.replaceState({}, "", "/app/?demo=1");
    expect(isDashboardDemoRequested()).toBe(false);
  });

  it("derives, filters and sorts activity without misclassifying invalid rows", () => {
    const rows = combineActivity(createMockOverview(7));
    expect(normalizeActivityStatus("Невалид")).toBe("invalid");

    const filters: ActivityFilters = {
      query: "",
      type: "log",
      status: "valid",
      sort: "price-desc",
    };
    const result = filterActivities(rows, filters);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((row) => row.eventType === "log")).toBe(true);
    expect(result.every((row) => normalizeActivityStatus(row.status) === "valid")).toBe(
      true,
    );
    expect(result[0].priceUsd).toBeGreaterThanOrEqual(result[1].priceUsd);
  });

  it("looks up MaFile IDs even when the row is missing from the overview page", () => {
    expect(activityLookupId("827530")).toBe("827530");
    expect(activityLookupId("#827530")).toBe("827530");
    expect(activityLookupId("helium")).toBe("");

    const missing = {
      id: "827530",
      sourceId: "827530",
      eventType: "mafile" as const,
      username: "mnyklz",
      sourcePage: "north.team/offer",
      status: "MaFile",
      createdAt: new Date().toISOString(),
      priceUsd: 78,
    };
    const merged = mergeLookupActivity(
      combineActivity(createMockOverview(7)),
      [missing],
    );
    expect(merged.some((row) => row.sourceId === "827530")).toBe(true);
  });
});

describe("MaFile status from UProject", () => {
  it("uses remaining session hours, not time since createdAt", () => {
    const createdAt = new Date(Date.now() - 4 * 3600_000).toISOString();
    const unlockAt = new Date(Date.now() + 45 * 3600_000).toISOString();
    expect(
      mafileHoursLeft({
        mafileTime: unlockAt,
        mafileSessionHoursLeft: 4,
      }),
    ).toBe(45);

    render(
      <StatusBadge
        event={{
          status: "MaFile",
          eventType: "mafile",
          createdAt,
          mafileTime: unlockAt,
        }}
      />,
    );
    expect(screen.getByText("MaFile")).toBeInTheDocument();
    expect(screen.getByText("45ч")).toBeInTheDocument();
    expect(screen.queryByText("4ч")).not.toBeInTheDocument();
  });

  it("marks a provisionally invalid MaFile session with a red light tooltip", () => {
    render(
      <StatusBadge
        event={{
          status: "MaFile",
          eventType: "mafile",
          createdAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
          mafileTime: new Date(Date.now() + 45 * 3600_000).toISOString(),
          sessionInvalid: true,
          sessionCheckedAt: "2026-08-26T11:40:00.000Z",
        }}
      />,
    );
    const badge = screen.getByText("MaFile").closest(".gbd-status");
    expect(badge).toHaveClass("is-session-invalid");
    expect(badge).not.toHaveAttribute("title");
    fireEvent.mouseEnter(badge as HTMLElement);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(/Сессия невалидна/i);
    expect(tip).toHaveTextContent(/Предварительно сессия MaFile аккаунта невалидна/i);
    expect(tip.querySelector(".gbd-status-tip__card")).toHaveClass("is-danger");
    expect(tip).not.toHaveTextContent(/UProject/i);
  });
});

describe("UProject account statuses in the activity badge", () => {
  it("maps OnSell, Empty and MaFile instead of showing Без статуса", () => {
    expect(classifyAccountStatus("OnSell")).toBe("on_sale");
    expect(classifyAccountStatus("На продаже")).toBe("on_sale");
    expect(classifyAccountStatus("Продается")).toBe("on_sale");
    expect(classifyAccountStatus("Empty")).toBe("empty");
    expect(classifyAccountStatus("Пустой")).toBe("empty");
    expect(classifyAccountStatus("MaFile")).toBe("mafile");
    expect(isOnSaleEvent({ status: "OnSell", saleStatus: "none" })).toBe(true);

    const { rerender } = render(
      <StatusBadge event={{ status: "OnSell", eventType: "log", createdAt: "" }} />,
    );
    expect(screen.getByText("Продается")).toBeInTheDocument();
    expect(screen.queryByText("Без статуса")).not.toBeInTheDocument();

    rerender(
      <StatusBadge event={{ status: "Empty", eventType: "log", createdAt: "" }} />,
    );
    expect(screen.getByText("Пустой")).toBeInTheDocument();

    rerender(
      <StatusBadge
        event={{ status: "Пустой", eventType: "mafile", createdAt: "" }}
      />,
    );
    expect(screen.getByText("Пустой")).toBeInTheDocument();
    expect(screen.queryByText("MaFile")).not.toBeInTheDocument();

    rerender(
      <StatusBadge event={{ status: "MaFile", eventType: "mafile", createdAt: "" }} />,
    );
    expect(screen.getByText("MaFile")).toBeInTheDocument();
  });

  it("shows sale lifecycle status even when the raw UProject status is stale", () => {
    expect(isOnSaleEvent({ status: "Валид", saleStatus: "on_sale" })).toBe(true);

    const { rerender } = render(
      <StatusBadge
        event={{
          status: "OnSell",
          saleStatus: "sold",
          eventType: "log",
          createdAt: "",
        }}
      />,
    );
    expect(screen.getByText("Продан")).toBeInTheDocument();
    expect(screen.queryByText("Продается")).not.toBeInTheDocument();

    rerender(
      <StatusBadge
        event={{
          status: "Продажа отменена · лот удалён",
          saleStatus: "cancelled",
          eventType: "log",
          createdAt: "",
        }}
      />,
    );
    expect(screen.getByText("Продажа отменена · лот удалён")).toBeInTheDocument();
  });
});

describe("ActivityFeed pagination", () => {
  it("shows five events per page and hides pagination for short lists", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      id: String(1000 + index),
      sourceId: String(1000 + index),
      eventType: index % 2 ? "mafile" : "log",
      username: `worker_${index}`,
      sourcePage: `north.team/w${index}`,
      status: "Валид",
      createdAt: new Date(Date.now() - index * 3600_000).toISOString(),
      priceUsd: 10 + index,
      country: "RU",
    })) as import("../types").ActivityEvent[];

    const filters: ActivityFilters = {
      query: "",
      type: "all",
      status: "all",
      sort: "date-desc",
    };

    const onOpen = vi.fn();
    const { rerender } = render(
      <ActivityFeed
        allEvents={events}
        events={events}
        filters={filters}
        onFiltersChange={vi.fn()}
        onOpen={onOpen}
      />,
    );

    expect(screen.getAllByRole("button", { name: /Открыть детали:/ })).toHaveLength(5);
    expect(screen.getByText("Страница 1 из 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.getAllByRole("button", { name: /Открыть детали:/ })).toHaveLength(5);
    expect(screen.getByText("Страница 2 из 3")).toBeInTheDocument();
    expect(screen.getByText("north.team/w5")).toBeInTheDocument();
    expect(screen.queryByText("worker_5")).not.toBeInTheDocument();

    rerender(
      <ActivityFeed
        allEvents={events.slice(0, 4)}
        events={events.slice(0, 4)}
        filters={{ ...filters, query: "worker_1" }}
        onFiltersChange={vi.fn()}
        onOpen={onOpen}
      />,
    );
    expect(screen.queryByText("Страница 1 из")).not.toBeInTheDocument();
  });
});

describe("Dashboard", () => {
  it("renders the bento overview, chart controls and activity feed", async () => {
    const overview = createMockOverview(14);
    render(
      <Dashboard
        context={context}
        api={mockApi()}
        initialData={overview}
        initialDemo
      />,
    );

    expect(screen.getByText("$12840.55")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Динамика по периоду" })).toBeInTheDocument();
    const earningsToggle = screen.getByRole("button", { name: "Профит" });
    expect(earningsToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(earningsToggle);
    expect(earningsToggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "helium" },
    });
    expect(screen.getByText("falconspro.org/offer")).toBeInTheDocument();
    expect(screen.queryByText("falconspro.org/")).not.toBeInTheDocument();
    expect(screen.queryByText("helium_lane")).not.toBeInTheDocument();
  });

  it("opens an accessible event drawer with inventory tabs", async () => {
    const overview = createMockOverview(14);
    const api = mockApi();
    render(
      <Dashboard
        context={context}
        api={api}
        initialData={overview}
        initialDemo
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Открыть детали: #58319/,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      Array.from(dialog.querySelectorAll(".gbd-game-tab")).some(
        (node) => /CS2 \(\d+\) \$/.test(node.textContent || ""),
      ),
    ).toBe(true);
    expect(api.getLogDetail).toHaveBeenCalledWith("58319");
    const icons = dialog.querySelectorAll(".gbd-item-card__art img");
    expect(icons.length).toBeGreaterThan(0);
    expect(icons[0]?.getAttribute("src") || "").toContain(
      "community.cloudflare.steamstatic.com/economy/image/",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("resolves a MaFile ID that is not in the loaded activity page", async () => {
    const overview = createMockOverview(14);
    const missing = {
      ...overview.recentMafiles[0],
      id: "827530",
      sourceId: "827530",
      eventType: "mafile" as const,
      sourcePage: "north.team/827530",
      username: "mnyklz",
    };
    const api = mockApi();
    api.getLogDetail = vi.fn().mockResolvedValue(missing);

    render(
      <Dashboard
        context={context}
        api={api}
        initialData={overview}
        initialDemo={false}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "827530" },
    });
    await waitFor(() => expect(api.getLogDetail).toHaveBeenCalledWith("827530"));
    expect(await screen.findByText("north.team/827530")).toBeInTheDocument();
  });

  it("shows an error state with retry and no demo fallback", async () => {
    const api: DashboardApi = {
      getOverview: vi.fn().mockRejectedValue(new Error("Network offline")),
      getLogDetail: vi.fn(),
      runLogAction: vi.fn(),
    };
    render(<Dashboard context={context} api={api} />);

    expect(await screen.findByText("Сводку не удалось загрузить")).toBeInTheDocument();
    expect(screen.getByText("Network offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Повторить/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Открыть демо/ })).not.toBeInTheDocument();
  });
});
