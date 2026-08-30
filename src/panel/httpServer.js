const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieParser = require("cookie-parser");
const axios = require("axios");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { getProfilePhotoBuffer, telegramUserpicUrl } = require("../utils/profilePhoto");
const User = require("../models/User");
const { createPanelRouter } = require("./routes");
const { createUserRouter } = require("./userRoutes");
const {
  incrementCampaignClick,
  buildTelegramDeepLink,
  normalizeSlug,
  SLUG_PATTERN,
} = require("../services/adCampaignService");

const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_HITS = 10;
const authHits = new Map();

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return xf || req.ip || req.socket?.remoteAddress || "unknown";
}

function rateLimitAuth(req, res, next) {
  const key = `${clientIp(req)}:${req.path}`;
  const now = Date.now();
  let bucket = authHits.get(key);
  if (!bucket || now - bucket.start > AUTH_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    authHits.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > AUTH_MAX_HITS) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "too_many_requests" });
  }
  return next();
}

function originFromConfiguredUrl(value) {
  try {
    return new URL(String(value || "").trim()).origin;
  } catch (_) {
    return "";
  }
}

function hostnameFromUrl(value, fallback = "") {
  try {
    return new URL(String(value || "").trim()).hostname.toLowerCase();
  } catch (_) {
    return fallback;
  }
}

function canonicalWorkerOrigin() {
  return originFromConfiguredUrl(env.panelPublicUrl || "https://garbona.cc") || "https://garbona.cc";
}

function canonicalWorkerHostname() {
  return hostnameFromUrl(env.panelPublicUrl || "https://garbona.cc", "garbona.cc");
}

function workerMirrorHostnames() {
  const main = canonicalWorkerHostname();
  return new Set(
    [`www.${main}`, "www.garbona.cc", "panel.garbona.cc"].filter((h) => h && h !== main)
  );
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const allowed = new Set(
    [env.panelPublicUrl || "https://garbona.cc", env.adminPanelUrl, env.manualsDocsUrl]
      .map(originFromConfiguredUrl)
      .filter(Boolean)
  );
  // Keep apex only — no panel/www mirrors for CSRF/auth.
  allowed.add(canonicalWorkerOrigin());
  if (allowed.has(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return true;
  } catch (_) {
    return false;
  }
  return false;
}

function requestHostname(req) {
  const raw = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return raw.replace(/:\d+$/, "");
}

function isLoopbackHost(hostname) {
  return (
    !hostname ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function docsPublicHostname() {
  return hostnameFromUrl(
    env.manualsDocsUrl || "https://docs.garbona.cc/docs/#overview",
    "docs.garbona.cc"
  );
}

function adminPublicHostname() {
  return hostnameFromUrl(env.adminPanelUrl || "https://admin.garbona.cc", "admin.garbona.cc");
}

function workerPublicHostnames() {
  const main = canonicalWorkerHostname();
  return new Set([main, ...workerMirrorHostnames()]);
}

function hostKind(hostname) {
  if (isLoopbackHost(hostname)) return "local";
  const docsHost = docsPublicHostname();
  if (hostname === docsHost || hostname === `www.${docsHost}`) return "docs";
  if (hostname === adminPublicHostname()) return "admin";
  if (workerPublicHostnames().has(hostname)) return "worker";
  return "other";
}

function redirectToCanonicalWorker(req, res) {
  const dest = new URL(req.originalUrl || req.url || "/", canonicalWorkerOrigin());
  return res.redirect(308, dest.toString());
}

function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.path.startsWith("/api")) return next();

  const host = requestHostname(req);
  if (isLoopbackHost(host) && !req.headers.origin && !req.headers.referer) {
    return next();
  }

  const origin = String(req.headers.origin || "").trim();
  const referer = String(req.headers.referer || "").trim();
  if (origin) {
    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({ error: "forbidden_origin" });
    }
    return next();
  }
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!isAllowedOrigin(refOrigin)) {
        return res.status(403).json({ error: "forbidden_origin" });
      }
      return next();
    } catch (_) {
      return res.status(403).json({ error: "forbidden_origin" });
    }
  }
  // Mini App auth may omit Origin on some clients.
  if (/\/api\/user\/auth\/(telegram|webapp)$/.test(req.path)) return next();
  return res.status(403).json({ error: "forbidden_origin" });
}

