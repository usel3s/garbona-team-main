const crypto = require("crypto");

/** In-memory login abuse protection (per process). */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_IP = 12;
const MAX_ATTEMPTS_USER = 8;
const LOCK_MS = 15 * 60 * 1000;
const MIN_FAIL_DELAY_MS = 250;
const MAX_FAIL_DELAY_MS = 1200;

const byIp = new Map();
const byUser = new Map();

function now() {
  return Date.now();
}

function pruneBucket(bucket, ts) {
  if (!bucket) return null;
  if (ts - bucket.windowStart > WINDOW_MS) {
    return { windowStart: ts, fails: 0, lockUntil: 0 };
  }
  return bucket;
}

function getBucket(map, key, ts) {
  const next = pruneBucket(map.get(key), ts) || {
    windowStart: ts,
    fails: 0,
    lockUntil: 0,
  };
  map.set(key, next);
  return next;
}

function isLocked(bucket, ts) {
  return Boolean(bucket?.lockUntil && bucket.lockUntil > ts);
}

function lockSecondsLeft(bucket, ts) {
  if (!isLocked(bucket, ts)) return 0;
  return Math.ceil((bucket.lockUntil - ts) / 1000);
}

function inspectLoginAttempt(ip, username) {
  const ts = now();
  const ipKey = String(ip || "unknown");
  const userKey = String(username || "").trim().toLowerCase() || "_";
  const ipBucket = getBucket(byIp, ipKey, ts);
  const userBucket = getBucket(byUser, userKey, ts);

  if (isLocked(ipBucket, ts) || isLocked(userBucket, ts)) {
    const seconds = Math.max(
      lockSecondsLeft(ipBucket, ts),
      lockSecondsLeft(userBucket, ts)
    );
    return { ok: false, error: "too_many_attempts", retryAfterSec: seconds };
  }
  return { ok: true };
}

function registerLoginFailure(ip, username) {
  const ts = now();
  const ipKey = String(ip || "unknown");
  const userKey = String(username || "").trim().toLowerCase() || "_";
  const ipBucket = getBucket(byIp, ipKey, ts);
  const userBucket = getBucket(byUser, userKey, ts);

  ipBucket.fails += 1;
  userBucket.fails += 1;

  if (ipBucket.fails >= MAX_ATTEMPTS_IP) {
    ipBucket.lockUntil = ts + LOCK_MS;
  }
  if (userBucket.fails >= MAX_ATTEMPTS_USER) {
    userBucket.lockUntil = ts + LOCK_MS;
  }

  const severity = Math.max(ipBucket.fails, userBucket.fails);
  const delay = Math.min(
    MAX_FAIL_DELAY_MS,
    MIN_FAIL_DELAY_MS + severity * 80 + crypto.randomInt(0, 120)
  );
  return { delayMs: delay, retryAfterSec: Math.max(lockSecondsLeft(ipBucket, ts), lockSecondsLeft(userBucket, ts)) };
}

function registerLoginSuccess(ip, username) {
  const ipKey = String(ip || "unknown");
  const userKey = String(username || "").trim().toLowerCase() || "_";
  byIp.delete(ipKey);
  byUser.delete(userKey);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

setInterval(() => {
  const ts = now();
  for (const [key, bucket] of byIp) {
    if (ts - bucket.windowStart > WINDOW_MS * 2 && (!bucket.lockUntil || bucket.lockUntil < ts)) {
      byIp.delete(key);
    }
  }
  for (const [key, bucket] of byUser) {
    if (ts - bucket.windowStart > WINDOW_MS * 2 && (!bucket.lockUntil || bucket.lockUntil < ts)) {
      byUser.delete(key);
    }
  }
}, 60_000).unref?.();

module.exports = {
  inspectLoginAttempt,
  registerLoginFailure,
  registerLoginSuccess,
  sleep,
};
