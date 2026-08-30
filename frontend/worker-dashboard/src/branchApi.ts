import type { TrendPoint } from "./types";
import type { BranchRecord, BranchMembership } from "./Branch";
import type {
  BranchApplication,
  BranchInvite,
  BranchMemberRow,
  TopWorker,
} from "./branch/types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function string(value: unknown, fallback = ""): string {
  return value == null ? fallback : String(value);
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requireWorkerApi() {
  if (!window.WorkerAPI) {
    throw new Error("Branch API is unavailable");
  }
  return window.WorkerAPI;
}

function normalizeOwner(raw: unknown) {
  const owner = record(raw);
  return {
    username: string(owner.username) || undefined,
    firstName: string(owner.firstName) || undefined,
    telegramId: string(owner.telegramId) || undefined,
    avatarUrl: string(owner.avatarUrl) || undefined,
  };
}

export function normalizeBranch(raw: unknown): BranchRecord {
  const row = record(raw);
  return {
    id: string(row.id),
    name: string(row.name),
    description: string(row.description),
    percent: number(row.percent),
    members: number(row.members),
    total: number(row.total),
    profitCount: number(row.profitCount),
    owner: normalizeOwner(row.owner),
    createdAt: string(row.createdAt),
    avatarUrl: string(row.avatarUrl) || undefined,
    acceptingApplications: row.acceptingApplications !== false,
    isOwner: Boolean(row.isOwner),
    isMember: Boolean(row.isMember),
  };
}

function normalizeSeries(raw: unknown): TrendPoint[] {
  return list(raw).map((point) => {
    const row = record(point);
    const profitUsd = number(row.profitUsd ?? row.profits ?? row.totalUsd);
    const logsCount = number(row.logsCount ?? row.logs);
    const mafileCount = number(row.mafileCount ?? row.mafiles);
    const logsUsd = number(row.logsUsd, profitUsd);
    return {
      date: string(row.date),
      totalUsd: number(row.totalUsd, profitUsd),
      profitUsd,
      logsUsd,
      logsCount,
      mafileCount,
    };
  });
}

function normalizeTopWorker(raw: unknown): TopWorker {
  const row = record(raw);
  return {
    id: string(row.id),
    username: string(row.username),
    avatarUrl: string(row.avatarUrl) || undefined,
    profits: number(row.profits),
    isAnonymous: Boolean(row.isAnonymous),
    fakeProfitTag: string(row.fakeProfitTag) || undefined,
  };
}

function normalizeMember(raw: unknown): BranchMemberRow {
  const row = record(raw);
  const role = string(row.role, "member");
  return {
    id: string(row.id),
    username: string(row.username),
    profits: number(row.profits),
    joinedDays: number(row.joinedDays, 1),
    role:
      role === "owner" || role === "deputy" || role === "recruiter"
        ? role
        : "member",
    avatarUrl: string(row.avatarUrl) || undefined,
    telegramId: string(row.telegramId) || undefined,
  };
}

function normalizeApplication(raw: unknown): BranchApplication {
  const row = record(raw);
  const status = string(row.status, "pending");
  const series = record(row.profitsSeries);
  return {
    id: string(row.id),
    username: string(row.username),
    avatarUrl: string(row.avatarUrl) || undefined,
    note: string(row.note),
    profitsTotal: number(row.profitsTotal),
    profitsSeries: {
      "7": normalizeSeries(series["7"]),
      "14": normalizeSeries(series["14"]),
      all: normalizeSeries(series.all),
    },
    daysActive: number(row.daysActive, 1),
    appliedAt: string(row.appliedAt),
    status:
      status === "accepted" || status === "rejected" ? status : "pending",
    decidedAt: string(row.decidedAt) || undefined,
    decidedBy: string(row.decidedBy) || undefined,
  };
}

export type BranchCreateInfo = {
  canCreate: boolean;
  profitsUsd: number;
  needUsd: number;
  missingUsd: number;
  costUsd: number;
  maxPercent: number;
};

export type BranchMePayload = {
  membership: BranchMembership;
  branch: BranchRecord | null;
  pendingApplication: { id: string; branchId: string } | null;
  create: BranchCreateInfo;
};

export type BranchCatalogPayload = {
  branches: BranchRecord[];
  pendingApplication: { id: string; branchId: string } | null;
};

export type BranchOverviewPayload = {
  branch: BranchRecord;
  pendingApplications: number;
  series: Record<"7" | "14" | "30", TrendPoint[]>;
  topWorkers: Record<"day" | "7d" | "all", TopWorker[]>;
};

