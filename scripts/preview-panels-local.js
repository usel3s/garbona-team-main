/**
 * Local panel preview without MongoDB — static assets + mocked /me for sidebar QA.
 * Usage: node scripts/preview-panels-local.js
 */
const express = require("express");
const path = require("path");

const PORT = Number(process.env.PREVIEW_PORT || 3999);
const panelRoot = path.resolve(__dirname, "../panel");
const sharedRoot = path.join(panelRoot, "shared");
const workerRoot = path.join(panelRoot, "worker");

const mockUser = {
  telegramId: "123456789",
  username: "preview",
  firstName: "Preview",
  walletUsd: 42.5,
  photoUrl: "",
  roleLabel: "Администратор",
};

const workspacesAdmin = [
  { id: "admin", name: "Garbona Admin", url: `http://127.0.0.1:${PORT}/`, hint: "127.0.0.1" },
  { id: "worker", name: "Garbona Steam", url: `http://127.0.0.1:${PORT}/app/`, hint: "127.0.0.1" },
  { id: "polymarket", name: "PolyMarket", url: "", status: "development" },
];

const workspacesWorker = [
  { id: "worker", name: "Garbona Steam", url: `http://127.0.0.1:${PORT}/app/`, hint: "127.0.0.1" },
  { id: "polymarket", name: "PolyMarket", url: "", status: "development" },
];

const app = express();
app.use(express.json());

function noopJson(_req, res) {
  res.json({ ok: true, items: [], total: 0, data: {} });
}

app.get("/api/me", (_req, res) => {
  res.json({ user: mockUser, workspaces: workspacesAdmin });
});
app.get("/api/config", (_req, res) => {
  res.json({ usdRubRate: 90, botUsername: "Garbonabot" });
});
app.post("/api/auth/logout", noopJson);

app.get("/api/user/me", (_req, res) => {
  res.json({ user: mockUser, workspaces: workspacesWorker });
});
app.get("/api/user/config", (_req, res) => {
  res.json({ usdRubRate: 90, botUsername: "Garbonabot", supportUrl: "" });
});
app.post("/api/user/auth/logout", noopJson);

const mockLog = {
  id: "825531",
  username: "iskushal_ysI8B604",
  password: "secret",
  status: "MaFile",
  createdAt: "2026-08-24T03:45:18.000Z",
  isMaFile: true,
  isPrime: false,
  gamesCount: 4,
  gamesInfo: [
    { appid: 730, name: "Counter-Strike 2", icon: "8ddd8b0e1c8bfc4ba21d6412a0c8a12e", playtime: 1200, lastPlayed: 1755990000 },
    { appid: 570, name: "Dota 2", icon: "0bbb630d63262dd66d2eecaa3d59c117acdc99af", playtime: 80, lastPlayed: 1755000000 },
    { appid: 252490, name: "Rust", icon: "", playtime: 40, lastPlayed: 0 },
  ],
  steamInfo: {
    steamid: "76561198000082553",
    nickname: "El Loco Tito",
    country: "AR",
    level: 6,
    avatarHash: "fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb",
    balanceUsd: 6.11,
    balance: 6.11,
    balanceCurrency: "USD",
    vacBans: [730],
  },
  steamId: "76561198000082553",
  avatarUrl: "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg",
  profileUrl: "https://steamcommunity.com/profiles/76561198000082553/",
  inventoryUsd: 6.48,
  totalUsd: 12.59,
  inventory: {
    price: { tradable: 6.48, marketable: 6.48, total: 6.48 },
    inventories: [
      {
        appid: 730,
        name: "CS2",
        items: [
          { itemHashName: "AK-47 | Redline (Field-Tested)", price: 4.2, amount: 1, tradable: true, icon: "" },
          { itemHashName: "Glock-18 | Water Elemental", price: 2.28, amount: 1, tradable: false, icon: "" },
        ],
      },
    ],
  },
  owner: { id: 42, username: "laureanofunck", telegram: "8315958646" },
  accountTag: "",
};

app.get("/api/admin/overview", (_req, res) => {
  res.json({
    kpi: { teamCount: 12, pendingApps: 1, todayProfitDisplay: "$12.59", todayProfitDeltaPct: 4, pendingPayouts: 0 },
    series: [],
    mafiles: { statuses: { pending: 1 }, inventoryDisplay: "$6.48" },
  });
});
app.get("/api/admin/steam-control/stats", (_req, res) => {
  res.json({ statuses: [{ status: "MaFile", count: 1 }, { status: "Ok", count: 3 }] });
});
app.get("/api/admin/steam-control/accounts/:id/games", (_req, res) => {
  res.json({ gamesInfo: mockLog.gamesInfo });
});
app.get("/api/admin/steam-control/accounts/:id/inventory", (_req, res) => {
  res.json({ account: mockLog, inventory: mockLog.inventory });
});
app.get("/api/admin/steam-control/accounts/:id", (_req, res) => {
  res.json({ account: mockLog });
});
app.get("/api/admin/steam-control/accounts", (_req, res) => {
  res.json({ rows: [mockLog], totalCount: 1, pageCount: 1, statuses: ["MaFile"] });
});

app.use("/api/user", (_req, res) => noopJson(_req, res));
app.use("/api", (_req, res) => noopJson(_req, res));

app.use("/shared", express.static(sharedRoot));
app.use("/app", express.static(workerRoot));
app.get(["/app", "/app/"], (_req, res) => res.redirect("/app/index.html"));
app.use(express.static(panelRoot));

app.get("/", (_req, res) => {
  res.sendFile(path.join(panelRoot, "index.html"));
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Panel preview: http://127.0.0.1:${PORT}/`);
  console.log(`Worker preview: http://127.0.0.1:${PORT}/app/`);
});
