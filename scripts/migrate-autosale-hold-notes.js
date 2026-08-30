/**
 * One-off: rewrite ProfitTransaction notes with outdated auto-sale copy.
 *
 * Usage:
 *   node scripts/migrate-autosale-hold-notes.js
 *   node scripts/migrate-autosale-hold-notes.js --dry-run
 *   node scripts/migrate-autosale-hold-notes.js --user 8640471725
 */
const mongoose = require("mongoose");
const { validateEnv } = require("../src/config/env");
const { connectDatabase } = require("../src/config/db");
const ProfitTransaction = require("../src/models/ProfitTransaction");
const SteamLog = require("../src/models/SteamLog");
const User = require("../src/models/User");
const {
  autoSaleHoldSoldNote,
  AUTO_SALE_HOLD_RELEASED_NOTE,
} = require("../src/services/autoLogSaleService");

const CANONICAL_HOLD_SOLD = /^Ваш лог был успешно продан, средства начислены и заморожены на \d+[чмд]\.$/;

/** Old note prefixes — no \\b after Cyrillic (JS word boundary is ASCII-only). */
const OLD_PATTERNS = {
  lzt_hold: /^Автопродажа LZT холд/,
  lzt_any: /^Автопродажа LZT/,
  released: /^Ваш лог продан · холд снят/,
  hold_sold_and: /^Ваш лог был успешно продан и средства начислены и заморожены на /,
  hold_sold_short: /^Ваш лог был успешно продан \d+[чмд]/,
};

const FIND_OR = Object.values(OLD_PATTERNS).map((pattern) => ({ note: { $regex: pattern } }));

function parseArgs(argv) {
  const args = { dryRun: false, userTelegramId: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--user" && argv[i + 1]) {
      args.userTelegramId = String(argv[++i]).trim();
    }
  }
  return args;
}

function durationFromNote(note) {
  const text = String(note || "");
  const patterns = [
    /заморожены на (\d+[чмд])/i,
    /^Ваш лог был успешно продан (\d+[чмд])/i,
    /(\d+)\s*час/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

async function resolveHoldSoldNote(tx) {
  const log = await SteamLog.findOne({ autoSaleProfitTxId: String(tx._id) })
    .select("autoSaleHoldDurationPhrase")
    .lean();
  const fromLog = log?.autoSaleHoldDurationPhrase;
  if (fromLog) return autoSaleHoldSoldNote(fromLog);
  return autoSaleHoldSoldNote(durationFromNote(tx.note));
}

function classifyNote(note) {
  const text = String(note || "").trim();
  if (!text || text === AUTO_SALE_HOLD_RELEASED_NOTE) return null;
  if (CANONICAL_HOLD_SOLD.test(text)) return null;

  if (OLD_PATTERNS.lzt_hold.test(text) || OLD_PATTERNS.hold_sold_and.test(text) || OLD_PATTERNS.hold_sold_short.test(text)) {
    return "hold_sold";
  }
  if (OLD_PATTERNS.released.test(text) || OLD_PATTERNS.lzt_any.test(text)) {
    return "released";
  }
  return null;
}

async function countOldNotes(extraFilter = {}) {
  const counts = {};
  for (const [key, pattern] of Object.entries(OLD_PATTERNS)) {
    counts[key] = await ProfitTransaction.countDocuments({
      ...extraFilter,
      note: { $regex: pattern },
    });
  }
  return counts;
}

async function sampleForUser(telegramId, limit = 20) {
  const user = await User.findOne({ telegramId: String(telegramId) }).select("_id telegramId username").lean();
  if (!user) return { user: null, rows: [] };

  const rows = await ProfitTransaction.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("note createdAt amount workerShare")
    .lean();

  return {
    user: { telegramId: user.telegramId, username: user.username },
    rows: rows.map((row) => ({
      id: String(row._id),
      note: row.note,
      kind: classifyNote(row.note),
      createdAt: row.createdAt,
      amount: row.amount,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  validateEnv();
  await connectDatabase();

  const beforeCounts = await countOldNotes();
  const beforeTotal = await ProfitTransaction.countDocuments({ $or: FIND_OR });

  const rows = await ProfitTransaction.find({ $or: FIND_OR })
    .select("_id note userId")
    .lean();

  let updated = 0;
  let skipped = 0;
  const byKind = { hold_sold: 0, released: 0 };
  const samples = [];

  for (const tx of rows) {
    const note = String(tx.note || "").trim();
    const kind = classifyNote(note);
    if (!kind) {
      skipped += 1;
      continue;
    }

    const nextNote =
      kind === "hold_sold" ? await resolveHoldSoldNote(tx) : AUTO_SALE_HOLD_RELEASED_NOTE;

    if (note === nextNote) {
      skipped += 1;
      continue;
    }

    if (samples.length < 8) {
      samples.push({ id: String(tx._id), kind, from: note, to: nextNote });
    }

    if (!args.dryRun) {
      await ProfitTransaction.updateOne({ _id: tx._id }, { $set: { note: nextNote } });
    }
    updated += 1;
    byKind[kind] += 1;
  }

  const afterTotal = args.dryRun
    ? beforeTotal - updated
    : await ProfitTransaction.countDocuments({ $or: FIND_OR });

  const summary = {
    dryRun: args.dryRun,
    before: { matched: beforeTotal, byPattern: beforeCounts },
    after: { matched: afterTotal },
    updated,
    skipped,
    byKind,
    releasedNote: AUTO_SALE_HOLD_RELEASED_NOTE,
    holdSoldExample: autoSaleHoldSoldNote("12ч"),
    samples,
  };

  if (args.userTelegramId) {
    summary.userSample = await sampleForUser(args.userTelegramId, 25);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
