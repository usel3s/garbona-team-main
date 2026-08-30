"use strict";

require("dotenv").config();
const axios = require("axios");
const { connectDatabase } = require("../src/config/db");
const User = require("../src/models/User");
const {
  authCredentials,
  getAllTeamDomains,
  getAllSteamLinks,
} = require("../src/services/apiService");
const { mergeCountryCounts } = require("../src/utils/countryStats");

async function pickAccount() {
  const teamKey = String(process.env.UPROJECT_API_KEY || "").trim();
  if (teamKey) {
    return { kind: "team", token: teamKey };
  }

  const user = await User.findOne({
    panelUsername: { $exists: true, $ne: "" },
    panelPassword: { $exists: true, $ne: "" },
    isTeamMember: true,
  })
    .select("panelUsername panelPassword telegramId")
    .lean({ getters: true });

  if (!user) throw new Error("No panel account found");
  const auth = await authCredentials(user.panelUsername, user.panelPassword);
  if (!auth?.token) throw new Error(`Auth failed for ${user.panelUsername}`);
  return { kind: "worker", token: auth.token, login: user.panelUsername };
}

function sampleCountries(link) {
  const stats = Array.isArray(link?.stats) ? link.stats : [];
  const samples = [];
  for (const row of stats) {
    if (!row?.countries && !row?.countryCounts) continue;
    samples.push({
      action: row.action,
      countries: row.countries,
      countryCounts: row.countryCounts,
    });
  }
  return samples;
}

async function main() {
  await connectDatabase();
  const auth = await pickAccount();
  console.log("auth:", auth.kind, auth.login || "team-key");

  const domainsPayload = await getAllTeamDomains().catch(async () => {
    const client = axios.create({
      baseURL: process.env.UPROJECT_API_BASE || "https://api.uproject.io",
      timeout: 30000,
      headers: {
        Cookie: `token=${auth.token}`,
        Origin: "https://uproject.io",
        Referer: "https://uproject.io/",
      },
    });
    const rows = [];
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      const payload = (
        await client.get("/steam/domains", { params: { offset, limit: 100 } })
      ).data;
      const chunk = payload?.rows || payload?.data || [];
      rows.push(...chunk);
      if (!payload?.hasNextPage || !chunk.length) break;
      const next = Number(payload?.lastId);
      offset = Number.isFinite(next) ? next : offset + chunk.length;
    }
    return { rows };
  });

  const domains = domainsPayload?.rows || [];
  console.log("domains total:", domains.length);

  let found = 0;
  let withStats = 0;
  for (const domain of domains) {
    const linksPayload = await getAllSteamLinks(auth.token, domain.id).catch(() => ({ rows: [] }));
    for (const link of linksPayload?.rows || []) {
      const stats = Array.isArray(link?.stats) ? link.stats : [];
      if (stats.length) withStats += 1;

      const samples = sampleCountries(link);
      const merged = mergeCountryCounts(link?.stats, link);
      const views = stats.find((row) => row?.action === "PageVisit")?.count || 0;

      if (!samples.length && !Object.keys(merged).length) {
        if (Number(views) > 0 && found < 2) {
          console.log("\n--- views but no geo ---");
          console.log("domain:", domain.domain, "link:", link.id, link.path, "views:", views);
          console.log("stats keys sample:", JSON.stringify(stats.slice(0, 3), null, 2));
        }
        continue;
      }

      found += 1;
      console.log("\n---");
      console.log("domain:", domain.domain, "link:", link.id, link.path, "views:", views);
      console.log("raw samples:", JSON.stringify(samples, null, 2));
      console.log("merged:", JSON.stringify(merged));
      if (found >= 8) {
        console.log("links with any stats rows:", withStats);
        return;
      }
    }
  }

  console.log("links with any stats rows:", withStats);
  if (!found) console.log("No links with country stats found");
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const mongoose = require("mongoose");
      await mongoose.disconnect();
    } catch (_) {
      /* ignore */
    }
  });
