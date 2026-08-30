window.WorkerViews = window.WorkerViews || {};

WorkerViews.settingsTab = "profile";

WorkerViews.settings = async function renderSettings(ctx) {
  const { main, user } = ctx;
  const tab = WorkerViews.settingsTab || "profile";

  main.innerHTML = `
    <div class="settings-page">
    <header class="page-head settings-page-head">
      <div>
        <h1 class="page-greeting">${WorkerI18n.t("settings.title")}</h1>
        <p class="page-sub muted">${WorkerI18n.t("settings.subtitle")}</p>
      </div>
    </header>
    <div class="settings-layout">
      <nav class="settings-nav" role="tablist" aria-label="${WorkerFormat.escapeHtml(WorkerI18n.t("settings.title"))}">
        ${settingsNavItem("profile", "settings.tabProfile")}
        ${settingsNavItem("password", "settings.tabPassword")}
        ${settingsNavItem("security", "settings.tabSecurity")}
        ${settingsNavItem("appearance", "settings.tabAppearance")}
        ${settingsNavItem("interface", "settings.tabInterface")}
        ${settingsNavItem("payouts", "settings.tabPayouts")}
      </nav>
      <div class="settings-panels">
        <div class="settings-panel" id="settingsPanelProfile" role="tabpanel" data-settings-panel="profile" ${tab !== "profile" ? "hidden" : ""}>
          <div class="settings-panel-head">
            <h2 class="settings-panel-title">${WorkerI18n.t("settings.tabProfile")}</h2>
            <p class="settings-panel-desc">${WorkerI18n.t("settings.profileDesc")}</p>
          </div>
          <div class="settings-form">
            <div class="settings-field">
              <label class="settings-label">${WorkerI18n.t("settings.avatar")}</label>
              <div class="settings-avatar-row">
                <img class="settings-avatar" id="settingsAvatar" alt="" />
                <div class="settings-avatar-actions">
                  <p class="settings-hint">${WorkerI18n.t("settings.avatarHint")}</p>
                </div>
              </div>
            </div>
            <div class="settings-field">
              <label class="settings-label" for="settingsLogin">${WorkerI18n.t("settings.login")}</label>
              <input class="input" id="settingsLogin" type="text" readonly />
              <p class="settings-hint">${WorkerI18n.t("settings.loginHint")}</p>
            </div>
            <div class="settings-field">
              <label class="settings-label" for="settingsBio">${WorkerI18n.t("settings.bio")}</label>
              <textarea class="textarea" id="settingsBio" maxlength="500" rows="3"></textarea>
            </div>
            <div class="settings-toggle-row">
              <div>
                <div class="settings-toggle-label">${WorkerI18n.t("settings.hideInRating")}</div>
                <p class="settings-hint">${WorkerI18n.t("settings.hideInRatingHint")}</p>
              </div>
              <label class="toggle">
                <input type="checkbox" id="settingsAnonymous" />
                <span class="toggle-track" aria-hidden="true"></span>
              </label>
            </div>
            <div class="settings-toggle-row">
              <div>
                <div class="settings-toggle-label">${WorkerI18n.t("settings.autoSellLogs")}</div>
                <p class="settings-hint">${WorkerI18n.t("settings.autoSellLogsHint")}</p>
              </div>
              <label class="toggle">
                <input type="checkbox" id="settingsAutoSellLogs" />
                <span class="toggle-track" aria-hidden="true"></span>
              </label>
            </div>
            <div class="settings-field" id="settingsFakeTagWrap" hidden>
              <label class="settings-label" for="settingsFakeTag">${WorkerI18n.t("settings.fakeTagLabel")}</label>
              <div class="settings-inline-row">
                <input class="input" id="settingsFakeTag" maxlength="6" placeholder="${WorkerFormat.escapeHtml(WorkerI18n.t("settings.fakeTagPlaceholder"))}" autocomplete="off" spellcheck="false" />
                <button type="button" class="btn btn-ghost" id="settingsFakeTagRandom">${WorkerFormat.escapeHtml(WorkerI18n.t("settings.fakeTagRandom"))}</button>
              </div>
              <p class="settings-hint">${WorkerI18n.t("settings.fakeTagHint")}</p>
            </div>
            <div class="settings-actions">
              <button type="button" class="btn btn-primary" id="settingsProfileSave">${WorkerI18n.t("settings.save")}</button>
              <span class="settings-status" id="settingsProfileStatus" hidden></span>
            </div>
          </div>
        </div>

        <div class="settings-panel" id="settingsPanelPassword" role="tabpanel" data-settings-panel="password" ${tab !== "password" ? "hidden" : ""}>
          <div class="settings-panel-head">
            <h2 class="settings-panel-title">${WorkerI18n.t("settings.passwordTitle")}</h2>
            <p class="settings-panel-desc">${WorkerI18n.t("settings.passwordDesc")}</p>
          </div>
          <div class="settings-form">
            <div class="settings-field">
              <label class="settings-label" for="settingsPasswordLogin">${WorkerI18n.t("settings.login")}</label>
              <input class="input" id="settingsPasswordLogin" type="text" readonly />
              <p class="settings-hint">${WorkerI18n.t("settings.loginHint")}</p>
            </div>
            <div class="settings-field" id="settingsCurrentPasswordWrap">
              <label class="settings-label" for="settingsCurrentPassword">${WorkerI18n.t("settings.currentPassword")}</label>
              <input class="input" id="settingsCurrentPassword" type="password" autocomplete="current-password" />
            </div>
            <div class="settings-field">
              <label class="settings-label" for="settingsNewPassword">${WorkerI18n.t("settings.newPassword")}</label>
              <input class="input" id="settingsNewPassword" type="password" autocomplete="new-password" />
            </div>
            <div class="settings-field">
              <label class="settings-label" for="settingsConfirmPassword">${WorkerI18n.t("settings.confirmPassword")}</label>
              <input class="input" id="settingsConfirmPassword" type="password" autocomplete="new-password" />
            </div>
            <p class="settings-hint" id="settingsPasswordHint"></p>
            <div class="settings-actions">
              <button type="button" class="btn btn-primary" id="settingsPasswordSave">${WorkerI18n.t("settings.passwordSave")}</button>
              <span class="settings-status" id="settingsPasswordStatus" hidden></span>
            </div>
          </div>
        </div>

        <div class="settings-panel" id="settingsPanelSecurity" role="tabpanel" data-settings-panel="security" ${tab !== "security" ? "hidden" : ""}>
          <div class="settings-panel-head">
            <h2 class="settings-panel-title">${WorkerI18n.t("settings.securityTitle")}</h2>
            <p class="settings-panel-desc">${WorkerI18n.t("settings.securityDesc")}</p>
          </div>
          <div class="settings-form">
            <div class="settings-status-row">
              <span class="badge badge-off">${WorkerI18n.t("settings.securityOff")}</span>
            </div>
            <p class="settings-hint">${WorkerI18n.t("settings.securityHint")}</p>
            <div class="settings-soon-card">
              <button type="button" class="btn btn-ghost" disabled>${WorkerI18n.t("settings.securityEnable")}</button>
              <span class="badge-soon">${WorkerI18n.t("nav.soon")}</span>
            </div>
          </div>
        </div>

        <div class="settings-panel" id="settingsPanelAppearance" role="tabpanel" data-settings-panel="appearance" ${tab !== "appearance" ? "hidden" : ""}>
          <div class="settings-panel-head">
            <h2 class="settings-panel-title">${WorkerI18n.t("settings.tabAppearance")}</h2>
            <p class="settings-panel-desc">${WorkerI18n.t("settings.appearanceDesc")}</p>
          </div>
          <div class="settings-form">
            <div class="settings-field">
              <label class="settings-label">${WorkerI18n.t("settings.theme")}</label>
              <div class="settings-segments" id="settingsThemeSegments">
                <button type="button" class="settings-segment" data-pref="theme" data-value="light">${WorkerI18n.t("settings.themeLight")}</button>
                <button type="button" class="settings-segment" data-pref="theme" data-value="dark">${WorkerI18n.t("settings.themeDark")}</button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-panel" id="settingsPanelInterface" role="tabpanel" data-settings-panel="interface" ${tab !== "interface" ? "hidden" : ""}>
          <div class="settings-panel-head">
            <h2 class="settings-panel-title">${WorkerI18n.t("settings.tabInterface")}</h2>
            <p class="settings-panel-desc">${WorkerI18n.t("settings.interfaceDesc")}</p>
          </div>
          <div class="settings-form">
            <div class="settings-field">
              <label class="settings-label">${WorkerI18n.t("settings.language")}</label>
              <div class="settings-segments" id="settingsLangSegments">
                <button type="button" class="settings-segment" data-pref="lang" data-value="ru">RU</button>
                <button type="button" class="settings-segment" data-pref="lang" data-value="en">EN</button>
              </div>
            </div>
            <div class="settings-field">
              <label class="settings-label">${WorkerI18n.t("settings.currency")}</label>
              <div class="settings-segments" id="settingsCurrencySegments">
                <button type="button" class="settings-segment" data-pref="currency" data-value="USD">USD</button>
                <button type="button" class="settings-segment" data-pref="currency" data-value="RUB">RUB</button>
              </div>
            </div>
            <div class="settings-field">
              <label class="settings-label">${WorkerI18n.t("settings.defaultPeriod")}</label>
              <div class="settings-segments" id="settingsPeriodSegments">
                <button type="button" class="settings-segment" data-pref="defaultPeriod" data-value="7">${WorkerI18n.t("dashboard.period7")}</button>
                <button type="button" class="settings-segment" data-pref="defaultPeriod" data-value="14">${WorkerI18n.t("dashboard.period14")}</button>
                <button type="button" class="settings-segment" data-pref="defaultPeriod" data-value="30">${WorkerI18n.t("dashboard.period30")}</button>
              </div>
              <p class="settings-hint">${WorkerI18n.t("settings.defaultPeriodHint")}</p>
            </div>
          </div>
        </div>

        <div class="settings-panel" id="settingsPanelPayouts" role="tabpanel" data-settings-panel="payouts" ${tab !== "payouts" ? "hidden" : ""}>
          <div class="settings-panel-head">
            <h2 class="settings-panel-title">${WorkerI18n.t("settings.tabPayouts")}</h2>
            <p class="settings-panel-desc">${WorkerI18n.t("settings.payoutsDesc")}</p>
          </div>
          <div class="settings-payout-list" id="settingsPayoutList"></div>
          <div class="settings-form settings-payout-add">
            <div class="settings-field">
              <label class="settings-label">${WorkerI18n.t("settings.payoutMethod")}</label>
              <div id="settingsPayoutMethod" class="custom-select-host"></div>
            </div>
            <div class="settings-field" id="settingsPayoutAddressField">
              <label class="settings-label" for="settingsPayoutAddress">${WorkerI18n.t("settings.payoutAddress")}</label>
              <input class="input" id="settingsPayoutAddress" type="text" autocomplete="off" />
              <p class="settings-hint" id="settingsPayoutFee"></p>
            </div>
            <div class="settings-actions">
              <button type="button" class="btn btn-primary" id="settingsPayoutsSave">${WorkerI18n.t("settings.payoutAdd")}</button>
              <span class="settings-status" id="settingsPayoutsStatus" hidden></span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>`;

  bindSettingsNav(main);
  syncPrefSegments(main);
  await loadSettingsData(main, user);
};

