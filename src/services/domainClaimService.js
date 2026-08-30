const DomainClaim = require("../models/DomainClaim");

async function loadDomainClaimsMap() {
  const rows = await DomainClaim.find({}).lean();
  return new Map(rows.map((row) => [Number(row.domainId), row]));
}

async function getDomainClaim(domainId) {
  const id = Number(domainId);
  if (!Number.isFinite(id) || id < 1) return null;
  return DomainClaim.findOne({ domainId: id }).lean();
}

async function deleteDomainClaim(domainId) {
  const id = Number(domainId);
  if (!Number.isFinite(id) || id < 1) return;
  await DomainClaim.deleteOne({ domainId: id });
}

function isForeignDomainClaim(claim, telegramId) {
  if (!claim) return false;
  return String(claim.ownerTelegramId) !== String(telegramId || "");
}

function applyWorkerDomainClaims(domains, claimsMap, telegramId) {
  const tid = String(telegramId || "");
  return (domains || [])
    .map((row) => {
      const claim = claimsMap.get(Number(row?.id));
      if (!claim) return row;
      if (String(claim.ownerTelegramId) !== tid) return null;
      return {
        ...row,
        isOwn: true,
        isTeamPublic: false,
        bindType: "cloudflare",
        bindNs: row.ns || [],
      };
    })
    .filter(Boolean);
}

function applyAdminDomainClaims(domains, claimsMap, userByTelegram) {
  return (domains || []).map((row) => {
    const claim = claimsMap.get(Number(row?.id));
    if (!claim) return row;
    const user = userByTelegram?.get(String(claim.ownerTelegramId));
    const username = String(user?.username || "").replace(/^@/, "");
    return {
      ...row,
      isOwn: false,
      isTeamPublic: false,
      bindType: "cloudflare",
      bindNs: row.ns || [],
      ownerTelegramId: String(claim.ownerTelegramId),
      ownerLabel: username ? `@${username}` : String(claim.ownerTelegramId),
    };
  });
}

module.exports = {
  loadDomainClaimsMap,
  getDomainClaim,
  deleteDomainClaim,
  isForeignDomainClaim,
  applyWorkerDomainClaims,
  applyAdminDomainClaims,
};
