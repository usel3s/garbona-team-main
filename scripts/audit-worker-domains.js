"use strict";

const { connectDatabase } = require("../src/config/db");
const User = require("../src/models/User");
const {
  authCredentials,
  getAllDomainsForToken,
  getAllTeamDomains,
  getTeamWorkers,
} = require("../src/services/apiService");

function ownerIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    const id = Number(payload?.id);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function domainKey(row) {
  return String(row?.domain || "").trim().toLowerCase();
}

async function fetchAllTeamWorkers(token) {
  const rows = [];
  const seen = new Set();
  let offset = 0;
  for (let page = 0; page < 50; page += 1) {
    const payload = await getTeamWorkers(token, offset, 100);
    const chunk = payload?.rows || [];
    let added = 0;
    for (const row of chunk) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      added += 1;
    }
    if (!chunk.length || !added) break;
    if (payload?.hasNextPage) {
      const next = Number(payload?.lastId);
      offset = Number.isFinite(next) && next !== offset ? next : offset + chunk.length;
      continue;
    }
    break;
  }
  return rows;
}

async function main() {
  await connectDatabase();
  const team = await getAllTeamDomains().catch((error) => ({ rows: [], error: error.message }));
  const teamRows = team.rows || [];
  const teamIds = new Set(teamRows.map((row) => Number(row.id)));

  const members = await User.find({
    panelUsername: { $exists: true, $ne: "" },
    panelPassword: { $exists: true, $ne: "" },
  })
    .select("telegramId username firstName panelUsername panelPassword")
    .lean({ getters: true });

  const accounts = [];
  const seen = new Set();
  for (const row of members) {
    const login = String(row.panelUsername || "").trim().toLowerCase();
    if (!login || seen.has(login)) continue;
    seen.add(login);
    accounts.push(row);
  }

  const queue = accounts.slice();
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(5, queue.length) }, async () => {
      while (queue.length) {
        const acc = queue.shift();
        if (!acc) return;
        const login = String(acc.panelUsername || "").trim();
        try {
          const auth = await authCredentials(login, acc.panelPassword);
          if (!auth?.token) {
            results.push({
              login,
              telegramId: String(acc.telegramId || ""),
              username: acc.username || "",
              ok: false,
              error: "no_token",
            });
            continue;
          }
          const ownerId = ownerIdFromToken(auth.token);
          const rows = await getAllDomainsForToken(auth.token);
          results.push({
            login,
            telegramId: String(acc.telegramId || ""),
            username: acc.username || "",
            ok: true,
            ownerId,
            domains: (rows || []).map((row) => ({
              id: row.id,
              domain: row.domain,
              owner: row.owner,
              isPublic: Boolean(row.isPublic || row.isTeamPublic),
              inTeamDump: teamIds.has(Number(row.id)),
            })),
          });
        } catch (error) {
          results.push({
            login,
            telegramId: String(acc.telegramId || ""),
            username: acc.username || "",
            ok: false,
            error: error?.response?.data?.message || error.message,
          });
        }
      }
    })
  );

  let teamWorkers = [];
  const ownerAcc = results.find((row) => row.ok && (row.domains || []).length);
  if (ownerAcc) {
    try {
      const auth = await authCredentials(
        accounts.find((row) => String(row.panelUsername).trim() === ownerAcc.login)?.panelUsername,
        accounts.find((row) => String(row.panelUsername).trim() === ownerAcc.login)?.panelPassword
      );
      if (auth?.token) teamWorkers = await fetchAllTeamWorkers(auth.token);
    } catch {
      /* ignore */
    }
  }

  const withDomains = results
    .filter((row) => row.ok && (row.domains || []).length)
    .sort((a, b) => (b.domains?.length || 0) - (a.domains?.length || 0));
  const authFail = results.filter((row) => !row.ok);
  const hidden = [];
  for (const row of withDomains) {
    for (const domain of row.domains) {
      if (!domain.inTeamDump) hidden.push({ login: row.login, ownerId: row.ownerId, ...domain });
    }
  }

  const mongoLogins = new Set(results.map((row) => row.login.toLowerCase()));
  const workersNoMongo = (teamWorkers || [])
    .filter((row) => !mongoLogins.has(String(row.username || "").toLowerCase()))
    .map((row) => ({ id: row.id, username: row.username || "", telegram: row.telegram || "" }));

  console.log(
    JSON.stringify(
      {
        teamDumpCount: teamRows.length,
        teamDumpError: team.error || null,
        teamDump: teamRows.map((row) => ({
          id: row.id,
          domain: row.domain,
          owner: row.owner,
          isPublic: Boolean(row.isPublic || row.isTeamPublic),
        })),
        mongoAccounts: results.length,
        authOk: results.filter((row) => row.ok).length,
        authFail: authFail.length,
        workersWithDomains: withDomains,
        hiddenFromTeamDump: hidden,
        authErrors: authFail.slice(0, 40),
        uprojectWorkers: teamWorkers.length,
        uprojectWorkersMissingMongo: workersNoMongo.slice(0, 80),
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
