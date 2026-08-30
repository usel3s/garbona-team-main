import type { TrendPoint } from "../types";

export type BranchSection =
  | "catalog"
  | "create"
  | "overview"
  | "members"
  | "settings"
  | "manuals";

export type BranchMemberRole = "owner" | "deputy" | "recruiter" | "member";

export type BranchMemberRow = {
  id: string;
  username: string;
  profits: number;
  joinedDays: number;
  role: BranchMemberRole;
  avatarUrl?: string;
  percentOverride?: number;
  telegramId?: string;
};

export type BranchApplicationStatus = "pending" | "accepted" | "rejected";

export type BranchApplication = {
  id: string;
  username: string;
  avatarUrl?: string;
  note: string;
  profitsTotal: number;
  profitsSeries: {
    "7": TrendPoint[];
    "14": TrendPoint[];
    all: TrendPoint[];
  };
  daysActive: number;
  appliedAt: string;
  status: BranchApplicationStatus;
  decidedAt?: string;
  decidedBy?: string;
};

export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlockedAt?: string;
  progressHint?: string;
};

export type CustomRole = {
  id: string;
  name: string;
  permissions: string[];
  locked?: boolean;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  category: "members" | "roles" | "apps" | "other";
};

export type BranchTemplate = {
  id: string;
  title: string;
  /** Short key used on the branch domain, e.g. login / gate */
  slug: string;
  html: string;
  updatedAt: string;
};

export type BranchManual = {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  bodyMarkdown: string;
  author: string;
};

export type BranchDomain = {
  id: string;
  host: string;
  status: "active" | "pending_ns" | "paused";
};

export type BranchInvite = {
  id: string;
  username: string;
  avatarUrl?: string;
  invitedBy: string;
  invitedAt: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
};


export type TopWorkerPeriod = "day" | "7d" | "all";

export type TopWorker = {
  id: string;
  username: string;
  avatarUrl?: string;
  profits: number;
  isAnonymous?: boolean;
  fakeProfitTag?: string;
};

export const ROLE_LABELS: Record<BranchMemberRole, string> = {
  owner: "Владелец",
  deputy: "Зам",
  recruiter: "Рекрутер",
  member: "Участник",
};

export const PERMISSION_FLAGS = [
  { id: "manage_members", label: "Управление участниками" },
  { id: "manage_apps", label: "Заявки" },
  { id: "invite_members", label: "Приглашать в филиал" },
  { id: "edit_manuals", label: "Мануалы" },
  { id: "edit_templates", label: "Шаблоны" },
  { id: "view_audit", label: "Аудит" },
  { id: "manage_domain", label: "Домен" },
  { id: "set_percents", label: "Проценты" },
] as const;

export type PermissionFlag = (typeof PERMISSION_FLAGS)[number]["id"];

export const MAX_BRANCH_DESCRIPTION = 300;
