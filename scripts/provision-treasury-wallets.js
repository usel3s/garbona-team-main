#!/usr/bin/env node

/**
 * Provision deterministic treasury addresses for existing team members.
 *
 * Safe by default: without --apply it only lists the affected users.
 * This script never sends an on-chain transaction and never prints private keys.
 *
 * Examples:
 *   node scripts/provision-treasury-wallets.js
 *   node scripts/provision-treasury-wallets.js --telegram-id=123456789 --apply
 *   node scripts/provision-treasury-wallets.js --limit=5 --apply
 *   node scripts/provision-treasury-wallets.js --apply
 */

const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const User = require("../src/models/User");
const {
  ensureWorkerWallet,
} = require("../src/services/treasuryWalletService");

function argValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : "";
}

function workerLabel(user) {
  const username = String(user.username || "").trim();
  const firstName = String(user.firstName || "").trim();
  const parts = [];
  if (username) parts.push(`@${username.replace(/^@/, "")}`);
  if (firstName) parts.push(firstName);
  return parts.join(" / ") || `telegram:${user.telegramId}`;
}

function hasAllAddresses(user) {
  return Boolean(
    user.treasuryWalletIndex != null &&
      user.treasuryAddresses?.usdt_trc20 &&
      user.treasuryAddresses?.usdt_bep20 &&
      user.treasuryAddresses?.ton_gram
  );
}

function publicWalletRow(user) {
  return {
    worker: workerLabel(user),
    telegramId: String(user.telegramId),
    walletIndex: user.treasuryWalletIndex ?? "",
    trc20: user.treasuryAddresses?.usdt_trc20 || "",
    bep20: user.treasuryAddresses?.usdt_bep20 || "",
    ton: user.treasuryAddresses?.ton_gram || "",
  };
}

async function validateMasterMnemonic() {
  const mnemonic = String(env.treasuryMasterMnemonic || "").trim();
  if (!mnemonic || /CHANGE_ME/i.test(mnemonic)) {
    throw new Error(
      "Сначала задайте настоящую TREASURY_MASTER_MNEMONIC в .env (сейчас пусто или CHANGE_ME)."
    );
  }

  const { initWasm } = require("@trustwallet/wallet-core");
  const core = await initWasm();
  if (core.Mnemonic?.isValid && !core.Mnemonic.isValid(mnemonic)) {
    throw new Error("TREASURY_MASTER_MNEMONIC не является валидной BIP39-фразой.");
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const telegramId = argValue("--telegram-id");
  const rawLimit = argValue("--limit");
  const limit = rawLimit ? Number(rawLimit) : 0;

  if (rawLimit && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("--limit должен быть положительным целым числом.");
  }
  if (!env.mongoUri) throw new Error("MONGO_URI не задан.");

  const filter = telegramId
    ? { telegramId: String(telegramId), isTeamMember: true }
    : { isTeamMember: true };

  await mongoose.connect(env.mongoUri);
  let query = User.find(filter)
    .select(
      "telegramId username firstName isBanned treasuryWalletIndex treasuryAddresses"
    )
    .sort({ username: 1, telegramId: 1 });
  if (limit) query = query.limit(limit);
  const users = await query;

  const missing = users.filter((user) => !hasAllAddresses(user));
  console.log(
    `Найдено воркеров: ${users.length}; уже готовы: ${users.length - missing.length}; требуется создать/дозаполнить: ${missing.length}.`
  );

  if (!apply) {
    console.table(
      users.map((user) => ({
        worker: workerLabel(user),
        telegramId: String(user.telegramId),
        banned: user.isBanned ? "yes" : "no",
        status: hasAllAddresses(user) ? "ready" : "missing",
      }))
    );
    console.log("Предпросмотр завершён. Для записи добавьте --apply.");
    return;
  }

  await validateMasterMnemonic();
  const completed = [];
  const failed = [];

  // Sequential processing avoids racing the random wallet-index allocator.
  for (const user of missing) {
    try {
      const updated = await ensureWorkerWallet(user);
      if (!hasAllAddresses(updated)) {
        throw new Error("не удалось получить адреса всех поддерживаемых сетей");
      }
      completed.push(publicWalletRow(updated));
      console.log(`OK ${workerLabel(updated)}`);
    } catch (error) {
      failed.push({
        worker: workerLabel(user),
        telegramId: String(user.telegramId),
        error: String(error?.message || error),
      });
      console.error(`ERROR ${workerLabel(user)}: ${error.message}`);
    }
  }

  if (completed.length) {
    console.log("Созданные публичные адреса:");
    console.table(completed);
  }
  if (failed.length) {
    console.log("Ошибки:");
    console.table(failed);
  }

  console.log(
    `Готово: создано/дозаполнено ${completed.length}, ошибок ${failed.length}, без изменений ${users.length - missing.length}.`
  );
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });

