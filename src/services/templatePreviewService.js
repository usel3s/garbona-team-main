const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const PREVIEWS_DIR = path.join(__dirname, "../../panel/worker/assets/template-previews");
const PUBLIC_PREFIX = "/app/assets/template-previews";
const DOWNLOAD_TIMEOUT_MS = 90000;
const MAX_ATTEMPTS = 25;

function ensureDir() {
  fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
}

function previewFilePath(templateId) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) return null;
  return path.join(PREVIEWS_DIR, `${id}.jpg`);
}

function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return "";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 5) === "GIF89" || buf.toString("ascii", 0, 5) === "GIF87") return "gif";
  return "";
}

function isImageBuffer(buf) {
  return Boolean(sniffImage(buf)) && buf.length > 2000;
}

function hasLocalPreview(templateId) {
  const file = previewFilePath(templateId);
  if (!file || !fs.existsSync(file)) return false;
  try {
    return isImageBuffer(fs.readFileSync(file));
  } catch {
    return false;
  }
}

function localPreviewUrl(templateId) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1 || !hasLocalPreview(id)) return "";
  try {
    const mtime = fs.statSync(previewFilePath(id)).mtimeMs;
    return `${PUBLIC_PREFIX}/${id}.jpg?v=${Math.trunc(mtime)}`;
  } catch {
    return `${PUBLIC_PREFIX}/${id}.jpg`;
  }
}

function fetchChunk(url, start = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "http:" ? http : https;
    const headers = {
      "User-Agent": "Mozilla/5.0",
      Accept: "image/jpeg,image/*,*/*",
      Referer: "https://uproject.io/",
      Connection: "close",
    };
    if (start > 0) headers.Range = `bytes=${start}-`;

    const req = lib.get(url, { headers, timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchChunk(res.headers.location, start).then(resolve, reject);
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers || {},
          body: Buffer.concat(chunks),
        });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("preview download timeout")));
    req.on("error", reject);
  });
}

async function downloadToFile(url, dest) {
  ensureDir();
  const tmp = `${dest}.part`;
  let have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  let total = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { status, headers, body } = await fetchChunk(url, have);
    if (status !== 200 && status !== 206) {
      throw new Error(`HTTP ${status}`);
    }

    if (status === 200) {
      fs.writeFileSync(tmp, body);
      have = body.length;
      total = Number(headers["content-length"] || body.length) || have;
    } else {
      if (body.length) fs.appendFileSync(tmp, body);
      have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
      const fromRange = Number(String(headers["content-range"] || "").split("/")[1] || 0);
      total = fromRange || total || have;
    }

    if (have >= total && have > 2000) {
      const buf = fs.readFileSync(tmp);
      if (!isImageBuffer(buf)) throw new Error("downloaded file is not an image");
      fs.renameSync(tmp, dest);
      return dest;
    }

    if (!body.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  throw new Error("preview download incomplete");
}

async function ensureLocalPreview(templateId, remoteUrl) {
  const id = Math.trunc(Number(templateId));
  const dest = previewFilePath(id);
  if (!dest) return "";
  if (hasLocalPreview(id)) return localPreviewUrl(id) || `${PUBLIC_PREFIX}/${id}.jpg`;

  const url = String(remoteUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";

  try {
    await downloadToFile(url, dest);
    return localPreviewUrl(id) || `${PUBLIC_PREFIX}/${id}.jpg`;
  } catch {
    try {
      fs.unlinkSync(`${dest}.part`);
    } catch {
      /* ignore */
    }
    return "";
  }
}

let playwrightLoadPromise = null;

function loadPlaywright() {
  if (!playwrightLoadPromise) {
    playwrightLoadPromise = Promise.resolve().then(() => {
      try {
        return require("playwright").chromium;
      } catch {
        return null;
      }
    });
  }
  return playwrightLoadPromise;
}

/**
 * Рендерит HTML шаблона в локальный JPEG-превью (для кастомных шаблонов).
 */
async function generatePreviewFromHtml(templateId, html) {
  const id = Math.trunc(Number(templateId));
  const dest = previewFilePath(id);
  const source = String(html || "").trim();
  if (!dest || !source) return "";

  const chromium = await loadPlaywright();
  if (!chromium) return "";

  ensureDir();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    await page.setContent(source, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({
      path: dest,
      type: "jpeg",
      quality: 72,
      fullPage: false,
    });
    if (!hasLocalPreview(id)) return "";
    return localPreviewUrl(id) || `${PUBLIC_PREFIX}/${id}.jpg`;
  } catch {
    try {
      if (fs.existsSync(dest) && !hasLocalPreview(id)) fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    return "";
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Создаёт/обновляет локальное превью: сначала CDN, иначе скриншот HTML.
 */
async function generateTemplatePreview(templateId, { html, remoteUrl } = {}) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) return "";

  if (hasLocalPreview(id)) {
    return localPreviewUrl(id) || `${PUBLIC_PREFIX}/${id}.jpg`;
  }

  const fromCdn = await ensureLocalPreview(id, remoteUrl);
  if (fromCdn) return fromCdn;

  if (html) {
    return generatePreviewFromHtml(id, html);
  }
  return "";
}

function publicPreviewApiUrl(templateId) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) return "";
  return `/api/user/public/template-preview/${id}.jpg`;
}

function adminPreviewAssetUrl(templateId) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) return "";
  if (hasLocalPreview(id)) {
    return localPreviewUrl(id).replace(/^\/app\/assets\//, "/assets/") || `/assets/template-previews/${id}.jpg`;
  }
  return `/assets/template-previews/${id}.jpg`;
}

/** Гарантированный URL превью (минимум — on-demand API). */
function primaryPreviewUrl(templateId, remoteUrl) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) return "";
  return (
    resolvePreviewUrl(id, remoteUrl) ||
    localPreviewUrl(id) ||
    adminPreviewAssetUrl(id) ||
    publicPreviewApiUrl(id)
  );
}

function previewUrlCandidates(templateId, remoteUrl) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) return [];
  const urls = [];
  const push = (value) => {
    const url = String(value || "").trim();
    if (!url || urls.includes(url)) return;
    urls.push(url);
  };
  push(resolvePreviewUrl(id, remoteUrl));
  push(localPreviewUrl(id));
  push(`/app/assets/template-previews/${id}.jpg`);
  push(adminPreviewAssetUrl(id));
  push(publicPreviewApiUrl(id));
  return urls;
}

function resolvePreviewUrl(templateId, remoteUrl) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) return "";
  if (hasLocalPreview(id)) {
    return localPreviewUrl(id);
  }
  void ensureLocalPreview(id, remoteUrl);
  if (hasLocalPreview(id)) return localPreviewUrl(id);
  return publicPreviewApiUrl(id);
}

function sendPreviewFile(res, templateId) {
  const id = Math.trunc(Number(templateId));
  const file = previewFilePath(id);
  if (!file || !hasLocalPreview(id)) return false;
  const buf = fs.readFileSync(file);
  const kind = sniffImage(buf) || "jpeg";
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.type(`image/${kind}`);
  res.sendFile(file);
  return true;
}

module.exports = {
  PREVIEWS_DIR,
  PUBLIC_PREFIX,
  hasLocalPreview,
  localPreviewUrl,
  ensureLocalPreview,
  generatePreviewFromHtml,
  generateTemplatePreview,
  resolvePreviewUrl,
  publicPreviewApiUrl,
  adminPreviewAssetUrl,
  primaryPreviewUrl,
  previewUrlCandidates,
  previewFilePath,
  sendPreviewFile,
};