export type BranchMembersPayload = {
  members: BranchMemberRow[];
  applications: BranchApplication[];
  invites: BranchInvite[];
};

export const branchApi = {
  async me(force = false): Promise<BranchMePayload> {
    const raw = await requireWorkerApi().get("/branch/me", { force });
    const data = record(raw);
    const create = record(data.create);
    const pending = record(data.pendingApplication);
    const membership = string(data.membership, "none");
    return {
      membership:
        membership === "owner" || membership === "member" ? membership : "none",
      branch: data.branch ? normalizeBranch(data.branch) : null,
      pendingApplication: pending.id
        ? { id: string(pending.id), branchId: string(pending.branchId) }
        : null,
      create: {
        canCreate: Boolean(create.canCreate),
        profitsUsd: number(create.profitsUsd),
        needUsd: number(create.needUsd, 100),
        missingUsd: number(create.missingUsd),
        costUsd: number(create.costUsd, 100),
        maxPercent: number(create.maxPercent, 10),
      },
    };
  },

  async catalog(force = false): Promise<BranchCatalogPayload> {
    const raw = await requireWorkerApi().get("/branch/catalog", { force });
    const data = record(raw);
    const pending = record(data.pendingApplication);
    return {
      branches: list(data.branches).map(normalizeBranch).filter((row) => row.id),
      pendingApplication: pending.id
        ? { id: string(pending.id), branchId: string(pending.branchId) }
        : null,
    };
  },

  async overview(force = false): Promise<BranchOverviewPayload> {
    const raw = await requireWorkerApi().get("/branch/overview", { force });
    const data = record(raw);
    const series = record(data.series);
    const top = record(data.topWorkers);
    return {
      branch: normalizeBranch(data.branch),
      pendingApplications: number(data.pendingApplications),
      series: {
        "7": normalizeSeries(series["7"]),
        "14": normalizeSeries(series["14"]),
        "30": normalizeSeries(series["30"]),
      },
      topWorkers: {
        day: list(top.day).map(normalizeTopWorker),
        "7d": list(top["7d"]).map(normalizeTopWorker),
        all: list(top.all).map(normalizeTopWorker),
      },
    };
  },

  async members(force = false): Promise<BranchMembersPayload> {
    const raw = await requireWorkerApi().get("/branch/members", { force });
    const data = record(raw);
    return {
      members: list(data.members).map(normalizeMember),
      applications: list(data.applications).map(normalizeApplication),
      invites: [],
    };
  },

  async create(body: {
    name: string;
    description: string;
    percent: number;
    avatarUrl?: string;
  }): Promise<BranchRecord> {
    const raw = await requireWorkerApi().post("/branch", body);
    return normalizeBranch(record(raw).branch || raw);
  },

  async patch(body: Partial<BranchRecord>): Promise<BranchRecord> {
    const raw = await requireWorkerApi().patch("/branch", {
      name: body.name,
      description: body.description,
      percent: body.percent,
      avatarUrl: body.avatarUrl,
      acceptingApplications: body.acceptingApplications,
    });
    return normalizeBranch(record(raw).branch || raw);
  },

  async apply(branchId: string) {
    const raw = await requireWorkerApi().post("/branch/applications", {
      branchId,
    });
    const app = record(record(raw).application);
    return {
      id: string(app.id),
      branchId: string(app.branchId),
    };
  },

  async cancelApplication(applicationId?: string) {
    if (applicationId) {
      await requireWorkerApi().del(
        `/branch/applications/${encodeURIComponent(applicationId)}`,
      );
      return;
    }
    await requireWorkerApi().del("/branch/applications");
  },

  async acceptApplication(id: string) {
    await requireWorkerApi().post(
      `/branch/applications/${encodeURIComponent(id)}/accept`,
      {},
    );
  },

  async rejectApplication(id: string) {
    await requireWorkerApi().post(
      `/branch/applications/${encodeURIComponent(id)}/reject`,
      {},
    );
  },

  async leave() {
    await requireWorkerApi().del("/branch/membership");
  },

  async deleteBranch() {
    await requireWorkerApi().del("/branch");
  },

  async kick(telegramId: string) {
    await requireWorkerApi().del(
      `/branch/members/${encodeURIComponent(telegramId)}`,
    );
  },
};

export function readableBranchError(error: unknown): string {
  const friendly = window.WorkerToast?.friendlyError?.(error);
  if (friendly) return friendly;
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось выполнить действие";
}
