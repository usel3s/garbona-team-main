import { CloudOff, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readableSitesError, sitesApi } from "./sitesApi";
import { sitesText } from "./sitesCopy";
import type {
  AuthJournalSession,
  DomainBindInfo,
  LinkPayload,
  SiteDomain,
  SiteLink,
  SitesApi,
  SitesFilters,
  SitesRenderContext,
  SiteTemplate,
} from "./sitesTypes";
import { filterDomains, summarizeDomains } from "./sitesUtils";
import { AddDomainDialog } from "./components/sites/AddDomainDialog";
import { DomainGrid } from "./components/sites/DomainCard";
import { SiteDetail, shareDomainUrl } from "./components/sites/SiteDetail";
import { SitesHeader, SitesSummary } from "./components/sites/SitesHeader";
import { SitesDetailSkeleton, SitesSkeleton } from "./components/sites/SitesSkeleton";
import { SitesToolbar } from "./components/sites/SitesToolbar";
import { ConfirmDialog } from "./components/sites/ConfirmDialog";
import { withActionToasts } from "./components/ui/ActionToastHost";
import { EmptyState } from "./components/ui/empty-state";
import {
  friendlyToastError,
  runToastAction,
  showErrorToast,
  showLoadingToast,
  updateToast,
} from "./actionToast";
import { toastText } from "./toastCopy";
import "./theme.css";
import "./dashboard.css";
import "./sites.css";

const DEFAULT_FILTERS: SitesFilters = { q: "", status: "all" };

function ensureSitesState() {
  const views = window.WorkerViews as typeof window.WorkerViews & {
    sitesState?: { selectedId: number | null; filters: SitesFilters };
  };
  if (!views.sitesState) {
    views.sitesState = { selectedId: null, filters: { ...DEFAULT_FILTERS } };
  }
  if (!views.sitesState.filters) {
    views.sitesState.filters = { ...DEFAULT_FILTERS };
  }
  return views.sitesState;
}

export interface SitesProps {
  context: SitesRenderContext;
  api?: SitesApi;
}

