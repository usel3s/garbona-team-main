const emojiMap = require("./emojiMap.json");

/** Application emoji refs for voice room panel (buttons + legend). */
const VOICE_EMOJI_KEYS = {
  hide: "open",
  name: "name",
  transfer: "rightdubl",
  kick: "ban",
  allow: "invite",
  deny: "kick",
  speakOn: "dover",
  speakOff: "nedover",
  limit: "limit",
  lock: "private",
};

function getEmoji(name) {
  const key = String(name || "").toLowerCase();
  const entry = emojiMap[key];
  if (!entry?.id) return null;
  return { id: String(entry.id), name: String(entry.name || key) };
}

function emojiMarkdown(name) {
  const emoji = getEmoji(name);
  if (!emoji) return "";
  return `<:${emoji.name}:${emoji.id}>`;
}

function emojiForButton(name) {
  const emoji = getEmoji(name);
  if (!emoji) return undefined;
  return { id: emoji.id, name: emoji.name };
}

function voiceEmojiMarkdown(action) {
  return emojiMarkdown(VOICE_EMOJI_KEYS[action]);
}

function voiceEmojiButton(action) {
  return emojiForButton(VOICE_EMOJI_KEYS[action]);
}

module.exports = {
  emojiMap,
  VOICE_EMOJI_KEYS,
  getEmoji,
  emojiMarkdown,
  emojiForButton,
  voiceEmojiMarkdown,
  voiceEmojiButton,
};
