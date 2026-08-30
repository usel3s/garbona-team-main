const { logger } = require("../utils/logger");
const { getTeamTransactions } = require("./apiService");
const {
  roundUsd,
  createTeamShareDebit,
  cancelTeamShareDebit,
  findTeamShareDebitByExternalId,
} = require("./teamShareLedgerService");

/** Inclusive: 27 авг. 2026, 02:33:24 MSK (UProject MaFileCommission −$19.13). */
const UPROJECT_TEAM_SHARE_SINCE = new Date("2026-08-26T23:33:24.000Z");

const REASON_LABELS = {
  MaFileCommission: "Комиссия MaFile",
  MaFileConvertCommission: "Конвертация MaFile",
};

function uprojectTxTime(row) {
  const t = new Date(row?.createdAt || 0);
  return Number.isNaN(t.getTime()) ? 0 : t.getTime();
}

function uprojectTxAmount(row) {
  return roundUsd(row?.amount);
}

function uprojectAccountId(row) {
  const id = row?.data?.accountId ?? row?.data?.AccountId ?? row?.accountId;
  return String(id ?? "").trim();
}

function formatUprojectDebitReason(row) {
  const kind = String(row?.reason || "").trim() || "UProject";
  const label = REASON_LABELS[kind] || kind;
  const accountId = uprojectAccountId(row);
  const suffix = accountId ? ` · #${accountId}` : "";
  return `UProject · ${label}${suffix}`.slice(0, 400);
}

function parseTeamShareSince(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Укажите дату.");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00+03:00`);
    if (Number.isNaN(date.getTime())) throw new Error("Некорректная дата.");
    return date;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error("Некорректная дата.");
  return date;
}

function shouldImportUprojectDebit(row, since = UPROJECT_TEAM_SHARE_SINCE) {
  if (!row || row.id == null) return false;
  if (String(row.status || "") !== "Paid") return false;
  if (!(uprojectTxAmount(row) < 0)) return false;
  const t = uprojectTxTime(row);
  if (!t) return false;
  return t >= new Date(since).getTime();
}

function shouldCancelImportedUprojectDebit(row) {
  if (!row || row.id == null) return false;
  const status = String(row.status || "");
  return status === "Canceled" || (status === "Paid" && !(uprojectTxAmount(row) < 0));
}

function summarizeUprojectFinanceTransactions(rows = []) {
  const summary = {
    balanceUsd: 0,
    paidChargesUsd: 0,
    paidRefillsUsd: 0,
    canceledChargesUsd: 0,
    paidCount: 0,
    chargeCount: 0,
    refillCount: 0,
    canceledCount: 0,
    asOf: "",
  };
  let asOfTime = 0;
  for (const row of rows) {
    const amount = uprojectTxAmount(row);
    const status = String(row?.status || "");
    const time = uprojectTxTime(row);
    if (time > asOfTime) {
      asOfTime = time;
      summary.asOf = new Date(time).toISOString();
    }
    if (status === "Paid") {
      summary.paidCount += 1;
      summary.balanceUsd = roundUsd(summary.balanceUsd + amount);
      if (amount < 0) {
        summary.chargeCount += 1;
        summary.paidChargesUsd = roundUsd(summary.paidChargesUsd + Math.abs(amount));
      } else if (amount > 0) {
        summary.refillCount += 1;
        summary.paidRefillsUsd = roundUsd(summary.paidRefillsUsd + amount);
      }
    } else if (status === "Canceled") {
      summary.canceledCount += 1;
      if (amount < 0) {
        summary.canceledChargesUsd = roundUsd(summary.canceledChargesUsd + Math.abs(amount));
      }
    }
  }
  return summary;
}

async function listAllUprojectTransactions() {
  const rows = [];
  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    const payload = await getTeamTransactions(offset, 100);
    const chunk = Array.isArray(payload?.rows)
      ? payload.rows
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (payload?.hasNextPage === false) break;
    const next = Number(payload?.lastId);
    if (!Number.isFinite(next) || next === offset) break;
    offset = next;
  }
  return rows;
}

