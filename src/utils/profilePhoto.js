const axios = require("axios");
const { env } = require("../config/env");
const { logger } = require("./logger");

/** @type {Map<string, { url: string; width: number; height: number; uniqueId: string; at: number }>} */
const thumbCache = new Map();
const avatarCache = new Map();
const THUMB_TTL_MS = 6 * 60 * 60 * 1000;

function pickProfileSize(sizes) {
  if (!sizes?.length) return null;
  const sorted = [...sizes].sort((a, b) => Number(a.width || 0) - Number(b.width || 0));
  return (
    sorted.find((s) => Number(s.width || 0) >= 160) ||
    sorted[sorted.length - 1] ||
    sorted[0] ||
    null
  );
}

async function getProfilePhotoMeta(telegram, telegramId) {
  try {
    const photos = await telegram.getUserProfilePhotos(Number(telegramId), 0, 1);
    const sizes = photos?.photos?.[0];
    const pick = pickProfileSize(sizes);
    if (!pick?.file_id) return null;
    return {
      fileId: pick.file_id,
      uniqueId: String(pick.file_unique_id || pick.file_id),
      width: Number(pick.width) || 320,
      height: Number(pick.height) || 320,
    };
  } catch (error) {
    logger.warn("getUserProfilePhotos failed", String(telegramId), error.message);
    return null;
  }
}

async function getProfilePhotoFileId(telegram, telegramId) {
  const meta = await getProfilePhotoMeta(telegram, telegramId);
  return meta?.fileId || null;
}

async function downloadTelegramFile(filePath) {
  const url = `https://api.telegram.org/file/bot${env.botToken}/${filePath}`;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
  return Buffer.from(res.data);
}

async function getProfilePhotoBuffer(telegram, telegramId) {
  const id = String(telegramId || "").trim();
  if (!/^\d+$/.test(id)) return null;
  const meta = await getProfilePhotoMeta(telegram, id);
  if (!meta) return null;

  const cached = avatarCache.get(id);
  if (cached && cached.uniqueId === meta.uniqueId && Date.now() - cached.at < THUMB_TTL_MS) {
    return cached.buffer;
  }

  try {
    const file = await telegram.getFile(meta.fileId);
    if (!file?.file_path) return null;
    const buffer = await downloadTelegramFile(file.file_path);
    avatarCache.set(id, { buffer, uniqueId: meta.uniqueId, at: Date.now() });
    return buffer;
  } catch (error) {
    logger.warn("profile photo download failed", id, error.message);
    return null;
  }
}

async function uploadPublicJpeg(buffer) {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", new Blob([buffer], { type: "image/jpeg" }), "avatar.jpg");
  const res = await axios.post("https://catbox.moe/user/api.php", form, { timeout: 20000 });
  const url = String(res.data || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

/**
 * Публичный JPEG для thumbnail_url у InlineQueryResultArticle.
 */
async function getProfileThumbnail(telegram, user) {
  const telegramId = String(user?.telegramId || "");
  if (!telegramId) return null;

  const meta = await getProfilePhotoMeta(telegram, telegramId);
  if (meta) {
    const cached = thumbCache.get(telegramId);
    if (cached && cached.uniqueId === meta.uniqueId && Date.now() - cached.at < THUMB_TTL_MS) {
      return { url: cached.url, width: cached.width, height: cached.height };
    }

    try {
      const file = await telegram.getFile(meta.fileId);
      if (!file?.file_path) return null;
      const buffer = await downloadTelegramFile(file.file_path);
      const publicUrl = await uploadPublicJpeg(buffer);
      if (!publicUrl) return null;

      const thumb = {
        url: publicUrl,
        width: meta.width,
        height: meta.height,
        uniqueId: meta.uniqueId,
        at: Date.now(),
      };
      thumbCache.set(telegramId, thumb);
      return { url: thumb.url, width: thumb.width, height: thumb.height };
    } catch (error) {
      logger.warn("profile thumbnail upload failed", telegramId, error.message);
    }
  }

  const fallback = telegramUserpicUrl(user?.username);
  if (fallback) {
    return {
      url: fallback,
      width: 320,
      height: 320,
    };
  }

  return null;
}

/**
 * Публичный URL аватарки для панели.
 * По умолчанию числовые Telegram ID идут через локальный прокси, чтобы внешние
 * хосты не ломались из-за CSP/hotlink-защиты. Для текущего пользователя можно
 * предпочесть сохранённый Login/WebApp URL и оставить прокси клиентским fallback.
 */
function resolveWorkerPhotoUrl(
  user,
  { loginPhotoUrl = "", preferStored = false } = {}
) {
  const stored = String(user?.avatarUrl || "").trim();
  const fromLogin = String(loginPhotoUrl || "").trim();
  if (preferStored) {
    if (/^https?:\/\//i.test(stored)) return stored;
    if (/^https?:\/\//i.test(fromLogin)) return fromLogin;
  }

  const telegramId = String(user?.telegramId || "").trim();
  if (/^\d+$/.test(telegramId)) return `/assets/avatar/${telegramId}`;

  if (/^https?:\/\//i.test(stored)) return stored;
  if (/^https?:\/\//i.test(fromLogin)) return fromLogin;
  return telegramUserpicUrl(user?.username) || "";
}

function telegramUserpicUrl(username) {
  const clean = String(username || "")
    .trim()
    .replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(clean)) return "";
  return `https://t.me/i/userpic/320/${clean}.jpg`;
}

module.exports = {
  getProfilePhotoFileId,
  getProfilePhotoBuffer,
  getProfileThumbnail,
  resolveWorkerPhotoUrl,
  telegramUserpicUrl,
};
