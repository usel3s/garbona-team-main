import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ElementType,
} from "react";
import clsx from "clsx";
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CreditCard,
  GitBranch,
  Globe,
  LayoutDashboard,
  List,
  LogOut,
  Settings,
  Settings2,
  Trophy,
  Users,
} from "lucide-react";
import "./dashboard-sidebar.css";

export type NavItemData = {
  id: string;
  title: string;
  icon: ElementType;
  badge?: number | string;
  href?: string;
  children?: NavItemData[];
  mobile?: boolean;
  accent?: boolean;
};

export type NavGroupData = {
  heading?: string;
  items: NavItemData[];
};

export type WorkspaceOption = {
  id: string;
  label: string;
  mark: string;
  disabled?: boolean;
  tag?: string;
};

export type BranchMembership = "none" | "member" | "owner";

export const WORKER_WORKSPACES: WorkspaceOption[] = [
  { id: "admin", label: "Admin", mark: "A" },
  { id: "steam", label: "Steam", mark: "S" },
  {
    id: "polymarket",
    label: "PolyMarket",
    mark: "P",
    disabled: true,
    tag: "В разработке",
  },
];

export const DOCS_OVERVIEW_URL = "https://docs.garbona.cc/docs/#overview";

export const BRANCH_CABINET_VIEWS = [
  "branch-overview",
  "branch-members",
  "branch-settings",
  "branch-manuals",
  "branch-create",
] as const;

export function isBranchCabinetView(view: string) {
  return (BRANCH_CABINET_VIEWS as readonly string[]).includes(view);
}

export function buildWorkerNavGroups(
  membership: BranchMembership = "none",
): NavGroupData[] {
  const branchItem: NavItemData =
    membership === "none"
      ? { id: "branch", title: "Филиал", icon: GitBranch }
      : {
          id: "branch-cabinet",
          title: "Личный кабинет",
          icon: GitBranch,
          accent: true,
          children: [
            { id: "branch-overview", title: "Обзор", icon: LayoutDashboard },
            { id: "branch-members", title: "Участники", icon: Users },
            { id: "branch-manuals", title: "Мануалы", icon: BookOpen },
            ...(membership === "owner"
              ? [{ id: "branch-settings", title: "Настройки", icon: Settings2 }]
              : []),
            { id: "branch", title: "Каталог", icon: List },
          ],
        };

  return [
    {
      items: [
        {
          id: "dashboard",
          title: "Главная",
          icon: LayoutDashboard,
          mobile: true,
        },
        { id: "sites", title: "Домен", icon: Globe, mobile: true },
        { id: "analytics", title: "Аналитика", icon: Activity, mobile: true },
        branchItem,
        { id: "wallet", title: "Кошелёк", icon: CreditCard },
      ],
    },
    {
      heading: "Остальное",
      items: [
        { id: "top", title: "Топ", icon: Trophy },
        { id: "settings", title: "Настройки", icon: Settings },
        {
          id: "getting-started",
          title: "С чего начать",
          icon: BookOpen,
          href: DOCS_OVERVIEW_URL,
        },
      ],
    },
  ];
}

export const WORKER_NAV_GROUPS: NavGroupData[] = buildWorkerNavGroups("none");

export const WORKER_BOTTOM_ITEMS: NavItemData[] = [
  { id: "logout", title: "Выйти", icon: LogOut },
];

const WALLET_MOBILE: NavItemData = {
  id: "wallet",
  title: "Кошелёк",
  icon: CreditCard,
  mobile: true,
};

export function flattenNavItems(items: NavItemData[]): NavItemData[] {
  return items.reduce<NavItemData[]>((acc, item) => {
    acc.push(item);
    if (item.children) acc.push(...flattenNavItems(item.children));
    return acc;
  }, []);
}

export function workerMobileItems(membership: BranchMembership = "none") {
  return [
    ...flattenNavItems(
      buildWorkerNavGroups(membership).flatMap((group) => group.items),
    ).filter((item) => item.mobile),
    WALLET_MOBILE,
  ];
}

