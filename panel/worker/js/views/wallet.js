window.WorkerViews = window.WorkerViews || {};

const LINK_PAYOUT_METHODS = new Set(["xRocketr", "cryptobot"]);

function isLinkPayoutMethod(method) {
  return LINK_PAYOUT_METHODS.has(String(method || "").trim());
}

function isNickPayoutMethod(method, methodsList = []) {
  const id = String(method || "").trim();
  if (id === "lolz") return true;
  return Boolean((methodsList || []).find((item) => String(item.id) === id)?.nicknamePayout);
}

WorkerViews.walletState = {
  tab: "profits",
  wallet: null,
  history: [],
  historyPage: 0,
  historyPageCount: 1,
  historyTotal: 0,
};

const WALLET_HISTORY_PAGE_SIZE = 10;

function walletStatusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return "ok";
  if (value === "rejected") return "bad";
  if (value === "pending" || value === "awaiting_payout_link") return "warn";
  return "";
}

function walletStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return WorkerI18n.t("wallet.statusApproved");
  if (value === "rejected") return WorkerI18n.t("wallet.statusRejected");
  if (value === "awaiting_payout_link") return WorkerI18n.t("wallet.statusAwaiting");
  if (value === "pending") return WorkerI18n.t("wallet.statusPending");
  return status || "—";
}