function securityHeaders(req, res, next) {
  const p = req.path || "";
  const isWorkerLogin =
    p === "/app/login" || p === "/app/login.html" || p.endsWith("/app/login.html");
  const isAdminLogin = p === "/login.html";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Telegram Login opens oauth.telegram.org popup and needs opener access.
  res.setHeader(
    "Cross-Origin-Opener-Policy",
    isWorkerLogin ? "same-origin-allow-popups" : "same-origin"
  );
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (
    String(env.panelPublicUrl || "").startsWith("https") ||
    String(env.adminPanelUrl || "").startsWith("https")
  ) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (isAdminLogin) {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data:",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
      ].join("; ")
    );
  } else if (isWorkerLogin) {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self' https://oauth.telegram.org",
        "frame-ancestors 'none'",
        "frame-src https://oauth.telegram.org https://telegram.org",
        "img-src 'self' data: blob: https://t.me https://telegram.org https://*.telegram.org https://*.telesco.pe https://telesco.pe https://catbox.moe https://avatars.steamstatic.com https://*.steamstatic.com https://*.steampowered.com https://cdn.discordapp.com https://media.discordapp.net",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "script-src 'self' 'unsafe-inline' https://telegram.org",
        "connect-src 'self' https://telegram.org https://oauth.telegram.org",
      ].join("; ")
    );
  } else {
    // The authenticated applications render untrusted API data. Keep scripts non-inline
    // so an escaping mistake cannot immediately become account takeover.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "img-src 'self' data: blob: https://t.me https://telegram.org https://*.telegram.org https://*.telesco.pe https://telesco.pe https://catbox.moe https://avatars.steamstatic.com https://*.steamstatic.com https://*.steampowered.com https://cdn.discordapp.com https://media.discordapp.net https://flagcdn.com https://purecatamphetamine.github.io",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "script-src 'self' https://telegram.org",
        "connect-src 'self' https://telegram.org",
      ].join("; ")
    );
  }
  next();
}

function apiHostGuard(req, res, next) {
  const host = requestHostname(req);
  const kind = hostKind(host);
  if (kind === "local") return next();

  const p = req.path;
  if (p.startsWith("/api/user")) {
    if (kind === "docs" || kind === "other") {
      return res.status(404).json({ error: "not_found" });
    }
    // Worker auth only on canonical garbona.cc (mirrors redirect for HTML).
    if (
      (p.startsWith("/api/user/auth/telegram") ||
        p.startsWith("/api/user/auth/webapp") ||
        p.startsWith("/api/user/auth/password") ||
        p.startsWith("/api/user/auth/impersonate")) &&
      kind === "worker" &&
      host !== canonicalWorkerHostname()
    ) {
      return res.status(403).json({ error: "wrong_host", canonical: canonicalWorkerOrigin() });
    }
    return next();
  }
  if (p.startsWith("/api/")) {
    if (kind !== "admin") {
      return res.status(404).json({ error: "not_found" });
    }
  }
  return next();
}

function ensureWorkerBrandAssets(workerRoot, panelRoot) {
  const pairs = [
    ["assets/logo.png", "assets/logo.png"],
    ["assets/logo.svg", "assets/logo.svg"],
    ["assets/logo-mark.png", "assets/logo-mark.png"],
  ];
  for (const [relWorker, relPanel] of pairs) {
    const workerFile = path.join(workerRoot, relWorker);
    const panelFile = path.join(panelRoot, relPanel);
    if (fs.existsSync(workerFile) || !fs.existsSync(panelFile)) continue;
    fs.mkdirSync(path.dirname(workerFile), { recursive: true });
    fs.copyFileSync(panelFile, workerFile);
    logger.info(`Synced worker brand asset: ${relWorker}`);
  }
}

