import { useEffect, useRef, useState } from "react";
import prefsUrl from "../../../panel/worker/js/prefs.js?url";
import i18nUrl from "../../../panel/worker/js/i18n.js?url";
import formatUrl from "../../../panel/worker/js/format.js?url";
import dropdownUrl from "../../../panel/worker/js/dropdown.js?url";
import walletUrl from "../../../panel/worker/js/views/wallet.js?url";
import "../../../panel/worker/css/worker.css";
import "../../../panel/worker/css/panel-extra.css";
import "./wallet-host.css";

const PREVIEW_WALLET = {
  walletUsd: 0,
  availableUsd: 0,
  reservedUsd: 0,
  reservedWithdrawalUsd: 0,
  frozenSaleUsd: 0,
  minWithdrawalUsd: 1,
  methods: [
    { id: "cryptobot", label: "CryptoBot", feeUsd: 0, linkPayout: true },
    { id: "ton_gram", label: "TON", feeUsd: 0, linkPayout: false },
    { id: "solana", label: "Solana", feeUsd: 0, linkPayout: false },
    { id: "usdt_trc20", label: "USDT TRC20", feeUsd: 1, linkPayout: false },
    { id: "lolz", label: "Lolz", feeUsd: 0, linkPayout: false, nicknamePayout: true },
  ],
  user: {
    payoutMethod: "",
    payoutAddress: "",
    payoutRequisites: [],
  },
};

const PREVIEW_HISTORY = {
  profits: Array.from({ length: 14 }, (_, i) => ({
    id: `p${i + 1}`,
    createdAt: `2026-08-${String(22 - (i % 10)).padStart(2, "0")}T19:20:00`,
    amountUsd: Number((12.5 + i * 1.1).toFixed(2)),
    type: "profit",
    kind: "profit",
    note: "",
    sourceId: String(58319 + i),
  })),
  withdrawals: Array.from({ length: 12 }, (_, i) => ({
    id: `w${i + 1}`,
    createdAt: `2026-08-${String(22 - (i % 10)).padStart(2, "0")}T22:20:00`,
    amountUsd: i % 2 ? 5 : 200,
    method: i % 2 ? "cryptobot" : "ton_gram",
    walletAddress: i % 2 ? "" : "UQA8mR2aPqL7nVw8YbHc3dEf4gHiJkLmNo123",
    status: "approved",
    payoutUrl: i % 2 ? "https://t.me/send?start=demo" : "https://tonviewer.com/demo",
    type: "withdrawal",
  })),
  transfers: [
    {
      id: "t1",
      createdAt: "2026-08-21T12:00:00",
      amountUsd: 15,
      direction: "out",
      peerTelegramId: "1001",
      peerUsername: "demo_peer",
      type: "transfer",
    },
    {
      id: "t2",
      createdAt: "2026-08-20T12:00:00",
      amountUsd: 8,
      direction: "in",
      peerTelegramId: "1002",
      peerUsername: "other_peer",
      type: "transfer",
    },
  ],
};

let runtimePromise: Promise<void> | null = null;

function loadClassicScript(src: string) {
  const existing = document.querySelector(`script[data-gwl-src="${src}"]`);
  if (existing) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.gwlSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function installPreviewWalletApi() {
  window.WorkerAPI = {
    async get(path: string) {
      const clean = String(path || "").split("?")[0];
      if (clean === "/wallet") return PREVIEW_WALLET;
      if (clean === "/wallet/history") {
        const params = new URLSearchParams(String(path).split("?")[1] || "");
        const tab = params.get("tab") || "profits";
        const page = Math.max(0, Number.parseInt(params.get("page") || "0", 10) || 0);
        const limit = Math.min(50, Math.max(1, Number(params.get("limit") || 10)));
        const all = PREVIEW_HISTORY[tab as keyof typeof PREVIEW_HISTORY] || [];
        const pageCount = Math.max(1, Math.ceil(all.length / limit) || 1);
        const pageIndex = Math.min(page, pageCount - 1);
        return {
          tab,
          items: all.slice(pageIndex * limit, pageIndex * limit + limit),
          page: pageIndex,
          pageCount,
          total: all.length,
          limit,
        };
      }
      if (clean === "/wallet/transfer/lookup") {
        return { found: false };
      }
      return {};
    },
    async post() {
      return { ok: true };
    },
    async patch() {
      return { ok: true };
    },
    async del() {
      return { ok: true };
    },
    bust() {},
  };

  if (!window.WorkerToast) {
    window.WorkerToast = {
      success(message) {
        console.info(message);
      },
      error(error) {
        console.error(error);
      },
      info(message) {
        console.info(message);
      },
      friendlyError(error) {
        return error instanceof Error ? error.message : String(error ?? "Ошибка");
      },
    };
  }
}

function ensurePanelWalletRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      installPreviewWalletApi();
      await loadClassicScript(prefsUrl);
      await loadClassicScript(i18nUrl);
      await loadClassicScript(formatUrl);
      await loadClassicScript(dropdownUrl);
      await loadClassicScript(walletUrl);
    })();
  }
  return runtimePromise;
}

/**
 * Thin host for the existing worker-panel wallet view (`panel/worker/js/views/wallet.js`).
 * Does not reimplement the page — only mounts the production renderer in preview.
 */
export default function WalletPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    (async () => {
      try {
        await ensurePanelWalletRuntime();
        if (cancelled) return;
        const render = window.WorkerViews?.wallet;
        if (typeof render !== "function") {
          throw new Error("WorkerViews.wallet is not available");
        }
        await render({
          main: host,
          user: {
            telegramId: "1029384756",
            username: "demo_operator",
            firstName: "Алекс",
          },
          refresh: true,
        });

        const settingsBtn = host.querySelector("#walletPayoutSettings");
        if (settingsBtn) {
          const next = settingsBtn.cloneNode(true) as HTMLButtonElement;
          settingsBtn.replaceWith(next);
          next.addEventListener("click", () => {
            const url = new URL(window.location.href);
            url.searchParams.set("view", "settings");
            window.location.href = url.toString();
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      host.replaceChildren();
    };
  }, []);

  return (
    <div className="gwl-host">
      {error ? <p className="gwl-host__error">{error}</p> : null}
      <div className="main" ref={hostRef} />
    </div>
  );
}
