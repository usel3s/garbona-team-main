const { getAllTemplates } = require("./apiService");
const {
  getVisibleTemplates,
  setVisibleTemplates,
  normalizeTemplateId,
  canAccessTemplate,
} = require("./settingsService");
const { resolvePreviewUrl, localPreviewUrl, publicPreviewApiUrl, primaryPreviewUrl } = require("./templatePreviewService");
const { logger } = require("../utils/logger");

function pickCustomTemplateName(custom, remoteName, id) {
  const customName = String(custom?.name || "").trim();
  if (!customName) return remoteName || `Template #${id}`;
  const remote = String(remoteName || "").trim();
  const fallback = `Template #${id}`;
  if (customName !== remote && customName !== fallback) return customName;
  return remote || customName || fallback;
}

function mapCatalogRows(remote, customRows) {
  const customMap = new Map((customRows || []).map((row) => [row.id, row]));
  return (remote || [])
    .map((row) => {
      const id = normalizeTemplateId(row?.id ?? row);
      if (!id) return null;
      const custom = customMap.get(id);
      const name = pickCustomTemplateName(custom, row?.name, id);
      const remotePreview = String(row?.preview || custom?.preview || "").trim();
      return {
        id,
        name,
        preview: resolvePreviewUrl(id, remotePreview) || localPreviewUrl(id) || publicPreviewApiUrl(id),
        remotePreview,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.id) - Number(a.id));
}

async function buildTemplatesFromToken(token, { syncVisibility = false } = {}) {
  let remote = [];
  try {
    const payload = await getAllTemplates(token);
    remote = payload?.rows || [];
  } catch (error) {
    logger.warn("Failed to load uProject templates catalog", { error: error.message });
  }

  const customRows = await getVisibleTemplates();
  if (!remote.length) {
    return {
      templates: customRows.map((t) => ({
        id: t.id,
        name: t.name || `Template #${t.id}`,
        preview: localPreviewUrl(t.id) || publicPreviewApiUrl(t.id),
      })),
    };
  }

  const templates = mapCatalogRows(remote, customRows);

  if (syncVisibility) {
    try {
      await setVisibleTemplates(
        templates.map((t) => ({
          id: t.id,
          name: t.name,
          preview: t.remotePreview || "",
        }))
      );
    } catch (error) {
      logger.warn("Failed to sync visibleTemplates from catalog", { error: error.message });
    }
  }

  return {
    templates: templates.map(({ id, name, preview, remotePreview }) => ({
      id,
      name,
      preview,
      remotePreview: remotePreview || "",
    })),
  };
}

function buildTemplatePreviewFields(id, remotePreview, meta, remote) {
  const previewSrc = String(remote?.preview || meta?.preview || remotePreview || "").trim();
  return primaryPreviewUrl(id, previewSrc);
}

/** Только включённые шаблоны (visibleTemplates) — для воркеров и бота. */
function mergeEnabledTemplates(remoteTemplates, visibleRows, telegramId) {
  const remoteMap = new Map(
    (remoteTemplates || [])
      .map((row) => {
        const id = normalizeTemplateId(row?.id ?? row);
        return id ? [id, row] : null;
      })
      .filter(Boolean)
  );
  const templates = [];
  for (const meta of visibleRows || []) {
    const id = normalizeTemplateId(meta?.id ?? meta);
    if (!id) continue;
    if (!canAccessTemplate(meta, telegramId)) continue;
    const remote = remoteMap.get(id);
    const remotePreview = String(remote?.remotePreview || remote?.preview || meta?.preview || "").trim();
    templates.push({
      id,
      name: pickCustomTemplateName(meta, remote?.name, id),
      preview: buildTemplatePreviewFields(id, remotePreview, meta, remote),
      remotePreview,
      isPublic: canAccessTemplate(meta, ""),
      ownerTelegramId: String(meta?.ownerTelegramId || "").trim(),
      mine: Boolean(meta?.ownerTelegramId) && String(meta.ownerTelegramId) === String(telegramId || ""),
      enabled: true,
    });
  }
  templates.sort((a, b) => Number(b.id) - Number(a.id));
  return templates;
}

/** Полный каталог uProject + метаданные включения — для админки. */
function mergeAdminCatalogTemplates(remoteTemplates, visibleRows) {
  const visibleMap = new Map(
    (visibleRows || [])
      .map((row) => {
        const id = normalizeTemplateId(row?.id ?? row);
        return id ? [id, row] : null;
      })
      .filter(Boolean)
  );
  const remoteMap = new Map(
    (remoteTemplates || [])
      .map((row) => {
        const id = normalizeTemplateId(row?.id ?? row);
        return id ? [id, row] : null;
      })
      .filter(Boolean)
  );
  const ids = new Set([...visibleMap.keys(), ...remoteMap.keys()]);
  const templates = [];
  for (const id of ids) {
    const meta = visibleMap.get(id);
    const remote = remoteMap.get(id);
    if (!meta && !remote) continue;
    const ownerTelegramId = String(meta?.ownerTelegramId || "").trim();
    const remotePreview = String(remote?.remotePreview || remote?.preview || meta?.preview || "").trim();
    templates.push({
      id,
      name: pickCustomTemplateName(meta, remote?.name, id),
      preview: buildTemplatePreviewFields(id, remotePreview, meta, remote),
      remotePreview,
      enabled: Boolean(meta),
      isPublic: !meta || canAccessTemplate(meta, ""),
      ownerTelegramId,
      isWorkerTemplate: Boolean(ownerTelegramId),
      enabledOnlyInDb: Boolean(meta) && !remote,
    });
  }
  templates.sort((a, b) => Number(b.id) - Number(a.id));
  return templates;
}

function mergeAccessibleTemplates(remoteTemplates, visibleRows, telegramId) {
  const visibleMap = new Map(
    (visibleRows || [])
      .map((row) => {
        const id = normalizeTemplateId(row?.id ?? row);
        return id ? [id, row] : null;
      })
      .filter(Boolean)
  );
  const remoteMap = new Map(
    (remoteTemplates || [])
      .map((row) => {
        const id = normalizeTemplateId(row?.id ?? row);
        return id ? [id, row] : null;
      })
      .filter(Boolean)
  );
  const ids = new Set([...visibleMap.keys(), ...remoteMap.keys()]);
  const templates = [];
  for (const id of ids) {
    const meta = visibleMap.get(id);
    if (meta && !canAccessTemplate(meta, telegramId)) continue;
    const remote = remoteMap.get(id);
    if (!meta && !remote) continue;
    const remotePreview = String(remote?.preview || meta?.preview || "").trim();
    templates.push({
      id,
      name: pickCustomTemplateName(meta, remote?.name, id),
      preview: buildTemplatePreviewFields(id, remotePreview, meta, remote),
      remotePreview,
      isPublic: !meta || canAccessTemplate(meta, ""),
      ownerTelegramId: String(meta?.ownerTelegramId || "").trim(),
      mine: Boolean(meta?.ownerTelegramId) && String(meta.ownerTelegramId) === String(telegramId || ""),
      enabled: Boolean(meta),
    });
  }
  templates.sort((a, b) => Number(b.id) - Number(a.id));
  return templates;
}

module.exports = {
  buildTemplatesFromToken,
  mapCatalogRows,
  pickCustomTemplateName,
  mergeAccessibleTemplates,
  mergeEnabledTemplates,
  mergeAdminCatalogTemplates,
};