function WorkspaceSwitcher({
  brand,
  logoUrl,
  workspaces,
  selectedId,
  onSelect,
}: {
  brand: string;
  logoUrl?: string;
  workspaces: WorkspaceOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const current =
    workspaces.find((item) => item.id === selectedId) || workspaces[0];

  return (
    <div className={clsx("gsb-switcher", open && "is-open")}>
      <button
        type="button"
        className="gsb-switcher__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="gsb-switcher__identity">
          <span className="gsb-mark">
            {logoUrl ? <img src={logoUrl} alt="" width={32} height={32} /> : brand.charAt(0)}
          </span>
          <span className="gsb-switcher__copy">
            <strong>{brand}</strong>
            <small>{current?.label}</small>
          </span>
        </span>
        <ChevronDown className="gsb-switcher__chevron" strokeWidth={1.5} />
      </button>
      {open ? (
        <>
          <div className="gsb-switcher__scrim" onClick={() => setOpen(false)} />
          <div className="gsb-switcher__menu" id={menuId} role="menu">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="menuitem"
                className={clsx(
                  "gsb-switcher__option",
                  workspace.id === selectedId && "is-current",
                )}
                disabled={workspace.disabled}
                onClick={() => {
                  if (workspace.disabled) return;
                  onSelect(workspace.id);
                  setOpen(false);
                }}
              >
                <span className="gsb-switcher__option-mark">{workspace.mark}</span>
                <span className="gsb-switcher__option-name">{workspace.label}</span>
                {workspace.tag ? (
                  <span className="gsb-switcher__option-tag">{workspace.tag}</span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function itemOrChildActive(item: NavItemData, activeId: string): boolean {
  if (item.id === activeId) return true;
  // Create wizard lives under the branch cabinet / catalog group.
  if (
    activeId === "branch-create" &&
    (item.id === "branch-cabinet" || item.id === "branch")
  ) {
    return true;
  }
  return Boolean(item.children?.some((child) => itemOrChildActive(child, activeId)));
}

function NavItem({
  item,
  activeId,
  onSelect,
  level = 0,
}: {
  item: NavItemData;
  activeId: string;
  onSelect: (id: string) => void;
  level?: number;
}) {
  const hasChildren = Boolean(item.children?.length);
  const childActive = hasChildren && itemOrChildActive(item, activeId);
  const [open, setOpen] = useState(() => childActive);
  const isActive = !item.href && !hasChildren && activeId === item.id;
  const Tag = item.href ? "a" : "button";

  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  return (
    <div className={clsx("gsb-item", item.accent && "is-accent", childActive && "has-active")}>
      <Tag
        type={item.href ? undefined : "button"}
        href={item.href}
        target={item.href ? "_blank" : undefined}
        rel={item.href ? "noopener noreferrer" : undefined}
        className={clsx(
          "gsb-item__row",
          isActive && "is-active",
          item.accent && "is-accent",
          hasChildren && childActive && "is-branch-open",
        )}
        style={{ paddingLeft: `${level * 12 + 10}px` }}
        onClick={() => {
          if (hasChildren) {
            setOpen((value) => !value);
            return;
          }
          if (!item.href) onSelect(item.id);
        }}
      >
        <span className="gsb-item__lead">
          <item.icon strokeWidth={1.5} />
          <span className="gsb-item__label">{item.title}</span>
        </span>
        <span className="gsb-item__meta">
          {item.badge != null ? <span className="gsb-badge">{item.badge}</span> : null}
          {hasChildren ? (
            <ChevronRight
              className={clsx("gsb-item__chevron", open && "is-open")}
              strokeWidth={2}
            />
          ) : null}
        </span>
      </Tag>
      {hasChildren ? (
        <div className={clsx("gsb-children", open && "is-open")}>
          <div
            className="gsb-children__inner"
            style={
              {
                "--gsb-child-rule-left": `${level * 12 + 17.5}px`,
              } as CSSProperties
            }
          >
            <div
              className="gsb-children__rule"
              style={{ left: `${level * 12 + 17.5}px` }}
            />
            {item.children!.map((child) => (
              <NavItem
                key={child.id}
                item={child}
                activeId={activeId}
                onSelect={onSelect}
                level={level + 1}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SidebarNav({
  className = "",
  activeId,
  onSelect,
  groups = WORKER_NAV_GROUPS,
  bottomItems = WORKER_BOTTOM_ITEMS,
  workspaces = WORKER_WORKSPACES,
  activeWorkspace,
  onWorkspaceSelect,
  brand = "GARBONA",
  logoUrl,
}: {
  className?: string;
  activeId?: string;
  onSelect?: (id: string) => void;
  groups?: NavGroupData[];
  bottomItems?: NavItemData[];
  workspaces?: WorkspaceOption[];
  activeWorkspace?: string;
  onWorkspaceSelect?: (id: string) => void;
  brand?: string;
  logoUrl?: string;
}) {
  const [internalId, setInternalId] = useState(activeId || "dashboard");
  const [workspaceId, setWorkspaceId] = useState(activeWorkspace || "steam");
  const currentId = activeId !== undefined ? activeId : internalId;
  const currentWorkspace = activeWorkspace !== undefined ? activeWorkspace : workspaceId;

  const handleSelect = (id: string) => {
    if (activeId === undefined) setInternalId(id);
    onSelect?.(id);
  };

  return (
    <nav className={clsx("gsb-root", className)} aria-label="Навигация">
      <WorkspaceSwitcher
        brand={brand}
        logoUrl={logoUrl}
        workspaces={workspaces}
        selectedId={currentWorkspace}
        onSelect={(id) => {
          if (activeWorkspace === undefined) setWorkspaceId(id);
          onWorkspaceSelect?.(id);
        }}
      />

      <div className="gsb-scroll">
        {groups.map((group, index) => (
          <div className="gsb-group" key={group.heading || index}>
            {group.heading ? <div className="gsb-heading">{group.heading}</div> : null}
            {group.items.map((item) => (
              <NavItem
                key={item.id}
                item={item}
                activeId={currentId}
                onSelect={handleSelect}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="gsb-foot">
        {bottomItems.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            activeId={currentId}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </nav>
  );
}

export default SidebarNav;