async function getUprojectFinanceSnapshot() {
  return summarizeUprojectFinanceTransactions(await listAllUprojectTransactions());
}

async function listUprojectTransactionsSince(since = UPROJECT_TEAM_SHARE_SINCE) {
  const rows = [];
  const sinceMs = new Date(since).getTime();
  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    const payload = await getTeamTransactions(offset, 100);
    const chunk = Array.isArray(payload?.rows)
      ? payload.rows
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
    if (!chunk.length) break;
    let reachedOld = false;
    for (const row of chunk) {
      const t = uprojectTxTime(row);
      if (sinceMs && t && t < sinceMs) {
        reachedOld = true;
        continue;
      }
      rows.push(row);
    }
    if (reachedOld || payload?.hasNextPage === false) break;
    const next = Number(payload?.lastId);
    if (!Number.isFinite(next) || next === offset) break;
    offset = next;
  }
  return rows;
}

async function syncUprojectTeamShareDebits({ since = UPROJECT_TEAM_SHARE_SINCE } = {}) {
  const summary = { scanned: 0, imported: 0, updated: 0, canceled: 0, skipped: 0 };
  let rows;
  try {
    rows = await listUprojectTransactionsSince(since);
  } catch (error) {
    logger.warn("UProject team-share transactions fetch failed", error.message);
    throw error;
  }

  for (const row of rows) {
    summary.scanned += 1;
    const externalId = String(row.id);
    const existing = await findTeamShareDebitByExternalId(externalId);
    if (shouldCancelImportedUprojectDebit(row)) {
      if (existing && String(existing.status || "active") !== "canceled") {
        await cancelTeamShareDebit({
          id: existing._id,
          actorUsername: "UProject",
        });
        summary.canceled += 1;
      } else {
        summary.skipped += 1;
      }
      continue;
    }
    if (!shouldImportUprojectDebit(row, since)) {
      summary.skipped += 1;
      continue;
    }
    if (existing) {
      const nextAmount = Math.abs(uprojectTxAmount(row));
      const nextReason = formatUprojectDebitReason(row);
      const nextKind = String(row.reason || "").slice(0, 80);
      const nextAccountId = uprojectAccountId(row).slice(0, 32);
      const changed =
        String(existing.status || "active") !== "canceled"
        && (
          Math.abs(Number(existing.amountUsd || 0) - nextAmount) > 0.004
          || String(existing.reason || "") !== nextReason
          || String(existing.kind || "") !== nextKind
          || String(existing.accountId || "") !== nextAccountId
        );
      if (changed) {
        existing.amountUsd = nextAmount;
        existing.reason = nextReason;
        existing.kind = nextKind;
        existing.accountId = nextAccountId;
        await existing.save();
        summary.updated += 1;
      } else {
        summary.skipped += 1;
      }
      continue;
    }
    try {
      await createTeamShareDebit({
        amountUsd: Math.abs(uprojectTxAmount(row)),
        reason: formatUprojectDebitReason(row),
        actorUsername: "UProject",
        source: "uproject",
        kind: String(row.reason || ""),
        accountId: uprojectAccountId(row),
        externalId,
        createdAt: row.createdAt ? new Date(row.createdAt) : null,
        skipAvailableCheck: true,
      });
      summary.imported += 1;
    } catch (error) {
      if (error?.code === 11000) {
        summary.skipped += 1;
        continue;
      }
      logger.warn("UProject team-share debit failed", externalId, error.message);
      summary.skipped += 1;
    }
  }
  return summary;
}

module.exports = {
  UPROJECT_TEAM_SHARE_SINCE,
  uprojectAccountId,
  formatUprojectDebitReason,
  parseTeamShareSince,
  shouldImportUprojectDebit,
  shouldCancelImportedUprojectDebit,
  summarizeUprojectFinanceTransactions,
  listAllUprojectTransactions,
  getUprojectFinanceSnapshot,
  listUprojectTransactionsSince,
  syncUprojectTeamShareDebits,
};
