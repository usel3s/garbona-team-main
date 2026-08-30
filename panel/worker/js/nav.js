/*
 * Single source of truth for worker navigation.
 *
 * The sidebar, the mobile bottom bar, the "more" sheet and the document title
 * are all derived from this list, so a label can never drift between them.
 */
window.WorkerNav = (function () {
  const GROUPS = [
    { id: "main", labelKey: "nav.section.main" },
    { id: "other", labelKey: "nav.section.other" },
  ];

  const ICONS = {
    dashboard:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1V10.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    sites:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9h17" stroke="currentColor" stroke-width="1.6"/><path d="M7 7h.01M9.5 7h.01M12 7h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 13h4.5M8 16h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    analytics:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 19.5h15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7 16.5V11M12 16.5V7.5M17 16.5v-3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    wallet:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.2h14.5A1.5 1.5 0 0 1 20 9.7v8.1A1.5 1.5 0 0 1 18.5 19.3H5.5A1.5 1.5 0 0 1 4 17.8V8.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 8.2V6.8A1.5 1.5 0 0 1 5.5 5.3h10.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M15.2 13.2h3.3v2.2h-3.3a1.1 1.1 0 0 1 0-2.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    branch:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.5 6.5v11M6.5 6.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM6.5 17.5a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM17.5 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM8.7 6.5h4.6c2.3 0 4.2 1.9 4.2 4.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.7 17.5h4.6c2.3 0 4.2-1.9 4.2-4.2v-.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    top:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.5 19.5h11M8 19.5v-5.2h8v5.2M10 14.3V9.8h4v4.5M12 9.8V6.2M9.8 6.2h4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="4.6" r="1.2" stroke="currentColor" stroke-width="1.5"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z" stroke="currentColor" stroke-width="1.6"/><path d="M18.7 14.2c.1-.4.2-.8.2-1.2s-.1-.8-.2-1.2l1.8-1.4-1.7-3-2.1.8c-.6-.5-1.3-.8-2-1.1L14.3 4h-4.6l-.4 2.1c-.7.3-1.4.6-2 1.1l-2.1-.8-1.7 3 1.8 1.4c-.1.4-.2.8-.2 1.2s.1.8.2 1.2L3.5 15.6l1.7 3 2.1-.8c.6.5 1.3.8 2 1.1l.4 2.1h4.6l.4-2.1c.7-.3 1.4-.6 2-1.1l2.1.8 1.7-3-1.8-1.4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    overview:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1V10.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    users:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="7" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M22 21v-2a3.6 3.6 0 0 0-2.7-3.5M16.5 3.7a3.2 3.2 0 0 1 0 6.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    manuals:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5.5h5.2a3 3 0 0 1 3 3V20a2.4 2.4 0 0 0-2.4-2.4H5V5.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 5.5h-5.2a3 3 0 0 0-3 3V20a2.4 2.4 0 0 1 2.4-2.4H19V5.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    list:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 7h11M8 12h11M8 17h11M5 7h.01M5 12h.01M5 17h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  const BASE_ITEMS = [
    {
      id: "dashboard",
      labelKey: "nav.dashboard",
      group: "main",
      mobilePrimary: true,
      icon: ICONS.dashboard,
    },
    {
      id: "sites",
      labelKey: "nav.sites",
      group: "main",
      mobilePrimary: true,
      icon: ICONS.sites,
    },
    {
      id: "analytics",
      labelKey: "nav.analytics",
      group: "main",
      mobilePrimary: true,
      icon: ICONS.analytics,
    },
    {
      id: "wallet",
      labelKey: "nav.wallet",
      group: "main",
      mobilePrimary: true,
      icon: ICONS.wallet,
    },
    {
      id: "branch",
      labelKey: "nav.branch",
      group: "main",
      mobilePrimary: false,
      icon: ICONS.branch,
    },
    {
      id: "top",
      labelKey: "nav.top",
      group: "other",
      mobilePrimary: false,
      icon: ICONS.top,
    },
    {
      id: "settings",
      labelKey: "nav.settings",
      group: "other",
      mobilePrimary: false,
      icon: ICONS.settings,
    },
  ];

  const MORE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="6.5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="17.5" cy="12" r="1.5" fill="currentColor"/></svg>';

  const EXTRA_TITLE_KEYS = {
    support: "nav.support",
    "branch-overview": "nav.branchOverview",
    "branch-members": "nav.branchMembers",
    "branch-manuals": "nav.branchManuals",
    "branch-settings": "nav.branchSettings",
    "branch-create": "nav.branchCreate",
  };

  function branchChildren(membership) {
    const kids = [
      {
        id: "branch",
        section: "overview",
        labelKey: "nav.branchOverview",
        group: "main",
        icon: ICONS.overview,
      },
      {
        id: "branch",
        section: "members",
        labelKey: "nav.branchMembers",
        group: "main",
        icon: ICONS.users,
      },
      {
        id: "branch",
        section: "manuals",
        labelKey: "nav.branchManuals",
        group: "main",
        icon: ICONS.manuals,
      },
    ];
    if (membership === "owner") {
      kids.push({
        id: "branch",
        section: "settings",
        labelKey: "nav.branchSettings",
        group: "main",
        icon: ICONS.settings,
      });
    }
    kids.push({
      id: "branch",
      section: "catalog",
      labelKey: "nav.branchCatalog",
      group: "main",
      icon: ICONS.list,
    });
    return kids;
  }

  function buildItems(membership = "none") {
    const items = BASE_ITEMS.map((item) => ({ ...item }));
    if (membership !== "owner" && membership !== "member") return items;

    const index = items.findIndex((item) => item.id === "branch");
    if (index < 0) return items;

    items[index] = {
      id: "branch-cabinet",
      labelKey: "nav.branchCabinet",
      group: "main",
      accent: true,
      defaultOpen: true,
      icon: ICONS.branch,
      children: branchChildren(membership),
    };
    return items;
  }

  const ITEMS = buildItems("none");
  const byId = new Map(BASE_ITEMS.map((item) => [item.id, item]));
  const primaryIds = new Set(
    BASE_ITEMS.filter((item) => item.mobilePrimary).map((item) => item.id)
  );

  function label(entry) {
    return WorkerI18n.t(entry.labelKey);
  }

  function titleKey(viewId, section) {
    if (viewId === "branch" && section && section !== "catalog") {
      return EXTRA_TITLE_KEYS[`branch-${section}`] || "nav.branch";
    }
    return byId.get(viewId)?.labelKey || EXTRA_TITLE_KEYS[viewId] || "nav.dashboard";
  }

  return {
    GROUPS,
    ITEMS,
    MORE_ICON,
    byId,
    primaryIds,
    label,
    titleKey,
    buildItems,
  };
})();