function settingsNavItem(id, i18nKey) {
  const active = WorkerViews.settingsTab === id ? " is-active" : "";
  const panelId = `settingsPanel${id.charAt(0).toUpperCase()}${id.slice(1)}`;
  return `
    <button
      type="button"
      class="settings-tab${active}"
      data-settings-tab="${id}"
      role="tab"
      aria-controls="${panelId}"
      aria-selected="${String(WorkerViews.settingsTab === id)}"
    >
      <span class="settings-tab-icon" aria-hidden="true">${settingsTabIcon(id)}</span>
      <span>${WorkerI18n.t(i18nKey)}</span>
    </button>`;
}

function settingsTabIcon(id) {
  const icons = {
    profile:
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 19c.8-3.3 3-5 6.5-5s5.7 1.7 6.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    password:
      '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    security:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 19 7v5c0 4.1-2.8 7-7 8.5C7.8 19 5 16.1 5 12V7l7-3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m9.3 12 1.8 1.8 3.8-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    appearance:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5c0-1-.8-1.8-1.8-1.8h-1.4a2 2 0 0 1-2-2V6.7c0-1.8-1.5-3.2-3.3-3.2Z" stroke="currentColor" stroke-width="1.5"/><circle cx="8.2" cy="10" r=".8" fill="currentColor"/><circle cx="10" cy="6.9" r=".8" fill="currentColor"/><circle cx="8.3" cy="14.1" r=".8" fill="currentColor"/></svg>',
    interface:
      '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 5v14M8.5 10h12" stroke="currentColor" stroke-width="1.5"/></svg>',
    payouts:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 7.5h15v11h-15v-11Z" stroke="currentColor" stroke-width="1.5"/><path d="M7.5 7.5V5h9v2.5M15.5 12.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };
  return icons[id] || icons.profile;
}

