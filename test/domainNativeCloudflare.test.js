"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const apiService = require("../src/services/apiService");
const sitesHandler = require("../src/handlers/sitesHandler");
const User = require("../src/models/User");

const calls = [];
apiService.getActualIPs = async (token) => {
  calls.push(["ips", token]);
  return { rows: ["203.0.113.10"] };
};
apiService.getCloudflareNameservers = async (token) => {
  calls.push(["cloudflare", token]);
  return {
    id: 42,
    nameservers: ["one.ns.cloudflare.com", "two.ns.cloudflare.com"],
  };
};
apiService.getAllTeamDomains = async () => ({ rows: [] });
apiService.getAllDomainsForToken = async () => [];
apiService.checkDomainAvailability = async () => ({ available: true });
apiService.createDomain = async (token, payload) => {
  calls.push(["create", token, payload]);
  return {
    id: 101,
    domain: payload.domain,
    owner: 77,
    ns: ["one.ns.cloudflare.com", "two.ns.cloudflare.com"],
  };
};
sitesHandler.getPanelToken = async () => ({ token: "worker-token", ownerId: 77 });
User.find = () => ({
  select() {
    return this;
  },
  lean: async () => [],
});

delete require.cache[require.resolve("../src/services/adminSitesService")];
const { addDomain, getDomainBindInfo } = require("../src/services/adminSitesService");

test("Cloudflare bind info is loaded with the worker token", async () => {
  const result = await getDomainBindInfo({ panelUsername: "worker", panelPassword: "secret" });

  assert.deepEqual(result.ns, ["one.ns.cloudflare.com", "two.ns.cloudflare.com"]);
  assert.equal(result.cloudflareAvailable, true);
  assert.ok(calls.some(([name, token]) => name === "cloudflare" && token === "worker-token"));
});

test("Cloudflare domain is created natively as the worker's private domain", async () => {
  const result = await addDomain(
    { panelUsername: "worker", panelPassword: "secret", telegramId: "123" },
    "native-cloudflare.example",
    { bindType: "cloudflare" }
  );

  const createCall = calls.find(([name]) => name === "create");
  assert.deepEqual(createCall, [
    "create",
    "worker-token",
    {
      domain: "native-cloudflare.example",
      type: "Cloudflare",
      service: "Steam",
      isPublic: false,
      isTransit: false,
      cloudflare: 42,
    },
  ]);
  assert.equal(result.created.isOwn, true);
  assert.equal(result.created.isTeamPublic, false);
  assert.equal(result.bindType, "cloudflare");
});
