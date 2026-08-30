/*
 * Single source of truth for admin navigation.
 *
 * The sidebar, the mobile bottom bar, the "more" sheet and the page title are
 * all derived from this list, so a label can never drift between them.
 */
window.AdminNav = (function () {
  const GROUPS = [
    { id: "main", label: "Главное" },
    { id: "manage", label: "Управление" },
    { id: "system", label: "Система" },
  ];

  const ITEMS = [
    {
      id: "overview",
      label: "Обзор",
      group: "main",
      mobilePrimary: true,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1V10.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    },
    {
      id: "logs",
      label: "Логи",
      group: "main",
      mobilePrimary: true,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 5h12M6 10h12M6 15h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="4" y="3.5" width="16" height="17" rx="2" stroke="currentColor" stroke-width="1.6"/></svg>',
    },
    {
      id: "users",
      label: "Участники",
      mobileLabel: "Люди",
      group: "main",
      mobilePrimary: true,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M15.2 14.4c1.7.4 3 1.7 3.5 3.6M17 6.6a2.4 2.4 0 0 1 0 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    },
    {
      id: "apps",
      label: "Заявки",
      group: "main",
      mobilePrimary: true,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h10a2 2 0 0 1 2 2v14l-3.2-2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 9h6M9 13h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    },
    {
      id: "payouts",
      label: "Выплаты",
      group: "main",
      mobilePrimary: true,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.2h14.5A1.5 1.5 0 0 1 20 9.7v8.1a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.8V8.2Zm0 0V6.8a1.5 1.5 0 0 1 1.5-1.5h10.2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><path d="M15.2 13.2h3.3v2.2h-3.3a1.1 1.1 0 0 1 0-2.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    },
    {
      id: "admins",
      label: "Администраторы",
      group: "main",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5 19 7.3v5.4c0 4.3-3 6.8-7 7.8-4-1-7-3.5-7-7.8V7.3L12 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9.2 12.1 11 14l3.9-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    },
    {
      id: "comms",
      label: "Коммуникация",
      group: "manage",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 11.2 19.5 5v12l-15-6.2v.4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m7.5 12.5 1.1 5.3h3.1l-1.4-4.2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    },
    {
      id: "stats",
      label: "Статистика",
      group: "manage",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 19.5h15M7 16.5V11M12 16.5V7.5M17 16.5v-3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    },
    {
      id: "ads",
      label: "Реклама",
      group: "manage",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7.5h14v9H5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7.5M8.5 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    },
    {
      id: "economy",
      label: "Экономика",
      group: "manage",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><ellipse cx="12" cy="7" rx="7.5" ry="3" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 7v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V7M4.5 12v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5" stroke="currentColor" stroke-width="1.6"/></svg>',
    },
    {
      id: "sites",
      label: "Сайты",
      group: "manage",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 9h17M8 13h4.5M8 16h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    },
    {
      id: "templates",
      label: "Шаблоны",
      group: "manage",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 9h16M9 9v11" stroke="currentColor" stroke-width="1.6"/></svg>',
    },
    {
      id: "steam",
      label: "Логи Steam",
      group: "system",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/><circle cx="15.7" cy="8.7" r="2.3" stroke="currentColor" stroke-width="1.6"/><path d="m6.2 14.6 3.6 1.5a2.4 2.4 0 1 0 1.8-3.9l-3.2-1.3M11.6 12.2l2.4-1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    },
    {
      id: "autosales",
      label: "Автопродажи",
      group: "system",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 8.5h15v10.2a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8V8.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 8.5V6.8A4 4 0 0 1 12 2.8a4 4 0 0 1 4 4v1.7M9.5 13.2h5M9.5 16.2h3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    },
    {
      id: "botlogs",
      label: "Логи бота",
      group: "system",
      mobilePrimary: false,
      icon: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 4v3M8 12h.01M16 12h.01M9 16h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    },
  ];

  const MORE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="6.5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="17.5" cy="12" r="1.5" fill="currentColor"/></svg>';

  const byId = new Map(ITEMS.map((item) => [item.id, item]));
  const primaryIds = new Set(ITEMS.filter((item) => item.mobilePrimary).map((item) => item.id));

  function label(item, variant) {
    if (!item) return "";
    if (variant === "mobile" && item.mobileLabel) return item.mobileLabel;
    return item.label;
  }

  function title(viewId) {
    return byId.get(viewId)?.label || "";
  }

  return { GROUPS, ITEMS, MORE_ICON, byId, primaryIds, label, title };
})();