function bindSettingsNav(root) {
  root.querySelectorAll("[data-settings-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      WorkerViews.settingsTab = btn.dataset.settingsTab;
      history.replaceState(null, "", `#settings/${WorkerViews.settingsTab}`);
      root.querySelectorAll(".settings-tab").forEach((el) => {
        const active = el.dataset.settingsTab === WorkerViews.settingsTab;
        el.classList.toggle("is-active", active);
        el.setAttribute("aria-selected", String(active));
      });
      root.querySelectorAll("[data-settings-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.settingsPanel !== WorkerViews.settingsTab;
      });
    });
  });

  root.querySelectorAll("[data-pref]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.pref;
      let value = btn.dataset.value;
      if (key === "defaultPeriod") value = Number(value);
      WorkerPrefs.set({ [key]: value });
      syncPrefSegments(root);
      if (key === "defaultPeriod") {
        WorkerViews.dashboardPeriodDays = value;
      }
    });
  });
}

function syncPrefSegments(root) {
  const prefs = WorkerPrefs.get();
  root.querySelectorAll("[data-pref]").forEach((btn) => {
    const key = btn.dataset.pref;
    const raw = btn.dataset.value;
    const value = key === "defaultPeriod" ? Number(raw) : raw;
    const current = key === "defaultPeriod" ? prefs.defaultPeriod : prefs[key];
    btn.classList.toggle("is-active", String(current) === String(value));
  });
}

