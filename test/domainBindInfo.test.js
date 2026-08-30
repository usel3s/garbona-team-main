const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeNameservers,
  parseCloudflareContext,
} = require("../src/services/adminSitesService");

test("normalizeNameservers accepts nested and delimited UProject payloads", () => {
  assert.deepEqual(
    normalizeNameservers({
      data: {
        nameservers: "Darwin.NS.Cloudflare.com, maeve.ns.cloudflare.com",
      },
    }),
    ["darwin.ns.cloudflare.com", "maeve.ns.cloudflare.com"],
  );
});

test("parseCloudflareContext reads nested account id and deduplicates NS", () => {
  assert.deepEqual(
    parseCloudflareContext({
      data: {
        cloudflare: {
          id: "42",
          ns: [
            "darwin.ns.cloudflare.com",
            "maeve.ns.cloudflare.com",
            "darwin.ns.cloudflare.com",
          ],
        },
      },
    }),
    {
      id: 42,
      ns: ["darwin.ns.cloudflare.com", "maeve.ns.cloudflare.com"],
    },
  );
});

test("parseCloudflareContext keeps Cloudflare disabled without an account id", () => {
  assert.deepEqual(parseCloudflareContext(""), { id: null, ns: [] });
});
