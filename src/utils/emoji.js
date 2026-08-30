const E = {
  settings: "5870982283724328568",
  profile: "5870994129244131212",
  users: "5870772616305839506",
  userVerified: "5891207662678317861",
  userBlocked: "5893192487324880883",
  file: "5870528606328852614",
  smile: "5870764288364252592",
  statistics: "5870921681735781843",
  analytics: "5870930636742595124",
  home: "5873147866364514353",
  lock: "6037249452824072506",
  unlock: "6037496202990194718",
  broadcast: "6039422865189638057",
  success: "5870633910337015697",
  error: "5870657884844462243",
  edit: "5870676941614354370",
  delete: "5870875489362513438",
  attachment: "6039451237743595514",
  link: "5769289093221454192",
  info: "6028435952299413210",
  bot: "6030400221232501136",
  visible: "6037397706505195857",
  hidden: "6037243349675544634",
  upload: "5963103826075456248",
  download: "6039802767931871481",
  notification: "6039486778597970865",
  gift: "6032644646587338669",
  time: "5983150113483134607",
  celebrate: "6041731551845159060",
  location: "6042011682497106307",
  wallet: "5769126056262898415",
  package: "5884479287171485878",
  cryptobot: "5260752406890711732",
  calendar: "5890937706803894250",
  tag: "5886285355279193209",
  coins: "5904462880941545555",
  transfer: "5890848474563352982",
  receive: "5879814368572478751",
  code: "5940433880585605708",
  loading: "5345906554510012647",
};

const FALLBACK = {
  settings: "⚙️",
  profile: "👤",
  users: "👥",
  userVerified: "✅",
  userBlocked: "🚫",
  file: "📄",
  smile: "🙂",
  statistics: "📊",
  analytics: "📈",
  home: "🏠",
  lock: "🔒",
  unlock: "🔓",
  broadcast: "📣",
  success: "✅",
  error: "❌",
  edit: "✏️",
  delete: "🗑",
  attachment: "📎",
  link: "🔗",
  info: "ℹ️",
  bot: "🤖",
  visible: "👁",
  hidden: "👁",
  upload: "⬆",
  download: "⬇",
  notification: "🔔",
  gift: "🎁",
  time: "⏰",
  celebrate: "🎉",
  location: "📍",
  wallet: "👛",
  package: "📦",
  cryptobot: "👾",
  calendar: "📅",
  tag: "🏷",
  coins: "🪙",
  transfer: "💸",
  receive: "🏧",
  code: "🔨",
  loading: "🔄",
};

function pe(key) {
  const id = E[key];
  const fb = FALLBACK[key] || "•";
  if (!id) return fb;
  return `<tg-emoji emoji-id="${id}">${fb}</tg-emoji>`;
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/** Convert the limited HTML used by bot captions into explicit Bot API entities. */
function telegramHtmlEntities(html) {
  const parts = [];
  const entities = [];
  const stack = [];
  const tokens = String(html || "").match(/<[^>]+>|[^<]+/g) || [];
  const length = () => parts.join("").length;
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      parts.push(decodeHtmlText(token));
      continue;
    }
    const close = token.match(/^<\/\s*(b|strong|i|em|code|a|tg-emoji)\s*>$/i);
    if (close) {
      const tag = close[1].toLowerCase();
      const index = stack.map((item) => item.tag).lastIndexOf(tag);
      if (index < 0) continue;
      const entry = stack.splice(index, 1)[0];
      const entityLength = length() - entry.offset;
      if (entityLength <= 0) continue;
      const entity = { type: entry.type, offset: entry.offset, length: entityLength };
      if (entry.url) entity.url = entry.url;
      if (entry.custom_emoji_id) entity.custom_emoji_id = entry.custom_emoji_id;
      entities.push(entity);
      continue;
    }
    const open = token.match(/^<\s*(b|strong|i|em|code|a|tg-emoji)\b([^>]*)>$/i);
    if (!open) continue;
    const tag = open[1].toLowerCase();
    const attrs = open[2] || "";
    const type = tag === "b" || tag === "strong" ? "bold"
      : tag === "i" || tag === "em" ? "italic"
        : tag === "a" ? "text_link"
          : tag === "tg-emoji" ? "custom_emoji" : "code";
    const entry = { tag, type, offset: length() };
    if (tag === "a") entry.url = decodeHtmlText(attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || "");
    if (tag === "tg-emoji") entry.custom_emoji_id = attrs.match(/emoji-id\s*=\s*["'](\d+)["']/i)?.[1] || "";
    stack.push(entry);
  }
  return { text: parts.join(""), entities: entities.sort((a, b) => a.offset - b.offset || b.length - a.length) };
}

function telegramHtmlCaption(html) {
  const { text, entities } = telegramHtmlEntities(html);
  return { caption: text, caption_entities: entities.length ? entities : undefined };
}

function btn(text, callbackData, emojiKey) {
  const button = { text, callback_data: callbackData };
  if (emojiKey && E[emojiKey]) {
    button.icon_custom_emoji_id = E[emojiKey];
  }
  return button;
}

function urlBtn(text, url, emojiKey) {
  const button = { text, url };
  if (emojiKey && E[emojiKey]) {
    button.icon_custom_emoji_id = E[emojiKey];
  }
  return button;
}

function webAppBtn(text, url, emojiKey) {
  const button = { text, web_app: { url } };
  if (emojiKey && E[emojiKey]) {
    button.icon_custom_emoji_id = E[emojiKey];
  }
  return button;
}

function switchInlineBtn(text, query, emojiKey) {
  const button = {
    text,
    switch_inline_query_current_chat: query,
  };
  if (emojiKey && E[emojiKey]) {
    button.icon_custom_emoji_id = E[emojiKey];
  }
  return button;
}

module.exports = { E, FALLBACK, pe, telegramHtmlEntities, telegramHtmlCaption, btn, urlBtn, webAppBtn, switchInlineBtn };
