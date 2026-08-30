import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dashboardApi, isDashboardDemoRequested, readableApiError } from "./api";
import { text } from "./copy";
import { createMockOverview } from "./mock";
import type {
  ActivityEvent,
  ActivityFilters,
  DashboardApi,
  DashboardOverview,
  DashboardPeriod,
  DashboardRenderContext,
} from "./types";
import {
  combineActivity,
  filterActivities,
  activityLookupId,
  mergeLookupActivity,
} from "./utils";
import { ActivityFeed } from "./components/ActivityFeed";
import {
  DashboardHeader,
  ErrorState,
  PartialDataAlert,
  SkeletonState,
} from "./components/DashboardBlocks";
import { DynamicsChart } from "./components/DynamicsChart";
import { EventDrawer } from "./components/EventDrawer";
import { KpiStatsSection } from "./components/KpiStatsSection";
import { withActionToasts } from "./components/ui/ActionToastHost";
import "./theme.css";
import "./dashboard.css";

const DEFAULT_FILTERS: ActivityFilters = {
  query: "",
  type: "all",
  status: "all",
  sort: "date-desc",
};

function preferredPeriod(): DashboardPeriod {
  const workerValue = Number(window.WorkerViews?.dashboardPeriodDays);
  const prefsValue = Number(window.WorkerPrefs?.get?.().defaultPeriod);
  const value = workerValue || prefsValue || 14;
  return [7, 14, 30].includes(value) ? (value as DashboardPeriod) : 14;
}

export interface DashboardProps {
  context: DashboardRenderContext;
  api?: DashboardApi;
  initialData?: DashboardOverview;
  initialDemo?: boolean;
}

export default function Dashboard({
  context,
  api = dashboardApi,
  initialData,
  initialDemo = false,
}: DashboardProps) {
  const [period, setPeriod] = useState<DashboardPeriod>(
    initialData?.days || preferredPeriod(),
  );
  const [overview, setOverview] = useState<DashboardOverview | null>(
    initialData || null,
  );
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(
    initialDemo || isDashboardDemoRequested(),
  );
  const [reloadToken, setReloadToken] = useState(context.refresh ? 1 : 0);
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const [selectedEvent, setSelectedEvent] =
    useState<ActivityEvent | null>(null);
  const [lookupEvents, setLookupEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    if (demo) {
      const data =
        initialData && initialData.days === period
          ? initialData
          : createMockOverview(period);
      setOverview(data);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    api
      .getOverview(period, Boolean(context.refresh || reloadToken))
      .then((data) => {
        if (!active) return;
        setOverview(data);
      })
      .catch((requestError) => {
        if (!active) return;
        if (import.meta.env.DEV && import.meta.env.MODE !== "test") {
          setOverview(createMockOverview(period));
          setDemo(true);
          return;
        }
        setOverview(null);
        setError(readableApiError(requestError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, context.refresh, demo, initialData, period, reloadToken]);

  useEffect(() => {
    const sourceId = activityLookupId(filters.query);
    if (demo || !sourceId) {
      setLookupEvents([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api
        .getLogDetail(sourceId)
        .then((event) => {
          if (!active) return;
          setLookupEvents([event]);
        })
        .catch(() => {
          if (active) setLookupEvents([]);
        });
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, demo, filters.query]);

  const allEvents = useMemo(() => {
    const base = overview ? combineActivity(overview) : [];
    return mergeLookupActivity(base, lookupEvents);
  }, [lookupEvents, overview]);
  const visibleEvents = useMemo(
    () => filterActivities(allEvents, filters),
    [allEvents, filters],
  );

  const updateEvent = useCallback((updated: ActivityEvent) => {
    setOverview((current) => {
      if (!current) return current;
      const updateRows = (rows: ActivityEvent[]) =>
        rows.map((event) =>
          String(event.id) === String(updated.id)
          || String(event.sourceId || "") === String(updated.sourceId || updated.id)
            ? { ...event, ...updated, id: event.id, eventType: updated.eventType || event.eventType }
            : event,
        );
      return {
        ...current,
        recentLogs: updateRows(current.recentLogs),
        recentMafiles: updateRows(current.recentMafiles),
      };
    });
    setSelectedEvent((current) =>
      current?.id === updated.id ? updated : current,
    );
  }, []);

  const changePeriod = (next: DashboardPeriod) => {
    window.WorkerViews.dashboardPeriodDays = next;
    setPeriod(next);
  };

  if (!overview && loading) return withActionToasts(<SkeletonState />);
  if (!overview && error) {
    return withActionToasts(
      <ErrorState
        message={error}
        onRetry={() => setReloadToken((value) => value + 1)}
      />,
    );
  }
  if (!overview) return withActionToasts(<SkeletonState />);

  return withActionToasts(
    <div className="gbd-dashboard">
      <DashboardHeader
        context={context}
        overview={overview}
        period={period}
        loading={loading}
        onPeriodChange={changePeriod}
        onRefresh={() => setReloadToken((value) => value + 1)}
      />

      {demo && (
        <div className="gbd-alert gbd-alert--demo" role="status">
          <Sparkles size={14} aria-hidden="true" />
          <div>
            <strong>{text("demo.title")}</strong>
            <span>{text("demo.text")}</span>
          </div>
        </div>
      )}

      <KpiStatsSection overview={overview} />

      <DynamicsChart series={overview.series} />

      {overview.logsError && <PartialDataAlert />}

      <ActivityFeed
        allEvents={allEvents}
        events={visibleEvents}
        filters={filters}
        onFiltersChange={setFilters}
        onOpen={setSelectedEvent}
      />

      <EventDrawer
        event={selectedEvent}
        api={api}
        onClose={() => setSelectedEvent(null)}
        onEventUpdate={updateEvent}
      />
    </div>
  );
}

export { Dashboard };
