const assert = require("node:assert/strict");
const test = require("node:test");

const { canAccessTemplate, parseTemplatePublicFlag } = require("../src/services/settingsService");
const { mergeAccessibleTemplates, mergeEnabledTemplates, mergeAdminCatalogTemplates } = require("../src/services/templateCatalogService");

test("parseTemplatePublicFlag accepts only explicit true", () => {
  assert.equal(parseTemplatePublicFlag(true), true);
  assert.equal(parseTemplatePublicFlag("true"), true);
  assert.equal(parseTemplatePublicFlag(false), false);
  assert.equal(parseTemplatePublicFlag("false"), false);
  assert.equal(parseTemplatePublicFlag(undefined), false);
});

test("canAccessTemplate keeps catalog and public rows visible to everyone", () => {
  assert.equal(canAccessTemplate({ id: 1, name: "A" }, "111"), true);
  assert.equal(
    canAccessTemplate({ id: 2, name: "B", ownerTelegramId: "111", isPublic: true }, "222"),
    true
  );
});

test("canAccessTemplate hides private rows from other workers", () => {
  const row = { id: 3, name: "Mine", ownerTelegramId: "111", isPublic: false };
  assert.equal(canAccessTemplate(row, "111"), true);
  assert.equal(canAccessTemplate(row, "222"), false);
});

test("mergeEnabledTemplates returns only enabled visible rows", () => {
  const visible = [
    { id: 10, name: "Enabled A" },
    { id: 20, name: "Private", ownerTelegramId: "111", isPublic: false },
  ];
  const remote = [
    { id: 10, name: "Catalog A", preview: "https://cdn/a.jpg" },
    { id: 20, name: "Private", preview: "" },
    { id: 99, name: "Not enabled", preview: "" },
  ];
  const owner = mergeEnabledTemplates(remote, visible, "111").map((row) => row.id);
  const other = mergeEnabledTemplates(remote, visible, "222").map((row) => row.id);
  assert.deepEqual(owner, [20, 10]);
  assert.deepEqual(other, [10]);
});

test("mergeAdminCatalogTemplates marks worker templates and enabled state", () => {
  const visible = [{ id: 10, name: "On", ownerTelegramId: "111" }];
  const remote = [
    { id: 10, name: "On remote", preview: "" },
    { id: 50, name: "Off remote", preview: "" },
  ];
  const rows = mergeAdminCatalogTemplates(remote, visible);
  const on = rows.find((row) => row.id === 10);
  const off = rows.find((row) => row.id === 50);
  assert.equal(on.enabled, true);
  assert.equal(on.isWorkerTemplate, true);
  assert.equal(off.enabled, false);
  assert.equal(off.isWorkerTemplate, false);
});

test("mergeAccessibleTemplates shows private templates only to the owner", () => {
  const visible = [
    { id: 10, name: "Catalog" },
    { id: 20, name: "Private", ownerTelegramId: "111", isPublic: false },
    { id: 30, name: "Team", ownerTelegramId: "111", isPublic: true },
  ];
  const remote = [
    { id: 10, name: "Catalog", preview: "" },
    { id: 20, name: "Private", preview: "" },
    { id: 30, name: "Team", preview: "" },
  ];
  const owner = mergeAccessibleTemplates(remote, visible, "111").map((row) => row.id);
  const other = mergeAccessibleTemplates(remote, visible, "222").map((row) => row.id);
  assert.deepEqual(owner, [30, 20, 10]);
  assert.deepEqual(other, [30, 10]);
});