function walletPayoutAction(item) {
  const url = String(item?.payoutUrl || "").trim();
  if (String(item?.status) !== "approved" || !/^https?:\/\//i.test(url)) return "";
  const label = isLinkPayoutMethod(item.method) ? "Активировать чек" : "Открыть транзакцию";
  return `<a class="wallet-payout-action" href="${walletEscape(url)}" target="_blank" rel="noopener noreferrer"><span>${walletEscape(label)}</span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 16 16 8M10 8h6v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`;
}

function walletPayoutActionCell(item) {
  return walletPayoutAction(item) || '<span class="wallet-payout-action-empty">—</span>';
}

function walletEscape(value) {
  return WorkerFormat.escapeHtml(String(value ?? ""));
}

function walletAddressParts(address) {
  const value = String(address || "").trim();
  if (!value) return null;
  const headLength = Math.min(7, Math.max(3, Math.floor(value.length * 0.22)));
  const tailLength = Math.min(5, Math.max(3, Math.floor(value.length * 0.14)));
  const hasTail = value.length > headLength + tailLength;
  return {
    value,
    head: value.slice(0, headLength),
    middle: value.slice(headLength, hasTail ? -tailLength : undefined) || "••••",
    tail: hasTail ? value.slice(-tailLength) : "",
  };
}

function renderWalletAddress(address) {
  const parts = walletAddressParts(address);
  if (!parts) return `<span class="muted">—</span>`;
  const hint = WorkerI18n.t("wallet.copyHint");
  return `
    <button
      type="button"
      class="wallet-addr"
      data-address="${walletEscape(parts.value)}"
      title="${walletEscape(hint)}"
      aria-label="${walletEscape(hint)}"
    >
      <span class="wallet-addr-peek" aria-hidden="true">
        <span class="wallet-addr-clear">${walletEscape(parts.head)}</span><span class="wallet-addr-blur">${walletEscape(parts.middle)}</span><span class="wallet-addr-clear">${walletEscape(parts.tail)}</span>
      </span>
      <span class="wallet-addr-full">${walletEscape(parts.value)}</span>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>`;
}

function bindWalletAddressCopy(root) {
  root?.querySelectorAll(".wallet-addr").forEach((button) => {
    button.addEventListener("click", async () => {
      const address = String(button.dataset.address || "").trim();
      if (!address) return;
      try {
        await navigator.clipboard.writeText(address);
        if (window.WorkerToast) WorkerToast.success(WorkerI18n.t("wallet.copied"));
      } catch (_) {
        if (window.WorkerToast) WorkerToast.error(WorkerI18n.t("wallet.copyFailed"));
      }
    });
  });
}

function walletEmptyState(tab) {
  const isProfits = tab === "profits";
  const isTransfers = tab === "transfers";
  let titleKey = "wallet.emptyWithdrawalsTitle";
  let textKey = "wallet.emptyWithdrawalsText";
  let iconPath =
    '<path d="M4 7.5h16v11H4v-11Z" stroke="currentColor" stroke-width="1.5"/><path d="M7 7.5V5h10v2.5M16 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
  if (isProfits) {
    titleKey = "wallet.emptyProfitsTitle";
    textKey = "wallet.emptyProfitsText";
    iconPath =
      '<path d="M4 16.5 9.2 11l3.3 3.2L20 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 7.5H20V12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  } else if (isTransfers) {
    titleKey = "wallet.emptyTransfersTitle";
    textKey = "wallet.emptyTransfersText";
    iconPath =
      '<path d="M7 8h10M7 12h6M4 6.5h16v11H4v-11Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14.5 15.5 17 13l2.5 2.5M17 13v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  return `
    <div class="wallet-empty">
      <span class="wallet-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">${iconPath}</svg>
      </span>
      <strong>${walletEscape(WorkerI18n.t(titleKey))}</strong>
      <span>${walletEscape(WorkerI18n.t(textKey))}</span>
    </div>`;
}

function transferPeerLabel(item) {
  const username = String(item?.peerUsername || "").trim();
  if (username) return `@${username}`;
  return String(item?.peerTelegramId || "—");
}

function walletSourceIdLabel(item) {
  const id = String(item?.sourceId || "").trim();
  if (!id) return "";
  return /^\d+$/.test(id) ? `#${id}` : id;
}

function renderWalletSourceId(item) {
  const label = walletSourceIdLabel(item);
  if (!label) return `<span class="muted">—</span>`;
  return `<span class="wallet-log-id">${walletEscape(label)}</span>`;
}

function profitTypeLabel(item) {
  const note = String(item?.note || "").trim();
  if (note) return note;
  const kind = String(item?.kind || item?.type || "profit");
  if (kind === "wallet_credit") return WorkerI18n.t("wallet.typeWalletCredit");
  if (kind === "transfer_in") return WorkerI18n.t("wallet.typeTransferCredit");
  return WorkerI18n.t("wallet.typeProfit");
}

function walletPaginationPages(page, pageCount) {
  const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  if (pageCount <= 5) return pages;
  return pages.filter(
    (value) => value === 1 || value === pageCount || Math.abs(value - current) <= 1
  );
}

function renderWalletHistoryPagination(meta) {
  const pageIndex = Number(meta?.page || 0);
  const pageCount = Math.max(1, Number(meta?.pageCount || 1));
  if (pageCount <= 1) return "";
  const page = pageIndex + 1;
  const prevDisabled = page <= 1 ? " disabled" : "";
  const nextDisabled = page >= pageCount ? " disabled" : "";
  const pageInfo = WorkerI18n.t("dashboard.pageInfo", {
    page,
    total: pageCount,
  });
  const visiblePages = walletPaginationPages(page, pageCount);
  const pageButtons = visiblePages
    .map((value, index) => {
      const prev = visiblePages[index - 1];
      const gap = prev != null && value - prev > 1
        ? `<span class="wallet-history-pagination__gap">…</span>`
        : "";
      const active = value === page ? " is-active" : "";
      const current = value === page ? ' aria-current="page"' : "";
      return `<span class="wallet-history-pagination__page-wrap">${gap}<button type="button" class="wallet-history-pagination__page${active}" data-wallet-page="${value - 1}"${current}>${value}</button></span>`;
    })
    .join("");
  return `
    <nav class="wallet-history-pagination" aria-label="${walletEscape(WorkerI18n.t("wallet.historyPagination"))}">
      <button type="button" class="wallet-history-pagination__arrow" data-wallet-page="${pageIndex - 1}"${prevDisabled} aria-label="${walletEscape(WorkerI18n.t("dashboard.pagePrev"))}">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6 9 12l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${walletEscape(WorkerI18n.t("dashboard.pagePrev"))}</span>
      </button>
      <div class="wallet-history-pagination__center">
        <div class="wallet-history-pagination__pages" aria-hidden="true">${pageButtons}</div>
        <span class="wallet-history-pagination__info">${walletEscape(pageInfo)}</span>
      </div>
      <button type="button" class="wallet-history-pagination__arrow" data-wallet-page="${pageIndex + 1}"${nextDisabled} aria-label="${walletEscape(WorkerI18n.t("dashboard.pageNext"))}">
        <span>${walletEscape(WorkerI18n.t("dashboard.pageNext"))}</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </nav>`;
}

function renderWalletHistory(items, tab, meta) {
  if (!items?.length) return walletEmptyState(tab);

  const isProfits = tab === "profits";
  const isTransfers = tab === "transfers";
  const desktopRows = items
    .map((item) => {
      if (isProfits) {
        return `
          <tr>
            <td class="muted">${walletEscape(WorkerFormat.date(item.createdAt))}</td>
            <td>${renderWalletSourceId(item)}</td>
            <td><span class="badge type">${walletEscape(profitTypeLabel(item))}</span></td>
            <td class="td-num wallet-history-amount is-positive">+${walletEscape(
              WorkerFormat.money(item.amountUsd || 0)
            )}</td>
          </tr>`;
      }
      if (isTransfers) {
        const outgoing = item.direction === "out";
        return `
          <tr>
            <td class="muted">${walletEscape(WorkerFormat.date(item.createdAt))}</td>
            <td><span class="badge type">${walletEscape(
              WorkerI18n.t(outgoing ? "wallet.typeTransferOut" : "wallet.typeTransferIn")
            )}</span></td>
            <td>${walletEscape(transferPeerLabel(item))}</td>
            <td class="td-num wallet-history-amount${outgoing ? "" : " is-positive"}">${outgoing ? "−" : "+"}${walletEscape(
              WorkerFormat.money(item.amountUsd || 0)
            )}</td>
          </tr>`;
      }
      return `
        <tr>
          <td class="muted">${walletEscape(WorkerFormat.date(item.createdAt))}</td>
          <td><span class="badge type">${walletEscape(item.method || "—")}</span></td>
          <td class="wallet-addr-cell">${
            isLinkPayoutMethod(item.method) && !(item.walletAddress || item.address)
              ? `<span class="muted">—</span>`
              : renderWalletAddress(item.walletAddress || item.address || "")
          }</td>
          <td class="td-num wallet-history-amount">−${walletEscape(
            WorkerFormat.money(item.amountUsd || 0)
          )}</td>
          <td><span class="badge wallet-status ${walletStatusClass(item.status)}">${walletEscape(
            walletStatusLabel(item.status)
          )}</span></td>
          <td>${walletPayoutActionCell(item)}</td>
        </tr>`;
    })
    .join("");

  const mobileCards = items
    .map((item) => {
      if (isTransfers) {
        const outgoing = item.direction === "out";
        return `
          <article class="wallet-history-card">
            <div class="wallet-history-card-head">
              <span class="wallet-history-date">${walletEscape(
                WorkerFormat.date(item.createdAt)
              )}</span>
              <span class="badge type">${walletEscape(
                WorkerI18n.t(outgoing ? "wallet.typeTransferOut" : "wallet.typeTransferIn")
              )}</span>
            </div>
            <div class="wallet-history-card-main">
              <div>
                <span class="wallet-history-card-label">${walletEscape(
                  WorkerI18n.t("wallet.historyPeer")
                )}</span>
                <strong>${walletEscape(transferPeerLabel(item))}</strong>
              </div>
              <strong class="wallet-history-card-amount${outgoing ? "" : " is-positive"}">${outgoing ? "−" : "+"}${walletEscape(
                WorkerFormat.money(item.amountUsd || 0)
              )}</strong>
            </div>
          </article>`;
      }
      const status = isProfits
        ? `<span class="badge type">${walletEscape(profitTypeLabel(item))}</span>`
        : `<span class="badge wallet-status ${walletStatusClass(item.status)}">${walletEscape(
            walletStatusLabel(item.status)
          )}</span>`;
      const amountPrefix = isProfits ? "+" : "−";
      return `
        <article class="wallet-history-card">
          <div class="wallet-history-card-head">
            <span class="wallet-history-date">${walletEscape(
              WorkerFormat.date(item.createdAt)
            )}</span>
            ${status}
          </div>
          <div class="wallet-history-card-main">
            <div>
              ${
                isProfits
                  ? `<span class="wallet-history-card-label">${walletEscape(
                      WorkerI18n.t("wallet.historyLogId")
                    )}</span>
                    <strong>${renderWalletSourceId(item)}</strong>
                    <span class="wallet-history-card-label">${walletEscape(
                      WorkerI18n.t("wallet.historyType")
                    )}</span>
                    <strong>${walletEscape(profitTypeLabel(item))}</strong>`
                  : `<span class="wallet-history-card-label">${walletEscape(
                      WorkerI18n.t("wallet.withdrawMethodLabel")
                    )}</span>
                    <strong>${walletEscape(item.method || "—")}</strong>`
              }
            </div>
            <strong class="wallet-history-card-amount${isProfits ? " is-positive" : ""}">${amountPrefix}${walletEscape(
              WorkerFormat.money(item.amountUsd || 0)
            )}</strong>
          </div>
          ${
            isProfits
              ? ""
              : isLinkPayoutMethod(item.method) && !(item.walletAddress || item.address)
                ? ""
                : `<div class="wallet-history-card-address">
                  <span>${walletEscape(WorkerI18n.t("wallet.historyWallet"))}</span>
                  ${renderWalletAddress(item.walletAddress || item.address || "")}
                </div>`
          }
          ${isProfits ? "" : walletPayoutAction(item)}
        </article>`;
    })
    .join("");

  return `
    <div class="wallet-history-table table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>${walletEscape(WorkerI18n.t("wallet.historyDate"))}</th>
            ${isProfits ? `<th>${walletEscape(WorkerI18n.t("wallet.historyLogId"))}</th>` : ""}
            <th>${walletEscape(WorkerI18n.t("wallet.historyType"))}</th>
            ${
              isProfits
                ? ""
                : isTransfers
                  ? `<th>${walletEscape(WorkerI18n.t("wallet.historyPeer"))}</th>`
                  : `<th>${walletEscape(WorkerI18n.t("wallet.historyWallet"))}</th>`
            }
            <th class="col-num">${walletEscape(WorkerI18n.t("wallet.historyAmount"))}</th>
            ${isProfits || isTransfers ? "" : `<th>${walletEscape(WorkerI18n.t("wallet.historyStatus"))}</th><th>${walletEscape(WorkerI18n.t("common.action") || "Действие")}</th>`}
          </tr>
        </thead>
        <tbody>${desktopRows}</tbody>
      </table>
    </div>
    <div class="wallet-history-mobile">${mobileCards}</div>
    ${renderWalletHistoryPagination(meta)}`;
}

function walletLoadingState() {
  return `
    <div class="wallet-history-loading" aria-label="${walletEscape(
      WorkerI18n.t("common.loading")
    )}">
      ${Array.from({ length: 3 }, () => '<div class="wallet-history-skeleton"></div>').join("")}
    </div>`;
}

function walletErrorState(message, retryId) {
  return `
    <div class="wallet-error-state">
      <span class="wallet-empty-icon is-error" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5.2M12 15.8h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </span>
      <strong>${walletEscape(WorkerI18n.t("wallet.loadErrorTitle"))}</strong>
      <span>${walletEscape(message)}</span>
      <button type="button" class="btn btn-ghost" id="${retryId}">${walletEscape(
        WorkerI18n.t("common.retry")
      )}</button>
    </div>`;
}

async function loadWalletData({ force = false } = {}) {
  return (await WorkerAPI.get("/wallet", { force })) || {};
}

async function loadWalletHistory(tab, { force = false, page = 0 } = {}) {
  const response = await WorkerAPI.get(
    `/wallet/history?tab=${encodeURIComponent(tab)}&page=${encodeURIComponent(page)}&limit=${WALLET_HISTORY_PAGE_SIZE}`,
    { force }
  );
  return {
    items: response?.items || [],
    page: Number(response?.page || 0),
    pageCount: Math.max(1, Number(response?.pageCount || 1)),
    total: Number(response?.total || 0),
  };
}

WorkerViews.wallet = async function renderWallet(ctx) {
  const { main, refresh } = ctx;
  const state = WorkerViews.walletState;
  const initialTab = state.tab || "profits";
  let wallet = null;
  let methodDropdown = null;
  let requisiteDropdown = null;
  let minWithdrawalUsd = 1;
  let methods = [];
  let payoutRequisites = [];
  let userPayoutMethod = "";
  let userPayoutAddress = "";

  main.innerHTML = `
    <header class="page-head wallet-page-head">
      <div>
        <h1 class="page-greeting">${walletEscape(WorkerI18n.t("wallet.pageTitle"))}</h1>
        <p class="page-sub muted">${walletEscape(WorkerI18n.t("wallet.subtitle"))}</p>
      </div>
    </header>

    <section class="wallet-hero" id="walletBalanceSection" aria-labelledby="walletBalanceTitle">
      <div class="wallet-total">
        <span class="wallet-balance-kicker" id="walletBalanceTitle">${walletEscape(
          WorkerI18n.t("wallet.totalBalanceLabel")
        )}</span>
        <strong class="wallet-total-value" id="walletTotalValue">—</strong>
        <span class="wallet-balance-caption">${walletEscape(
          WorkerI18n.t("wallet.totalBalanceHint")
        )}</span>
      </div>
      <div class="wallet-available">
        <span class="wallet-available-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 7.5h14v11H5v-11Z" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.5V5h8v2.5M15.5 12.5H19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </span>
        <span class="wallet-available-copy">
          <small>${walletEscape(WorkerI18n.t("wallet.availableBalanceLabel"))}</small>
          <strong id="walletAvailableValue">—</strong>
          <span id="walletReservedValue">${walletEscape(WorkerI18n.t("common.loading"))}</span>
          <span id="walletFrozenValue" hidden></span>
        </span>
      </div>
      <div class="wallet-hero-action">
        <div class="wallet-hero-buttons">
          <button type="button" class="btn btn-primary wallet-withdraw-btn" id="walletWithdrawOpen" disabled>
            ${walletEscape(WorkerI18n.t("wallet.withdrawBtn"))}
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="btn btn-ghost wallet-transfer-btn" id="walletTransferOpen" disabled>
            ${walletEscape(WorkerI18n.t("wallet.transferBtn"))}
          </button>
        </div>
        <span id="walletMinimumSummary">${walletEscape(WorkerI18n.t("common.loading"))}</span>
      </div>
    </section>

    <section class="section wallet-payout-section">
      <div class="wallet-section-heading">
        <div>
          <h2 class="section-title">${walletEscape(WorkerI18n.t("wallet.payoutDetails"))}</h2>
          <p class="muted">${walletEscape(WorkerI18n.t("wallet.payoutDetailsHint"))}</p>
        </div>
        <button type="button" class="btn btn-ghost wallet-settings-link" id="walletPayoutSettings">${walletEscape(
          WorkerI18n.t("wallet.editPayout")
        )}</button>
      </div>
      <div class="wallet-payout-grid" id="walletPayoutList">
        <div class="wallet-payout-item">
          <span>${walletEscape(WorkerI18n.t("wallet.withdrawMethodLabel"))}</span>
          <strong id="walletPayoutMethod">${walletEscape(WorkerI18n.t("common.loading"))}</strong>
        </div>
        <div class="wallet-payout-item">
          <span>${walletEscape(WorkerI18n.t("wallet.withdrawAddressLabel"))}</span>
          <div id="walletPayoutAddress"><strong class="muted">${walletEscape(
            WorkerI18n.t("common.loading")
          )}</strong></div>
        </div>
      </div>
    </section>

    <section class="section wallet-history-section">
      <div class="wallet-history-head">
        <div>
          <h2 class="section-title">${walletEscape(WorkerI18n.t("wallet.historyTitle"))}</h2>
          <p class="muted">${walletEscape(WorkerI18n.t("wallet.historySubtitle"))}</p>
        </div>
        <div class="link-segments wallet-history-tabs" id="walletHistoryTabs" role="tablist">
          <button type="button" class="link-segment" data-wallet-tab="profits" role="tab">${walletEscape(
            WorkerI18n.t("wallet.tabProfits")
          )}</button>
          <button type="button" class="link-segment" data-wallet-tab="withdrawals" role="tab">${walletEscape(
            WorkerI18n.t("wallet.tabWithdrawals")
          )}</button>
          <button type="button" class="link-segment" data-wallet-tab="transfers" role="tab">${walletEscape(
            WorkerI18n.t("wallet.tabTransfers")
          )}</button>
        </div>
      </div>
      <div id="walletHistoryWrap" aria-live="polite">${walletLoadingState()}</div>
    </section>

    <dialog class="sites-dialog wallet-withdraw-dialog" id="walletWithdrawDialog">
      <form method="dialog" class="sites-dialog-body wallet-withdraw-form" id="walletWithdrawForm" novalidate>
        <div class="wallet-withdraw-head">
          <span class="wallet-available-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7.5h14v11H5v-11Z" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.5V5h8v2.5M15.5 12.5H19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </span>
          <div>
            <h3 class="sites-dialog-title">${walletEscape(
              WorkerI18n.t("wallet.withdrawDialogTitle")
            )}</h3>
            <p class="muted">${walletEscape(WorkerI18n.t("wallet.withdrawDialogText"))}</p>
          </div>
        </div>

        <div class="wallet-withdraw-balance">
          <span>${walletEscape(WorkerI18n.t("wallet.availableBalanceLabel"))}</span>
          <strong id="walletDialogAvailable">—</strong>
        </div>

        <div class="settings-field">
          <label class="settings-label" for="walletWithdrawAmount">${walletEscape(
            WorkerI18n.t("wallet.withdrawAmountLabel")
          )}</label>
          <div class="wallet-amount-input wallet-amount-field">
            <input class="input" id="walletWithdrawAmount" type="number" min="1" step="0.01" inputmode="decimal" placeholder="1.00" />
            <button type="button" id="walletWithdrawUseMax">${walletEscape(WorkerI18n.t("wallet.useMaximum"))}</button>
          </div>
          <div class="settings-hint" id="walletWithdrawMinHint"></div>
        </div>

        <div class="settings-field">
          <label class="settings-label">${walletEscape(WorkerI18n.t("wallet.savedRequisites"))}</label>
          <div id="walletWithdrawRequisiteSelect" class="custom-select-host"></div>
        </div>

        <div class="settings-field">
          <label class="settings-label">${walletEscape(
            WorkerI18n.t("wallet.withdrawMethodLabel")
          )}</label>
          <div id="walletWithdrawMethodSelect" class="custom-select-host"></div>
        </div>

        <div class="settings-field" id="walletWithdrawAddressField">
          <label class="settings-label" for="walletWithdrawAddress">${walletEscape(
            WorkerI18n.t("wallet.withdrawAddressLabel")
          )}</label>
          <input class="input" id="walletWithdrawAddress" placeholder="${walletEscape(
            WorkerI18n.t("wallet.withdrawAddressPlaceholder")
          )}" autocomplete="off" spellcheck="false" />
          <div class="settings-hint">${walletEscape(
            WorkerI18n.t("wallet.withdrawAddressHint")
          )}</div>
        </div>

        <div class="wallet-withdraw-preview" id="walletWithdrawPreview" hidden></div>
        <div class="inline-alert wallet-withdraw-error" id="walletWithdrawError" role="alert" hidden></div>

        <div class="sites-dialog-actions wallet-withdraw-actions">
          <button type="button" class="btn btn-ghost" id="walletWithdrawCancel">${walletEscape(
            WorkerI18n.t("wallet.cancel")
          )}</button>
          <button type="submit" class="btn btn-primary" id="walletWithdrawSubmit">${walletEscape(
            WorkerI18n.t("wallet.submit")
          )}</button>
        </div>
      </form>
    </dialog>

    <dialog class="sites-dialog wallet-withdraw-dialog" id="walletTransferDialog">
      <form method="dialog" class="sites-dialog-body wallet-withdraw-form" id="walletTransferForm" novalidate>
        <div class="wallet-withdraw-head">
          <span class="wallet-available-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M7 8h10M7 12h6M4 6.5h16v11H4v-11Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14.5 15.5 17 13l2.5 2.5M17 13v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <div>
            <h3 class="sites-dialog-title">${walletEscape(
              WorkerI18n.t("wallet.transferDialogTitle")
            )}</h3>
            <p class="muted">${walletEscape(WorkerI18n.t("wallet.transferDialogText"))}</p>
          </div>
        </div>

        <div class="wallet-withdraw-balance">
          <span>${walletEscape(WorkerI18n.t("wallet.availableBalanceLabel"))}</span>
          <strong id="walletTransferDialogAvailable">—</strong>
        </div>

        <div id="walletTransferStepForm">
          <div class="settings-field">
            <label class="settings-label" for="walletTransferRecipient">${walletEscape(
              WorkerI18n.t("wallet.transferRecipientLabel")
            )}</label>
            <div class="wallet-transfer-recipient-row">
              <input class="input" id="walletTransferRecipient" type="text" autocomplete="off" spellcheck="false" placeholder="${walletEscape(
                WorkerI18n.t("wallet.transferRecipientPlaceholder")
              )}" />
              <button type="button" class="btn btn-ghost" id="walletTransferLookup">${walletEscape(
                WorkerI18n.t("wallet.transferLookupBtn")
              )}</button>
            </div>
            <div class="settings-hint">${walletEscape(
              WorkerI18n.t("wallet.transferRecipientHint")
            )}</div>
            <div class="wallet-transfer-recipient-found" id="walletTransferRecipientFound" hidden></div>
          </div>

          <div class="settings-field">
            <label class="settings-label" for="walletTransferAmount">${walletEscape(
              WorkerI18n.t("wallet.transferAmountLabel")
            )}</label>
            <div class="wallet-amount-input">
              <input class="input" id="walletTransferAmount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="10.00" />
              <span>USD</span>
            </div>
          </div>
        </div>

        <div class="wallet-withdraw-preview" id="walletTransferConfirmPreview" hidden></div>
        <div class="inline-alert wallet-withdraw-error" id="walletTransferError" role="alert" hidden></div>

        <div class="sites-dialog-actions wallet-withdraw-actions">
          <button type="button" class="btn btn-ghost" id="walletTransferCancel">${walletEscape(
            WorkerI18n.t("wallet.cancel")
          )}</button>
          <button type="button" class="btn btn-ghost" id="walletTransferBack" hidden>${walletEscape(
            WorkerI18n.t("wallet.transferBack")
          )}</button>
          <button type="submit" class="btn btn-primary" id="walletTransferSubmit">${walletEscape(
            WorkerI18n.t("wallet.transferContinue")
          )}</button>
        </div>
      </form>
    </dialog>`;

  const historyWrap = document.getElementById("walletHistoryWrap");
  const historyTabs = document.getElementById("walletHistoryTabs");
  const withdrawButton = document.getElementById("walletWithdrawOpen");
  const transferButton = document.getElementById("walletTransferOpen");
  const dialog = document.getElementById("walletWithdrawDialog");
  const form = document.getElementById("walletWithdrawForm");
  const amountInput = document.getElementById("walletWithdrawAmount");
  const addressInput = document.getElementById("walletWithdrawAddress");
  const errorBox = document.getElementById("walletWithdrawError");
  const preview = document.getElementById("walletWithdrawPreview");
  const submitButton = document.getElementById("walletWithdrawSubmit");
  const transferDialog = document.getElementById("walletTransferDialog");
  const transferForm = document.getElementById("walletTransferForm");
  const transferRecipientInput = document.getElementById("walletTransferRecipient");
  const transferAmountInput = document.getElementById("walletTransferAmount");
  const transferErrorBox = document.getElementById("walletTransferError");
  const transferSubmitButton = document.getElementById("walletTransferSubmit");
  const transferBackButton = document.getElementById("walletTransferBack");
  const transferCancelButton = document.getElementById("walletTransferCancel");
  const transferLookupButton = document.getElementById("walletTransferLookup");
  const transferStepForm = document.getElementById("walletTransferStepForm");
  const transferConfirmPreview = document.getElementById("walletTransferConfirmPreview");
  const transferRecipientFound = document.getElementById("walletTransferRecipientFound");
  let transferRecipient = null;
  let transferConfirmStep = false;
  document.getElementById("walletPayoutSettings")?.addEventListener("click", () => {
    WorkerViews.settingsTab = "payouts";
    document.querySelector('.nav-item[data-view="settings"]')?.click();
  });

  function friendlyError(error) {
    return (
      (window.WorkerToast && WorkerToast.friendlyError(error)) ||
      error?.message ||
      WorkerI18n.t("common.error")
    );
  }

  function setActiveTab(tab) {
    state.tab = tab;
    historyTabs.querySelectorAll("[data-wallet-tab]").forEach((button) => {
      const active = button.dataset.walletTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  async function hydrateHistory(tab, { force = false, page } = {}) {
    const nextPage = Number.isFinite(Number(page)) ? Math.max(0, Number(page)) : (state.tab === tab ? state.historyPage || 0 : 0);
    setActiveTab(tab);
    state.historyPage = nextPage;
    historyWrap.innerHTML = walletLoadingState();
    historyTabs.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    try {
      const result = await loadWalletHistory(tab, { force, page: nextPage });
      if (state.tab !== tab) return;
      state.history = result.items;
      state.historyPage = result.page;
      state.historyPageCount = result.pageCount;
      state.historyTotal = result.total;
      historyWrap.innerHTML = renderWalletHistory(result.items, tab, result);
      if (tab === "withdrawals") bindWalletAddressCopy(historyWrap);
      historyWrap.querySelectorAll("[data-wallet-page]").forEach((button) => {
        button.addEventListener("click", () => {
          if (button.disabled) return;
          hydrateHistory(tab, { force: true, page: Number(button.dataset.walletPage) });
        });
      });
    } catch (error) {
      if (window.WorkerToast) WorkerToast.error(error);
      historyWrap.innerHTML = walletErrorState(friendlyError(error), "walletHistoryRetry");
      document.getElementById("walletHistoryRetry")?.addEventListener("click", () =>
        hydrateHistory(tab, { force: true, page: nextPage })
      );
    } finally {
      historyTabs.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  }

  function renderBalance() {
    const totalUsd = Number(wallet?.walletUsd ?? wallet?.user?.walletUsd ?? 0);
    const availableUsd = Number(wallet?.availableUsd || 0);
    const frozenSaleUsd = Math.max(
      0,
      Number(wallet?.frozenSaleUsd ?? wallet?.user?.frozenSaleUsd ?? 0)
    );
    const reservedWithdrawalUsd = Math.max(
      0,
      Number(wallet?.reservedWithdrawalUsd ?? wallet?.user?.reservedWithdrawalUsd ?? 0)
    );
    document.getElementById("walletTotalValue").textContent = WorkerFormat.money(totalUsd);
    document.getElementById("walletAvailableValue").textContent = WorkerFormat.money(availableUsd);
    document.getElementById("walletDialogAvailable").textContent =
      WorkerFormat.money(availableUsd);
    document.getElementById("walletTransferDialogAvailable").textContent =
      WorkerFormat.money(availableUsd);
    document.getElementById("walletReservedValue").textContent = WorkerI18n.t(
      "wallet.reservedSummary",
      { amount: WorkerFormat.money(reservedWithdrawalUsd) }
    );
    const frozenEl = document.getElementById("walletFrozenValue");
    if (frozenEl) {
      if (frozenSaleUsd > 0) {
        frozenEl.hidden = false;
        frozenEl.textContent = WorkerI18n.t("wallet.frozenSummary", {
          amount: WorkerFormat.money(frozenSaleUsd),
        });
      } else {
        frozenEl.hidden = true;
        frozenEl.textContent = "";
      }
    }
    document.getElementById("walletMinimumSummary").textContent = WorkerI18n.t(
      "wallet.minimumSummary",
      { amount: WorkerFormat.money(minWithdrawalUsd) }
    );
    document.getElementById("walletWithdrawMinHint").textContent = WorkerI18n.t(
      "wallet.minimumHint",
      { amount: WorkerFormat.money(minWithdrawalUsd) }
    );
    amountInput.min = String(minWithdrawalUsd);
    amountInput.max = String(availableUsd);
    transferAmountInput.min = "0.01";
    transferAmountInput.max = String(availableUsd);
    withdrawButton.disabled = availableUsd < minWithdrawalUsd;
    withdrawButton.title = withdrawButton.disabled
      ? WorkerI18n.t("wallet.insufficientAvailable")
      : "";
    transferButton.disabled = availableUsd < 0.01;
    transferButton.title = transferButton.disabled
      ? WorkerI18n.t("wallet.insufficientTransfer")
      : "";
  }

  function renderPayoutDetails() {
    const host = document.getElementById("walletPayoutList");
    if (!host) return;
    if (!payoutRequisites.length) {
      host.innerHTML = `
        <div class="wallet-payout-item">
          <span>${walletEscape(WorkerI18n.t("wallet.payoutDetails"))}</span>
          <strong class="muted">${walletEscape(WorkerI18n.t("wallet.addressNotSet"))}</strong>
        </div>`;
      return;
    }
    host.innerHTML = payoutRequisites
      .map((row) => {
        const method = methods.find((item) => String(item.id) === String(row.method));
        const addressBlock = isLinkPayoutMethod(row.method)
          ? `<strong class="muted">${walletEscape(WorkerI18n.t("wallet.linkPayoutHint") || "Чек в Telegram")}</strong>`
          : `<div>${renderWalletAddress(row.address)}</div>`;
        return `
          <div class="wallet-payout-item">
            <span>${walletEscape(method?.label || row.method || WorkerI18n.t("wallet.methodNotSelected"))}</span>
            ${addressBlock}
          </div>`;
      })
      .join("");
    bindWalletAddressCopy(host);
  }

  function applyRequisite(id) {
    if (id === "__custom__") return;
    const row = payoutRequisites.find((item) => String(item.id) === String(id));
    if (!row) return;
    userPayoutMethod = row.method;
    userPayoutAddress = row.address;
    addressInput.value = row.address;
    methodDropdown?.setValue?.(row.method);
    syncAddressFieldVisibility();
    updatePreview();
  }

  function mountRequisiteDropdown() {
    const host = document.getElementById("walletWithdrawRequisiteSelect");
    if (!host) return;
    host.innerHTML = "";
    const options = [
      ...payoutRequisites.map((row) => {
        const method = methods.find((item) => String(item.id) === String(row.method));
        const address = String(row.address || "");
        const shortAddress =
          address.length > 12 ? `${address.slice(0, 8)}…` : address;
        const label = isLinkPayoutMethod(row.method)
          ? `${method?.label || row.method}`
          : `${method?.label || row.method} · ${shortAddress}`;
        return { value: row.id, label };
      }),
      { value: "__custom__", label: WorkerI18n.t("wallet.requisiteCustom") },
    ];
    const initial = payoutRequisites[0]?.id || "__custom__";
    requisiteDropdown = WorkerDropdown.mount(host, {
      value: initial,
      ariaLabel: WorkerI18n.t("wallet.savedRequisites"),
      options,
      onChange: (value) => {
        clearError();
        applyRequisite(value);
      },
    });
  }

  function mountMethodDropdown() {
    const host = document.getElementById("walletWithdrawMethodSelect");
    host.innerHTML = "";
    methodDropdown = WorkerDropdown.mount(host, {
      value: userPayoutMethod,
      ariaLabel: WorkerI18n.t("wallet.withdrawMethodLabel"),
      options: [
        { value: "", label: WorkerI18n.t("wallet.methodNotSelected") },
        ...methods.map((method) => ({
          value: method.id,
          label: `${method.label} · ${WorkerI18n.t("wallet.feeLabel", {
            amount: WorkerFormat.money(method.feeUsd || 0),
          })}`,
        })),
      ],
      onChange: () => {
        clearError();
        syncAddressFieldVisibility();
        updatePreview();
      },
    });
  }

  function syncAddressFieldVisibility() {
    const field = document.getElementById("walletWithdrawAddressField");
    const method = String(methodDropdown?.getValue?.() || "").trim();
    const linkPayout = isLinkPayoutMethod(method);
    const nickPayout = isNickPayoutMethod(method, methods);
    if (field) field.hidden = linkPayout;
    if (linkPayout) {
      addressInput.value = "";
      addressInput.removeAttribute("aria-invalid");
    }
    const label = field?.querySelector("label");
    const hint = field?.querySelector(".settings-hint");
    if (label) {
      label.textContent = nickPayout
        ? WorkerI18n.t("wallet.withdrawNickLabel")
        : WorkerI18n.t("wallet.withdrawAddressLabel");
    }
    if (addressInput) {
      addressInput.placeholder = nickPayout
        ? WorkerI18n.t("wallet.withdrawNickPlaceholder")
        : WorkerI18n.t("wallet.withdrawAddressPlaceholder");
    }
    if (hint) {
      hint.textContent = nickPayout
        ? WorkerI18n.t("wallet.withdrawNickHint")
        : WorkerI18n.t("wallet.withdrawAddressHint");
    }
  }

  async function hydrateWallet({ force = false } = {}) {
    withdrawButton.disabled = true;
    transferButton.disabled = true;
    try {
      wallet = await loadWalletData({ force });
      state.wallet = wallet;
      minWithdrawalUsd = Number(wallet.minWithdrawalUsd || 1);
      methods = Array.isArray(wallet.methods) ? wallet.methods : [];
      userPayoutMethod = wallet.user?.payoutMethod || "";
      userPayoutAddress = wallet.user?.payoutAddress || "";
      payoutRequisites = Array.isArray(wallet.user?.payoutRequisites)
        ? wallet.user.payoutRequisites
        : [];
      if (!payoutRequisites.length && userPayoutMethod && userPayoutAddress) {
        payoutRequisites = [{ id: "legacy", method: userPayoutMethod, address: userPayoutAddress }];
      }
      renderBalance();
      renderPayoutDetails();
      mountRequisiteDropdown();
      mountMethodDropdown();
      syncAddressFieldVisibility();
    } catch (error) {
      if (window.WorkerToast) WorkerToast.error(error);
      const section = document.getElementById("walletBalanceSection");
      section.innerHTML = walletErrorState(friendlyError(error), "walletBalanceRetry");
      document.getElementById("walletBalanceRetry")?.addEventListener("click", () => {
        WorkerViews.wallet({ ...ctx, refresh: true });
      });
    }
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
    amountInput.removeAttribute("aria-invalid");
    addressInput.removeAttribute("aria-invalid");
    document.getElementById("walletWithdrawMethodSelect")?.removeAttribute("aria-invalid");
  }

  function showError(message, field) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    field?.setAttribute("aria-invalid", "true");
    field?.focus?.();
  }

  function clearTransferError() {
    transferErrorBox.hidden = true;
    transferErrorBox.textContent = "";
    transferRecipientInput.removeAttribute("aria-invalid");
    transferAmountInput.removeAttribute("aria-invalid");
  }

  function showTransferError(message, field) {
    transferErrorBox.textContent = message;
    transferErrorBox.hidden = false;
    field?.setAttribute("aria-invalid", "true");
    field?.focus?.();
  }

  function resetTransferDialog() {
    transferConfirmStep = false;
    transferRecipient = null;
    transferRecipientInput.value = "";
    transferAmountInput.value = "";
    transferRecipientFound.hidden = true;
    transferRecipientFound.textContent = "";
    transferConfirmPreview.hidden = true;
    transferConfirmPreview.innerHTML = "";
    transferStepForm.hidden = false;
    transferBackButton.hidden = true;
    transferCancelButton.hidden = false;
    transferSubmitButton.textContent = WorkerI18n.t("wallet.transferContinue");
    clearTransferError();
  }

  function showTransferRecipient(recipient) {
    transferRecipient = recipient;
    transferRecipientFound.hidden = false;
    transferRecipientFound.textContent = `${WorkerI18n.t("wallet.transferRecipientFound")}: ${
      recipient.displayName || recipient.username || recipient.telegramId
    }`;
  }

  async function lookupTransferRecipient() {
    clearTransferError();
    const query = String(transferRecipientInput.value || "").trim();
    if (!query) {
      showTransferError(WorkerI18n.t("wallet.errorRecipient"), transferRecipientInput);
      return null;
    }
    transferLookupButton.disabled = true;
    try {
      const response = await WorkerAPI.get(
        `/wallet/transfer/lookup?q=${encodeURIComponent(query)}`,
        { force: true }
      );
      const recipient = response?.recipient;
      if (!recipient) {
        showTransferError(WorkerI18n.t("wallet.errorRecipientNotFound"), transferRecipientInput);
        return null;
      }
      showTransferRecipient(recipient);
      return recipient;
    } catch (error) {
      transferRecipient = null;
      transferRecipientFound.hidden = true;
      showTransferError(friendlyError(error), transferRecipientInput);
      return null;
    } finally {
      transferLookupButton.disabled = false;
    }
  }

  function enterTransferConfirmStep() {
    transferConfirmStep = true;
    transferStepForm.hidden = true;
    transferCancelButton.hidden = true;
    transferBackButton.hidden = false;
    transferSubmitButton.textContent = WorkerI18n.t("wallet.transferConfirm");
    const amountUsd = Number(transferAmountInput.value);
    transferConfirmPreview.hidden = false;
    transferConfirmPreview.innerHTML = `
      <span><small>${walletEscape(WorkerI18n.t("wallet.transferPreviewTo"))}</small><strong>${walletEscape(
        transferRecipient.displayName || transferRecipient.telegramId
      )}</strong></span>
      <span><small>${walletEscape(
        WorkerI18n.t("wallet.transferPreviewAmount")
      )}</small><strong>${walletEscape(WorkerFormat.money(amountUsd))}</strong></span>
      <p class="wallet-transfer-confirm-hint">${walletEscape(
        WorkerI18n.t("wallet.transferConfirmHint")
      )}</p>`;
  }

  function currentFeeUsd() {
    const selected = methodDropdown?.getValue?.() || "";
    const method = methods.find((item) => String(item.id) === String(selected));
    return Number(method?.feeUsd || 0);
  }

  function updatePreview() {
    const amountUsd = Number(amountInput.value);
    const method = methodDropdown?.getValue?.() || "";
    if (!amountInput.value || !method || !Number.isFinite(amountUsd)) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }
    const feeUsd = currentFeeUsd();
    const payoutUsd = Math.max(0, amountUsd - feeUsd);
    preview.hidden = false;
    preview.innerHTML = `
      <span><small>${walletEscape(WorkerI18n.t("wallet.fee"))}</small><strong>${walletEscape(
        WorkerFormat.money(feeUsd)
      )}</strong></span>
      <span><small>${walletEscape(WorkerI18n.t("wallet.toReceive"))}</small><strong>${walletEscape(
        WorkerFormat.money(payoutUsd)
      )}</strong></span>`;
  }

  historyTabs.querySelectorAll("[data-wallet-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.walletTab;
      if (tab === state.tab) return;
      hydrateHistory(tab);
    });
  });

  amountInput.addEventListener("input", () => {
    clearError();
    updatePreview();
  });
  addressInput.addEventListener("input", clearError);
  document.getElementById("walletWithdrawUseMax")?.addEventListener("click", () => {
    clearError();
    const availableUsd = Number(wallet?.availableUsd || 0);
    amountInput.value = availableUsd >= minWithdrawalUsd ? availableUsd.toFixed(2) : "";
    updatePreview();
    amountInput.focus();
  });

  withdrawButton.addEventListener("click", () => {
    if (!wallet) return;
    clearError();
    amountInput.value = "";
    addressInput.value = userPayoutAddress;
    methodDropdown?.setValue?.(userPayoutMethod);
    requisiteDropdown?.setValue?.(payoutRequisites[0]?.id || "__custom__");
    syncAddressFieldVisibility();
    updatePreview();
    dialog.showModal();
    window.setTimeout(() => amountInput.focus(), 0);
  });

  document.getElementById("walletWithdrawCancel").addEventListener("click", () => {
    dialog.close();
  });

  transferButton.addEventListener("click", () => {
    if (!wallet) return;
    resetTransferDialog();
    document.getElementById("walletTransferDialogAvailable").textContent = WorkerFormat.money(
      Number(wallet?.availableUsd || 0)
    );
    transferDialog.showModal();
    window.setTimeout(() => transferRecipientInput.focus(), 0);
  });

  transferCancelButton.addEventListener("click", () => {
    transferDialog.close();
  });

  transferBackButton.addEventListener("click", () => {
    transferConfirmStep = false;
    transferStepForm.hidden = false;
    transferConfirmPreview.hidden = true;
    transferConfirmPreview.innerHTML = "";
    transferBackButton.hidden = true;
    transferCancelButton.hidden = false;
    transferSubmitButton.textContent = WorkerI18n.t("wallet.transferContinue");
    clearTransferError();
  });

  transferLookupButton.addEventListener("click", () => {
    lookupTransferRecipient();
  });

  transferRecipientInput.addEventListener("input", () => {
    clearTransferError();
    transferRecipient = null;
    transferRecipientFound.hidden = true;
    if (transferConfirmStep) transferBackButton.click();
  });

  transferAmountInput.addEventListener("input", () => {
    clearTransferError();
    if (transferConfirmStep) transferBackButton.click();
  });

  transferForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearTransferError();
    const amountUsd = Number(transferAmountInput.value);
    const availableUsd = Number(wallet?.availableUsd || 0);

    if (!transferConfirmStep) {
      if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
        return showTransferError(WorkerI18n.t("wallet.errorTransferAmount"), transferAmountInput);
      }
      if (amountUsd > availableUsd) {
        return showTransferError(
          WorkerI18n.t("wallet.errorTransferAvailable"),
          transferAmountInput
        );
      }
      const recipient =
        transferRecipient ||
        (await lookupTransferRecipient());
      if (!recipient) return;
      enterTransferConfirmStep();
      return;
    }

    transferSubmitButton.disabled = true;
    transferBackButton.disabled = true;
    transferSubmitButton.textContent = WorkerI18n.t("wallet.transferConfirming");
    try {
      await WorkerAPI.post("/wallet/transfer", {
        recipient: transferRecipientInput.value.trim(),
        amount: amountUsd,
      });
      transferDialog.close();
      if (window.WorkerToast) WorkerToast.success(WorkerI18n.t("wallet.transferSuccess"));
      await Promise.all([
        hydrateWallet({ force: true }),
        hydrateHistory("transfers", { force: true }),
      ]);
    } catch (error) {
      showTransferError(friendlyError(error));
    } finally {
      transferSubmitButton.disabled = false;
      transferBackButton.disabled = false;
      transferSubmitButton.textContent = transferConfirmStep
        ? WorkerI18n.t("wallet.transferConfirm")
        : WorkerI18n.t("wallet.transferContinue");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    const amountUsd = Number(amountInput.value);
    const availableUsd = Number(wallet?.availableUsd || 0);
    const method = String(methodDropdown?.getValue?.() || "").trim();
    const address = String(addressInput.value || "").trim();

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return showError(WorkerI18n.t("wallet.errorAmountInvalid"), amountInput);
    }
    if (amountUsd < minWithdrawalUsd) {
      return showError(
        WorkerI18n.t("wallet.errorAmountMinimum", {
          amount: WorkerFormat.money(minWithdrawalUsd),
        }),
        amountInput
      );
    }
    if (amountUsd > availableUsd) {
      return showError(WorkerI18n.t("wallet.errorAmountAvailable"), amountInput);
    }
    if (!method) {
      return showError(
        WorkerI18n.t("wallet.errorMethod"),
        document.getElementById("walletWithdrawMethodSelect")
      );
    }
    if (!isLinkPayoutMethod(method) && !address) {
      return showError(
        WorkerI18n.t(isNickPayoutMethod(method, methods) ? "wallet.errorNick" : "wallet.errorAddress"),
        addressInput
      );
    }

    submitButton.disabled = true;
    submitButton.textContent = WorkerI18n.t("wallet.submitting");
    try {
      await WorkerAPI.post("/wallet/withdraw", {
        amount: amountUsd,
        method,
        address: isLinkPayoutMethod(method) ? "" : address,
      });
      dialog.close();
      if (window.WorkerToast) WorkerToast.success(WorkerI18n.t("wallet.withdrawSuccess"));
      await Promise.all([
        hydrateWallet({ force: true }),
        hydrateHistory(state.tab, { force: true }),
      ]);
    } catch (error) {
      showError(friendlyError(error));
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = WorkerI18n.t("wallet.submit");
    }
  });

  setActiveTab(initialTab);
  await Promise.all([
    hydrateWallet({ force: !!refresh }),
    hydrateHistory(initialTab, { force: !!refresh }),
  ]);
};