function setSettingsStatus(id, text, ok = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle("is-error", !ok);
  el.classList.toggle("is-ok", ok);
  if (text) {
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.hidden = true;
    }, 2800);
  }
}

async function loadSettingsData(root, user) {
  let data;
  try {
    data = await WorkerAPI.get("/settings");
  } catch (error) {
    root.querySelector(".settings-panels").innerHTML = `
      <div class="section"><div class="empty">
        <div>${WorkerFormat.escapeHtml(WorkerI18n.t("common.error"))}</div>
        <div class="muted">${WorkerFormat.escapeHtml(error.message || String(error))}</div>
      </div></div>`;
    return;
  }

  const u = data.user || user;
  const login = u.username || u.appLogin || u.telegramId || "—";
  const telegram = u.username ? `@${u.username}` : u.telegramId || "—";

  const avatarEl = document.getElementById("settingsAvatar");
  if (avatarEl) {
    const candidates = [];
    const photo = String(u.photoUrl || "").trim();
    if (/^(?:https?:\/\/|\/)/i.test(photo)) candidates.push(photo);
    const telegramId = String(u.telegramId || "").trim();
    if (/^\d+$/.test(telegramId)) {
      candidates.push(`/assets/avatar/${telegramId}`);
    }
    const username = String(u.username || "")
      .trim()
      .replace(/^@/, "");
    if (/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      candidates.push(`https://t.me/i/userpic/320/${username}.jpg`);
    }

    const sources = [...new Set(candidates)];
    let nextIndex = 0;
    const loadNext = () => {
      if (nextIndex >= sources.length) {
        avatarEl.onerror = null;
        avatarEl.removeAttribute("src");
        return;
      }
      avatarEl.onerror = loadNext;
      avatarEl.src = sources[nextIndex];
      nextIndex += 1;
    };
    avatarEl.referrerPolicy = "no-referrer";
    loadNext();
  }

  const loginEl = document.getElementById("settingsLogin");
  if (loginEl) loginEl.value = login;

  const passwordLoginEl = document.getElementById("settingsPasswordLogin");
  if (passwordLoginEl) passwordLoginEl.value = u.appLogin || login;

  let hasAppPassword = Boolean(u.hasAppPassword);
  const currentWrap = document.getElementById("settingsCurrentPasswordWrap");
  const passwordHint = document.getElementById("settingsPasswordHint");
  const currentInput = document.getElementById("settingsCurrentPassword");
  const newInput = document.getElementById("settingsNewPassword");
  const confirmInput = document.getElementById("settingsConfirmPassword");

  function paintPasswordForm() {
    if (currentWrap) currentWrap.hidden = !hasAppPassword;
    if (passwordHint) {
      passwordHint.textContent = hasAppPassword
        ? WorkerI18n.t("settings.passwordChangeHint")
        : WorkerI18n.t("settings.passwordSetHint");
    }
  }
  paintPasswordForm();

  document.getElementById("settingsPasswordSave")?.addEventListener("click", async () => {
    const payload = {
      newPassword: newInput?.value || "",
      confirmPassword: confirmInput?.value || "",
    };
    if (hasAppPassword) {
      payload.currentPassword = currentInput?.value || "";
    }
    try {
      await WorkerAPI.post("/settings/password", payload);
      if (currentInput) currentInput.value = "";
      if (newInput) newInput.value = "";
      if (confirmInput) confirmInput.value = "";
      hasAppPassword = true;
      paintPasswordForm();
      setSettingsStatus("settingsPasswordStatus", WorkerI18n.t("settings.passwordSaved"), true);
    } catch (error) {
      setSettingsStatus("settingsPasswordStatus", error.message || WorkerI18n.t("common.error"), false);
    }
  });

  const bioEl = document.getElementById("settingsBio");
  if (bioEl) bioEl.value = u.bio || "";

  const anonEl = document.getElementById("settingsAnonymous");
  const autoSellEl = document.getElementById("settingsAutoSellLogs");
  const fakeTagWrap = document.getElementById("settingsFakeTagWrap");
  const fakeTagEl = document.getElementById("settingsFakeTag");
  if (anonEl) anonEl.checked = Boolean(u.isAnonymous);
  if (autoSellEl) autoSellEl.checked = u.autoSellLogs !== false;
  if (fakeTagEl) fakeTagEl.value = String(u.fakeProfitTag || "").replace(/^#+/, "");

  function syncFakeTagVisibility() {
    if (!fakeTagWrap || !anonEl) return;
    fakeTagWrap.hidden = !anonEl.checked;
  }
  syncFakeTagVisibility();
  anonEl?.addEventListener("change", syncFakeTagVisibility);

  document.getElementById("settingsFakeTagRandom")?.addEventListener("click", () => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const len = 4 + Math.floor(Math.random() * 3);
    let tag = "";
    for (let i = 0; i < len; i += 1) {
      tag += chars[Math.floor(Math.random() * chars.length)];
    }
    if (fakeTagEl) fakeTagEl.value = tag;
  });

  document.getElementById("settingsProfileSave")?.addEventListener("click", async () => {
    try {
      const payload = {
        bio: document.getElementById("settingsBio")?.value || "",
        isAnonymous: Boolean(document.getElementById("settingsAnonymous")?.checked),
        autoSellLogs: Boolean(document.getElementById("settingsAutoSellLogs")?.checked),
      };
      if (payload.isAnonymous && fakeTagEl) {
        payload.fakeProfitTag = fakeTagEl.value.trim();
      }
      const res = await WorkerAPI.patch("/settings", payload);
      if (res.user) {
        Object.assign(user, res.user);
        if (fakeTagEl) fakeTagEl.value = String(res.user.fakeProfitTag || "").replace(/^#+/, "");
        syncFakeTagVisibility();
      }
      setSettingsStatus("settingsProfileStatus", WorkerI18n.t("settings.saved"), true);
    } catch (error) {
      setSettingsStatus("settingsProfileStatus", error.message || WorkerI18n.t("common.error"), false);
    }
  });

  const methods = (data.methods || []).map((m) => ({
    value: m.id,
    label: m.label,
    feeUsd: m.feeUsd,
    linkPayout: Boolean(m.linkPayout),
    nicknamePayout: Boolean(m.nicknamePayout) || String(m.id) === "lolz",
  }));
  let payoutRequisites = Array.isArray(u.payoutRequisites)
    ? u.payoutRequisites.map((row) => ({
        id: row.id,
        method: row.method,
        address: row.address,
      }))
    : [];
  if (!payoutRequisites.length && (u.payoutMethod || u.payoutAddress)) {
    payoutRequisites = [
      { id: "legacy", method: u.payoutMethod || "", address: u.payoutAddress || "" },
    ].filter((row) => row.method && row.address);
  }

  const payoutState = {
    method: methods[0]?.value || "",
    address: "",
  };

  const addressEl = document.getElementById("settingsPayoutAddress");
  if (addressEl) addressEl.value = "";

  function methodLabelOf(id) {
    return methods.find((m) => m.value === id)?.label || id || "—";
  }

  function isLinkPayoutMethod(id) {
    return Boolean(methods.find((m) => m.value === id)?.linkPayout);
  }

  function isNickPayoutMethod(id) {
    return Boolean(methods.find((m) => m.value === id)?.nicknamePayout) || String(id) === "lolz";
  }

  function syncPayoutAddressField() {
    const field = document.getElementById("settingsPayoutAddressField");
    const label = field?.querySelector("label");
    const linkPayout = isLinkPayoutMethod(payoutState.method);
    const nickPayout = isNickPayoutMethod(payoutState.method);
    if (field) field.hidden = linkPayout;
    if (linkPayout && addressEl) addressEl.value = "";
    if (label) {
      label.textContent = nickPayout
        ? WorkerI18n.t("settings.payoutNick")
        : WorkerI18n.t("settings.payoutAddress");
    }
    if (addressEl) {
      addressEl.placeholder = nickPayout ? WorkerI18n.t("settings.payoutNickPlaceholder") : "";
    }
  }

  function renderPayoutList() {
    const host = document.getElementById("settingsPayoutList");
    if (!host) return;
    if (!payoutRequisites.length) {
      host.innerHTML = `<div class="settings-payout-empty">${WorkerFormat.escapeHtml(
        WorkerI18n.t("settings.payoutEmpty")
      )}</div>`;
      return;
    }
    host.innerHTML = payoutRequisites
      .map(
        (row) => `
        <div class="settings-payout-row" data-payout-id="${WorkerFormat.escapeHtml(row.id)}">
          <div class="settings-payout-row-copy">
            <strong>${WorkerFormat.escapeHtml(methodLabelOf(row.method))}</strong>
            <span>${WorkerFormat.escapeHtml(
              isLinkPayoutMethod(row.method)
                ? WorkerI18n.t("settings.payoutLinkMethodHint")
                : row.address
            )}</span>
          </div>
          <button type="button" class="btn btn-ghost settings-payout-remove" data-payout-remove="${WorkerFormat.escapeHtml(
            row.id
          )}">${WorkerI18n.t("settings.payoutRemove")}</button>
        </div>`
      )
      .join("");
    host.querySelectorAll("[data-payout-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.payoutRemove;
        const previous = payoutRequisites.slice();
        payoutRequisites = payoutRequisites.filter((row) => String(row.id) !== String(id));
        const ok = await savePayoutRequisites();
        if (!ok) {
          payoutRequisites = previous;
          renderPayoutList();
        }
      });
    });
  }

  async function savePayoutRequisites() {
    try {
      const res = await WorkerAPI.patch("/settings", { payoutRequisites });
      if (res.user?.payoutRequisites) {
        payoutRequisites = res.user.payoutRequisites.slice();
        Object.assign(user, res.user);
      }
      renderPayoutList();
      setSettingsStatus("settingsPayoutsStatus", WorkerI18n.t("settings.saved"), true);
      return true;
    } catch (error) {
      setSettingsStatus("settingsPayoutsStatus", error.message || WorkerI18n.t("common.error"), false);
      return false;
    }
  }

  function updateFeeHint() {
    const feeEl = document.getElementById("settingsPayoutFee");
    if (!feeEl) return;
    const meta = methods.find((m) => m.value === payoutState.method);
    const fee = meta?.feeUsd;
    feeEl.textContent =
      fee != null && fee > 0
        ? WorkerI18n.t("settings.payoutFee", { fee: WorkerFormat.money(fee) })
        : WorkerI18n.t("settings.payoutFeeNone");
  }

  if (methods.length) {
    WorkerDropdown.mount(document.getElementById("settingsPayoutMethod"), {
      value: payoutState.method,
      ariaLabel: WorkerI18n.t("settings.payoutMethod"),
      options: methods.map((m) => ({ value: m.value, label: m.label })),
      onChange: (value) => {
        payoutState.method = value;
        updateFeeHint();
        syncPayoutAddressField();
      },
    });
    updateFeeHint();
    syncPayoutAddressField();
  } else {
    document.getElementById("settingsPayoutMethod").innerHTML = `<span class="muted">${WorkerI18n.t("common.empty")}</span>`;
  }

  renderPayoutList();

  document.getElementById("settingsPayoutsSave")?.addEventListener("click", async () => {
    try {
      const method = payoutState.method;
      const address = addressEl?.value?.trim() || "";
      if (!method) {
        setSettingsStatus("settingsPayoutsStatus", WorkerI18n.t("wallet.validationMethod"), false);
        return;
      }
      if (!isLinkPayoutMethod(method) && !address) {
        setSettingsStatus(
          "settingsPayoutsStatus",
          WorkerI18n.t(isNickPayoutMethod(method) ? "wallet.validationNick" : "wallet.validationAddress"),
          false
        );
        return;
      }
      const previous = payoutRequisites.slice();
      payoutRequisites = [{ method, address }, ...payoutRequisites];
      const ok = await savePayoutRequisites();
      if (!ok) {
        payoutRequisites = previous;
        renderPayoutList();
        return;
      }
      if (addressEl) addressEl.value = "";
    } catch (error) {
      setSettingsStatus("settingsPayoutsStatus", error.message || WorkerI18n.t("common.error"), false);
    }
  });
}
