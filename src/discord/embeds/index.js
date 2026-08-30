const { buildRulesEmbedPayload } = require("./rules");
const { buildMemoEmbedPayload } = require("./memo");

async function buildEmbedPayload(type) {
  if (type === "rules") {
    return buildRulesEmbedPayload();
  }
  if (type === "memo") {
    return buildMemoEmbedPayload();
  }
  throw new Error(`Unknown embed type: ${type}`);
}

module.exports = {
  buildEmbedPayload,
  buildRulesEmbedPayload,
  buildMemoEmbedPayload,
};
