"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseCampaignStartPayload,
  isServiceStartPayload,
  normalizeSlug,
  validateSlug,
  validateCampaignName,
  validateSlugInput,
  buildTelegramDeepLink,
  buildFunnelMetrics,
  ratePercent,
  applicationCampaignSnapshot,
} = require("../src/services/adCampaignService");

test("parseCampaignStartPayload accepts c_slug and rejects invalid shapes", () => {
  assert.equal(parseCampaignStartPayload("c_tg_march"), "tg_march");
  assert.equal(parseCampaignStartPayload("c_AB"), "ab");
  assert.equal(parseCampaignStartPayload("c"), "");
  assert.equal(parseCampaignStartPayload("c_a"), "");
  assert.equal(parseCampaignStartPayload("dsc_token123"), "");
  assert.equal(parseCampaignStartPayload(""), "");
});

test("isServiceStartPayload ignores known bot deep links", () => {
  assert.equal(isServiceStartPayload("payout_507f1f77bcf86cd799439011"), true);
  assert.equal(isServiceStartPayload("dsc_abc123def456ghi7"), true);
  assert.equal(isServiceStartPayload("fb_reply_507f1f77bcf86cd799439011"), true);
  assert.equal(isServiceStartPayload("u_123456789"), true);
  assert.equal(isServiceStartPayload("feedback"), true);
  assert.equal(isServiceStartPayload("c_tg_march"), false);
  assert.equal(isServiceStartPayload(""), false);
});

test("validateCampaignName accepts any display name", () => {
  assert.equal(validateCampaignName("Март — Telegram"), "Март — Telegram");
  assert.equal(validateCampaignName(" TelegramMarch "), "TelegramMarch");
  assert.throws(() => validateCampaignName(""), /название рекламы/i);
});

test("validateSlugInput normalizes link slug", () => {
  assert.equal(validateSlugInput(" TG-March "), "tg_march");
  assert.throws(() => validateSlugInput("a"), /Ссылка/);
});

test("buildTelegramDeepLink returns full t.me URL", () => {
  const url = buildTelegramDeepLink("tg_march", "Garbonabot");
  assert.equal(url, "https://t.me/Garbonabot?start=c_tg_march");
});

test("normalizeSlug and validateSlug enforce slug rules", () => {
  assert.equal(normalizeSlug(" TG-March "), "tg_march");
  assert.equal(validateSlug("tg_march"), "tg_march");
  assert.equal(validateSlug("bad slug"), "bad_slug");
  assert.throws(() => validateSlug("a"), /Ссылка/);
});

test("ratePercent and funnel metrics compute conversion stages", () => {
  assert.equal(ratePercent(3, 10), 30);
  assert.equal(ratePercent(0, 0), null);

  const funnel = buildFunnelMetrics({
    starts: 100,
    applications: 40,
    accepted: 10,
    firstProfit: 4,
    clicks: 250,
  });

  assert.equal(funnel.starts, 100);
  assert.equal(funnel.startToApplication, 40);
  assert.equal(funnel.applicationToAccepted, 25);
  assert.equal(funnel.acceptedToProfit, 40);
  assert.equal(funnel.startToAccepted, 10);
  assert.equal(funnel.startToProfit, 4);
  assert.equal(funnel.clicks, 250);
});

test("applicationCampaignSnapshot copies user attribution", () => {
  assert.deepEqual(applicationCampaignSnapshot({}), { campaignId: "", campaignSlug: "" });
  assert.deepEqual(
    applicationCampaignSnapshot({ campaignId: "abc", campaignSlug: "tg_march" }),
    { campaignId: "abc", campaignSlug: "tg_march" }
  );
});

test("first-touch snapshot does not overwrite when campaign already set", () => {
  const user = { campaignId: "existing", campaignSlug: "old" };
  const snapshot = applicationCampaignSnapshot(user);
  assert.equal(snapshot.campaignId, "existing");
  assert.equal(snapshot.campaignSlug, "old");
});