export default function Sites({ context, api = sitesApi }: SitesProps) {
  const sitesState = ensureSitesState();
  const [selectedId, setSelectedId] = useState<number | null>(
    sitesState.selectedId,
  );
  const [filters, setFilters] = useState<SitesFilters>({
    ...DEFAULT_FILTERS,
    ...sitesState.filters,
  });
  const [domains, setDomains] = useState<SiteDomain[]>([]);
  const [detailDomain, setDetailDomain] = useState<SiteDomain | null>(null);
  const [detailLinks, setDetailLinks] = useState<SiteLink[]>([]);
  const [templates, setTemplates] = useState<SiteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(context.refresh ? 1 : 0);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState<number | null>(null);
  const [deletingDomain, setDeletingDomain] = useState(false);
  const [confirmDeleteDomain, setConfirmDeleteDomain] = useState(false);
  const [confirmDeleteLink, setConfirmDeleteLink] = useState<SiteLink | null>(
    null,
  );
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [linkFormMode, setLinkFormMode] = useState<"create" | "edit">("create");
  const [editingLink, setEditingLink] = useState<SiteLink | null>(null);
  const [listDomainToDelete, setListDomainToDelete] = useState<SiteDomain | null>(
    null,
  );
  const [journalSessions, setJournalSessions] = useState<AuthJournalSession[]>(
    [],
  );
  const [journalLoading, setJournalLoading] = useState(false);

  useEffect(() => {
    sitesState.selectedId = selectedId;
  }, [selectedId, sitesState]);

  useEffect(() => {
    sitesState.filters = filters;
  }, [filters, sitesState]);

  const loadDomains = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.listDomains(Boolean(context.refresh || reloadToken));
      setDomains(data.domains);
    } catch (requestError) {
      setDomains([]);
      setError(readableSitesError(requestError));
    } finally {
      setLoading(false);
    }
  }, [api, context.refresh, reloadToken]);

  const loadDetail = useCallback(
    async (domainId: number) => {
      setDetailLoading(true);
      setError("");
      try {
        const [detail, templateRows] = await Promise.all([
          api.getDomain(domainId, Boolean(context.refresh || reloadToken)),
          api.listTemplates(true).catch(() => [] as SiteTemplate[]),
        ]);
        setDetailDomain(detail.domain);
        setDetailLinks(detail.links);
        setTemplates(templateRows);
      } catch (requestError) {
        setDetailDomain(null);
        setDetailLinks([]);
        setError(readableSitesError(requestError));
        setSelectedId(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [api, context.refresh, reloadToken],
  );

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
      return;
    }
    loadDomains();
  }, [selectedId, loadDomains, loadDetail]);

  const filteredDomains = useMemo(
    () => filterDomains(domains, filters),
    [domains, filters],
  );
  const summary = useMemo(() => summarizeDomains(domains), [domains]);

  const openDomain = (id: number) => setSelectedId(id);
  const backToList = () => {
    setSelectedId(null);
    setDetailDomain(null);
    setDetailLinks([]);
    setError("");
    loadDomains();
  };

  const handlePrepareDomain = async (domain: string) => {
    const preview = await api.checkDomain(domain);
    if (preview.existing) {
      return { existing: true };
    }
    const bind: DomainBindInfo = await api.getBindInfo().catch(() => ({
      ip: preview.ip,
      ns: preview.ns || [],
    }));
    const ns = (bind.ns && bind.ns.length ? bind.ns : preview.ns) || [];
    return {
      ip: bind.ip || preview.ip || "",
      ns: bind.cloudflareAvailable === false ? [] : ns,
    };
  };

  const handleCreateDomain = async (payload: {
    domain: string;
    bindType?: string;
    isTransit?: boolean;
  }) => {
    setAddBusy(true);
    const toastId = showLoadingToast(sitesText("toastAddingDomain"));
    try {
      const result = await api.createDomain(payload);
      window.WorkerAPI?.bust("/sites/domains");
      if (result.existing) {
        updateToast(toastId, {
          status: "success",
          progress: undefined,
          title: sitesText("domainExistsOpen"),
          description: toastText("successBody"),
          primaryButtonText: toastText("done"),
          sticky: false,
        });
      } else {
        updateToast(toastId, {
          status: "success",
          progress: undefined,
          title: sitesText("wizardSuccessHeading"),
          description: sitesText("wizardSuccessBody"),
          primaryButtonText: toastText("done"),
          sticky: false,
        });
      }
      const nextId = result.created?.id || null;
      if (nextId) setPendingOpenId(nextId);
      else await loadDomains();
    } catch (requestError) {
      updateToast(toastId, {
        status: "error",
        progress: undefined,
        title: toastText("errorTitle"),
        description: friendlyToastError(requestError),
        primaryButtonText: toastText("close"),
        secondaryButtonText: toastText("cancel"),
        sticky: false,
      });
      throw requestError;
    } finally {
      setAddBusy(false);
    }
  };

  const handleCloseAdd = () => {
    setAddOpen(false);
    const nextId = pendingOpenId;
    setPendingOpenId(null);
    if (nextId) setSelectedId(nextId);
  };

  const handleDeleteDomain = async () => {
    const row = detailDomain || listDomainToDelete;
    if (!row) return;
    setDeletingDomain(true);
    try {
      await runToastAction(
        {
          loading: sitesText("toastDeletingDomain"),
          success: sitesText("deleteDomain"),
        },
        () => api.deleteDomain(row.id),
      );
      window.WorkerAPI?.bust("/sites/domains");
      setConfirmDeleteDomain(false);
      setListDomainToDelete(null);
      if (selectedId === row.id) backToList();
      else await loadDomains();
    } catch {
      /* error toast is shown by runToastAction */
    } finally {
      setDeletingDomain(false);
    }
  };

  const refreshDetail = async () => {
    if (!selectedId) return;
    await loadDetail(selectedId);
  };

  const handleSubmitLink = async (payload: LinkPayload) => {
    if (!selectedId) return;
    await runToastAction(
      {
        loading:
          linkFormMode === "edit"
            ? sitesText("toastSavingLink")
            : sitesText("toastCreatingLink"),
        success:
          linkFormMode === "edit" ? sitesText("submitSave") : sitesText("submitAdd"),
      },
      async () => {
        if (linkFormMode === "edit" && editingLink) {
          await api.updateLink(selectedId, editingLink.id, payload);
        } else {
          await api.createLink(selectedId, payload);
        }
      },
      { surfaceError: false },
    );
    window.WorkerAPI?.bust("/sites/domains");
    setLinkFormOpen(false);
    setEditingLink(null);
    await refreshDetail();
  };

  const handleDeleteLink = async () => {
    if (!selectedId || !confirmDeleteLink) return;
    const linkId = confirmDeleteLink.id;
    setDetailLinks((current) => current.filter((row) => row.id !== linkId));
    setConfirmDeleteLink(null);
    try {
      await runToastAction(
        {
          loading: sitesText("toastDeletingLink"),
          success: sitesText("linkDeleted"),
        },
        () => api.deleteLink(selectedId, linkId),
      );
      window.WorkerAPI?.bust("/sites/domains");
      await refreshDetail();
    } catch {
      await refreshDetail();
    }
  };

  if (selectedId && detailLoading && !detailDomain) {
    return withActionToasts(<SitesDetailSkeleton />);
  }

  if (selectedId && detailDomain) {
    return withActionToasts(
      <div className="gbs-sites">
        <SiteDetail
          domain={detailDomain}
          links={detailLinks}
          templates={templates}
          deletingDomain={deletingDomain}
          linkFormOpen={linkFormOpen}
          linkFormMode={linkFormMode}
          editingLink={editingLink}
          confirmDeleteDomain={confirmDeleteDomain}
          confirmDeleteLink={confirmDeleteLink}
          journalSessions={journalSessions}
          journalLoading={journalLoading}
          onBack={backToList}
          onShare={async () => {
            try {
              await navigator.clipboard.writeText(shareDomainUrl(detailDomain.domain));
              window.WorkerToast?.success?.(sitesText("shareCopied"));
            } catch {
              window.WorkerToast?.error?.(sitesText("copyFailed"));
            }
          }}
          onPause={() => {
            const next = !detailDomain.isPaused;
            setDetailDomain({ ...detailDomain, isPaused: next });
            window.WorkerToast?.success?.(
              next ? sitesText("pauseDone") : sitesText("resumeDone"),
            );
          }}
          onDeleteDomain={() => setConfirmDeleteDomain(true)}
          onCreateLink={() => {
            setLinkFormMode("create");
            setEditingLink(null);
            setLinkFormOpen(true);
          }}
          onEditLink={(link) => {
            setLinkFormMode("edit");
            setEditingLink(link);
            setLinkFormOpen(true);
          }}
          onDeleteLink={(link) => setConfirmDeleteLink(link)}
          onOpenJournal={async (link, background = false) => {
            if (!background) {
              setJournalLoading(true);
              setJournalSessions([]);
            }
            try {
              const data = await api.getLinkJournal?.(selectedId || 0, link.id);
              setJournalSessions(data?.sessions || []);
            } catch {
              if (!background) {
                setJournalSessions([]);
                showErrorToast(sitesText("journalLoadError"));
              }
            } finally {
              if (!background) setJournalLoading(false);
            }
          }}
          onResetStats={(link) => {
            setDetailLinks((rows) =>
              rows.map((row) =>
                row.id === link.id
                  ? {
                      ...row,
                      stats: {
                        views: 0,
                        clicks: 0,
                        auths: 0,
                        logs: 0,
                        mafiles: 0,
                        desktopPercent: 0,
                      },
                    }
                  : row,
              ),
            );
            window.WorkerToast?.success?.(sitesText("resetStatsDone"));
          }}
          onCloseLinkForm={() => {
            setLinkFormOpen(false);
            setEditingLink(null);
          }}
          onSubmitLink={handleSubmitLink}
          onCloseDeleteDomain={() => setConfirmDeleteDomain(false)}
          onCloseDeleteLink={() => setConfirmDeleteLink(null)}
          onConfirmDeleteDomain={handleDeleteDomain}
          onConfirmDeleteLink={handleDeleteLink}
          onCloseJournal={() => {
            setJournalSessions([]);
            setJournalLoading(false);
          }}
        />
      </div>
    );
  }

  if (loading && !domains.length) {
    return withActionToasts(<SitesSkeleton />);
  }

  if (error && !domains.length) {
    return withActionToasts(
      <div className="gbs-sites">
        <section className="gbd-state" role="alert">
          <span className="gbd-state__icon">
            <CloudOff size={25} aria-hidden="true" />
          </span>
          <h1>{sitesText("stateError")}</h1>
          <p>{error}</p>
          <div className="gbd-state__actions">
            <button
              className="gbd-button gbd-button--primary"
              type="button"
              onClick={() => {
                setReloadToken((value) => value + 1);
                loadDomains();
              }}
            >
              <RefreshCw size={16} />
              {sitesText("stateRetry")}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return withActionToasts(
    <div className="gbs-sites">
      <SitesHeader onAddDomain={() => setAddOpen(true)} />
      <SitesSummary
        total={domains.length}
        active={summary.activeCount}
        paused={summary.pausedCount}
        links={summary.linksCount}
      />
      <section className="gbs-list-section">
        <SitesToolbar
          query={filters.q}
          status={filters.status}
          onQueryChange={(q) =>
            setFilters((current) => ({ ...current, q }))
          }
          onStatusChange={(status) =>
            setFilters((current) => ({ ...current, status }))
          }
        />
        {domains.length === 0 ? (
          <EmptyState
            code="404"
            title={sitesText("empty")}
            description={sitesText("emptyHint")}
            action={
              <button
                type="button"
                className="gbd-button gbd-button--primary"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={16} />
                {sitesText("addDomain")}
              </button>
            }
          />
        ) : filteredDomains.length === 0 ? (
          <EmptyState
            code=""
            title={sitesText("emptyFiltered")}
          />
        ) : (
          <DomainGrid
            domains={filteredDomains}
            onOpen={openDomain}
            onDelete={(domain) => setListDomainToDelete(domain)}
          />
        )}
      </section>

      <ConfirmDialog
        open={Boolean(listDomainToDelete)}
        title={sitesText("confirmTitle")}
        message={sitesText("deleteConfirm", {
          domain: listDomainToDelete?.domain || "",
        })}
        confirmLabel={sitesText("deleteDomain")}
        onCancel={() => setListDomainToDelete(null)}
        onConfirm={handleDeleteDomain}
      />

      <AddDomainDialog
        open={addOpen}
        busy={addBusy}
        onClose={handleCloseAdd}
        onPrepare={handlePrepareDomain}
        onSubmit={handleCreateDomain}
      />
    </div>
  );
}
