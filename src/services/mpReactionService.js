const MpReaction = require("../models/MpReaction");

const REACTIONS = [
  { key: "heart", emoji: "❤️" },
  { key: "plead", emoji: "🥹" },
  { key: "poop", emoji: "💩" },
  { key: "horns", emoji: "🤘" },
  { key: "call", emoji: "🤙" },
  { key: "money", emoji: "💸" },
];

const REACTION_KEYS = new Set(REACTIONS.map((r) => r.key));

function emptyCounts() {
  return Object.fromEntries(REACTIONS.map((r) => [r.key, 0]));
}

async function getReactionCounts(targetTelegramId) {
  const target = String(targetTelegramId);
  const rows = await MpReaction.aggregate([
    { $match: { targetTelegramId: target } },
    { $group: { _id: "$reaction", count: { $sum: 1 } } },
  ]);
  const counts = emptyCounts();
  for (const row of rows) {
    if (counts[row._id] != null) counts[row._id] = row.count;
  }
  return counts;
}

/**
 * Одна реакция на человека: повторный клик снимает, другая — меняет.
 * @returns {{ counts: Record<string, number>, changed: boolean, action: 'add'|'remove'|'switch' }}
 */
async function toggleMpReaction(targetTelegramId, reactorTelegramId, reactionKey) {
  if (!REACTION_KEYS.has(reactionKey)) {
    throw new Error("Неизвестная реакция");
  }
  const target = String(targetTelegramId);
  const reactor = String(reactorTelegramId);
  if (target === reactor) {
    const counts = await getReactionCounts(target);
    return { counts, changed: false, action: "self" };
  }

  const existing = await MpReaction.findOne({ targetTelegramId: target, reactorTelegramId: reactor });
  if (existing && existing.reaction === reactionKey) {
    await existing.deleteOne();
    return { counts: await getReactionCounts(target), changed: true, action: "remove" };
  }

  if (existing) {
    existing.reaction = reactionKey;
    await existing.save();
    return { counts: await getReactionCounts(target), changed: true, action: "switch" };
  }

  await MpReaction.create({
    targetTelegramId: target,
    reactorTelegramId: reactor,
    reaction: reactionKey,
  });
  return { counts: await getReactionCounts(target), changed: true, action: "add" };
}

function buildMpReactionKeyboard(targetTelegramId, counts = emptyCounts()) {
  const target = String(targetTelegramId);
  const buttons = REACTIONS.map((r) => ({
    text: `${r.emoji} ${Number(counts[r.key] || 0)}`,
    callback_data: `mp:react:${target}:${r.key}`,
  }));
  return {
    inline_keyboard: [buttons.slice(0, 3), buttons.slice(3, 6)],
  };
}

module.exports = {
  REACTIONS,
  REACTION_KEYS,
  emptyCounts,
  getReactionCounts,
  toggleMpReaction,
  buildMpReactionKeyboard,
};