function sendBrandLogo(res, workerRoot, panelRoot, filename = "logo.png") {
  const workerFile = path.join(workerRoot, "assets", filename);
  const panelFile = path.join(panelRoot, "assets", filename);
  const file = fs.existsSync(workerFile) ? workerFile : panelFile;
  if (!fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.type(path.extname(filename) === ".svg" ? "image/svg+xml" : "image/png");
  res.sendFile(file);
}

async function fetchPublicAvatar(url) {
  const href = String(url || "").trim();
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const response = await axios.get(href, {
      responseType: "arraybuffer",
      timeout: 8000,
      maxContentLength: 4 * 1024 * 1024,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    const type = String(response.headers["content-type"] || "image/jpeg").split(";")[0];
    if (!/^image\//i.test(type)) return null;
    return { buffer: Buffer.from(response.data), type };
  } catch (error) {
    logger.warn("public avatar fetch failed", href, error.message);
    return null;
  }
}

function startPanelServer(bot) {
  const app = express();
  const panelRoot = path.resolve(__dirname, "../../panel");
  const workerRoot = path.resolve(panelRoot, "worker");
  const sharedRoot = path.resolve(panelRoot, "shared");
  const docsRoot = path.resolve(__dirname, "../../docs-site");

  ensureWorkerBrandAssets(workerRoot, panelRoot);

  function sendNotFoundPage(res) {
    res.status(404);
    res.setHeader("Cache-Control", "no-store");
    return res.sendFile(path.join(workerRoot, "404.html"));
  }

  app.disable("x-powered-by");
  // Only a local reverse proxy may supply X-Forwarded-* headers. A numeric trust
  // level would let clients connected directly to this port spoof their source IP.
  app.set("trust proxy", (ip) => isLoopbackHost(String(ip || "").replace(/^::ffff:/, "")));

  app.get("/healthz", (req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/r/:slug", async (req, res) => {
    try {
      const slug = normalizeSlug(req.params.slug);
      if (!SLUG_PATTERN.test(slug)) return sendNotFoundPage(res);
      const campaign = await incrementCampaignClick(slug);
      if (!campaign) return sendNotFoundPage(res);
      const target = buildTelegramDeepLink(campaign.slug);
      if (!target) return sendNotFoundPage(res);
      res.redirect(302, target);
    } catch (_) {
      return sendNotFoundPage(res);
    }
  });

  app.use(securityHeaders);
  app.use((req, res, next) => {
    const host = requestHostname(req);
    const kind = hostKind(host);
    if (kind === "local") return next();

    if (kind === "docs") {
      if (req.path === "/" || req.path === "") return res.redirect(308, "/docs/");
      if (req.path.startsWith("/docs") || req.path.startsWith("/api")) return next();
      return res.redirect(308, "/docs/");
    }

    if (kind === "admin") {
      if (req.path.startsWith("/app/assets/template-previews")) return next();
      if (req.path.startsWith("/assets/template-previews")) return next();
      if (req.path.startsWith("/app") || req.path.startsWith("/docs") || req.path.startsWith("/worker")) {
        return res.status(404).send("Not found");
      }
      return next();
    }

    if (kind === "worker") {
      // Canonical worker host only: garbona.cc (mirrors → redirect).
      if (host !== canonicalWorkerHostname() && workerMirrorHostnames().has(host)) {
        return redirectToCanonicalWorker(req, res);
      }
      if (req.path === "/" || req.path === "" || req.path === "/index.html" || req.path === "/login.html") {
        return res.redirect(308, "/app/");
      }
      if (
        req.path.startsWith("/app") ||
        req.path.startsWith("/api/user") ||
        req.path.startsWith("/worker") ||
        req.path.startsWith("/assets") ||
        req.path.startsWith("/shared")
      ) {
        return next();
      }
      if (req.path.startsWith("/api")) {
        return res.status(404).json({ error: "not_found" });
      }
      return res.redirect(308, "/app/");
    }

    return res.status(404).send("Not found");
  });

  app.use("/api/user/sites/templates", express.json({ limit: "2mb" }));
  app.use("/api/admin/sites/templates", express.json({ limit: "2mb" }));
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "256kb" }));
  app.use(cookieParser());
  app.use(csrfGuard);
  app.use(apiHostGuard);

  app.use("/api/user/auth/telegram", rateLimitAuth);
  app.use("/api/user/auth/webapp", rateLimitAuth);
  app.use("/api/user/auth/password", rateLimitAuth);
  app.use("/api/user/auth/impersonate", rateLimitAuth);
  app.use("/api/user/settings/2fa", rateLimitAuth);
  app.use("/api/user/discord", rateLimitAuth);
  app.use("/api/auth/login", rateLimitAuth);

  app.get("/assets/avatar/:telegramId", async (req, res) => {
    const telegramId = String(req.params.telegramId || "").trim();
    if (!/^\d+$/.test(telegramId)) return res.status(400).end();

    try {
      const buffer = bot?.telegram
        ? await getProfilePhotoBuffer(bot.telegram, telegramId)
        : null;
      if (buffer) {
        res.setHeader("Cache-Control", "public, max-age=21600");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        return res.type("image/jpeg").send(buffer);
      }
    } catch (error) {
      logger.warn("Panel avatar proxy failed", telegramId, error.message);
    }

    const user = await User.findOne(
      { telegramId },
      { avatarUrl: 1, username: 1 }
    ).lean();

    const fallbacks = [];
    const stored = String(user?.avatarUrl || "").trim();
    if (/^https?:\/\//i.test(stored)) fallbacks.push(stored);
    const userpic = telegramUserpicUrl(user?.username || req.query?.u);
    if (userpic) fallbacks.push(userpic);

    for (const fallback of [...new Set(fallbacks)]) {
      const proxied = await fetchPublicAvatar(fallback);
      if (proxied) {
        res.setHeader("Cache-Control", "public, max-age=21600");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        return res.type(proxied.type).send(proxied.buffer);
      }
    }
    return res.status(404).end();
  });

  app.use("/api/user", createUserRouter(bot));
  app.use("/api", createPanelRouter(bot));

  app.get("/app/assets/logo.png", (req, res) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "worker" && kind !== "admin") {
      return res.status(404).end();
    }
    return sendBrandLogo(res, workerRoot, panelRoot, "logo.png");
  });
  app.get("/app/assets/logo-mark.png", (req, res) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "worker" && kind !== "admin") {
      return res.status(404).end();
    }
    return sendBrandLogo(res, workerRoot, panelRoot, "logo-mark.png");
  });
  app.get("/assets/logo-mark.png", (req, res) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "admin") {
      return res.status(404).end();
    }
    return sendBrandLogo(res, workerRoot, panelRoot, "logo-mark.png");
  });
  app.get("/assets/logo.png", (req, res) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "admin") {
      return res.status(404).end();
    }
    return sendBrandLogo(res, workerRoot, panelRoot, "logo.png");
  });
  app.get("/app/assets/logo.svg", (req, res) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "worker" && kind !== "admin") {
      return res.status(404).end();
    }
    return sendBrandLogo(res, workerRoot, panelRoot, "logo.svg");
  });

  app.get("/assets/template-previews/:id.jpg", async (req, res) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "admin") {
      return res.status(404).end();
    }
    const id = Number(String(req.params.id || "").replace(/\.jpg$/i, ""));
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: "invalid_template_id" });
    }
    const {
      sendPreviewFile,
      hasLocalPreview,
      publicPreviewApiUrl,
    } = require("../services/templatePreviewService");
    const { bootstrapTemplatePreviewFile } = require("../services/adminSitesService");

    try {
      if (!hasLocalPreview(id)) {
        await bootstrapTemplatePreviewFile(id);
      }
      if (sendPreviewFile(res, id)) return undefined;
      return res.redirect(302, publicPreviewApiUrl(id));
    } catch (error) {
      if (!res.headersSent) {
        res.status(error.status || 404).json({ error: error.message || "preview_unavailable" });
      }
      return undefined;
    }
  });

  app.get(/^\/docs$/, (_req, res) => {
    res.redirect(308, "/docs/");
  });
  app.get("/docs/", (req, res, next) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "docs") return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(docsRoot, "index.html"));
  });
  app.use("/docs", (req, res, next) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "docs") return next("route");
    return express.static(docsRoot, {
      index: false,
      dotfiles: "deny",
      setHeaders(res, filePath) {
        // content.js / app.js change often; year-long immutable cache left localhost in CDN.
        if (/\.(?:html?|js|css)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "no-store");
        } else {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
      },
    })(req, res, next);
  });

  // Sidebar layer shared by both panels; served from an absolute path because the
  // worker document sets <base href="/app/">.
  app.use("/shared", (req, res, next) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "admin" && kind !== "worker") {
      return res.status(404).send("Not found");
    }
    return express.static(sharedRoot, {
      index: false,
      dotfiles: "deny",
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-store");
      },
    })(req, res, next);
  });

  app.use("/app", (req, res, next) => {
    const kind = hostKind(requestHostname(req));
    if (kind === "local" || kind === "worker") return next();
    if (kind === "admin" && req.path.startsWith("/assets/template-previews")) return next();
    return res.status(404).send("Not found");
  });
  app.get("/app/login", (_req, res) => res.sendFile(path.join(workerRoot, "login.html")));
  app.get("/app/discord", (_req, res) => res.sendFile(path.join(workerRoot, "discord.html")));
  app.get("/app/login.html", (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(308, `/app/login${query}`);
  });
  app.get("/app/discord.html", (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(308, `/app/discord${query}`);
  });
  app.get("/app/index.html", (_req, res) => res.redirect(308, "/app/"));
  app.use(
    "/app",
    express.static(workerRoot, {
      index: false,
      extensions: ["html"],
      dotfiles: "deny",
      setHeaders(res, filePath) {
        if (/\.(?:png|jpe?g|webp|gif|svg)$/i.test(filePath)) {
          if (/template-previews/i.test(filePath)) {
            res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          } else {
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          }
        }
        if (/\.(?:html?|js|css)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "no-store");
        } else if (/template-previews/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
      },
    })
  );
  app.get(["/app", "/app/"], (req, res) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "worker") return res.status(404).send("Not found");
    res.sendFile(path.join(workerRoot, "index.html"));
  });
  app.use("/app", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    return sendNotFoundPage(res);
  });

  app.use("/worker", (req, res) => {
    const suffix = req.url && req.url !== "/" ? req.url : "/";
    res.redirect(301, `/app${suffix}`);
  });

  app.get(["/payouts/:id", "/admin/payouts/:id"], (req, res, next) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "admin") return next();
    const id = String(req.params.id || "").trim();
    if (!/^[a-f0-9]{24}$/i.test(id)) return next();
    res.redirect(302, `/index.html#payouts/${id}`);
  });

  app.use((req, res, next) => {
    if (/\.(?:html?|js)$/i.test(req.path) || req.path === "/" || req.path === "") {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  });

  app.use((req, res, next) => {
    const kind = hostKind(requestHostname(req));
    if (kind !== "local" && kind !== "admin") return next("route");
    return express.static(panelRoot, {
      index: false,
      extensions: ["html"],
      dotfiles: "deny",
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-store");
      },
    })(req, res, next);
  });

  app.get("/", (req, res) => {
    const kind = hostKind(requestHostname(req));
    if (kind === "worker") return res.redirect(308, "/app/");
    if (kind === "docs") return res.redirect(308, "/docs/");
    res.redirect("/index.html");
  });

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ error: "not_found" });
    }
    return sendNotFoundPage(res);
  });

  const port = Number(env.panelPort) || 3000;
  const host = "0.0.0.0";
  const server = app.listen(port, host, () => {
    const publicUrl = env.panelPublicUrl || `http://127.0.0.1:${port}`;
    const adminUrl = env.adminPanelUrl || publicUrl;
    const docsUrl = env.manualsDocsUrl || `${publicUrl}/docs/`;
    logger.info(`Panel server listening on http://${host}:${port} → ${publicUrl}`);
    logger.info(`Admin panel: ${adminUrl}/`);
    logger.info(`Worker app: ${publicUrl}/app/`);
    logger.info(`Documentation: ${docsUrl}`);
    if (env.panelAuthDisabled) {
      logger.warn("PANEL_AUTH_DISABLED is ON — never use this on a public host");
    }
  });

  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      logger.error(`Panel port ${port} is already in use`);
      return;
    }
    logger.error("Panel server error", error);
  });

  setInterval(() => {
    const ts = Date.now();
    for (const [key, bucket] of authHits) {
      if (ts - bucket.start > AUTH_WINDOW_MS * 2) authHits.delete(key);
    }
  }, 60_000).unref?.();

  return server;
}

module.exports = { startPanelServer };
