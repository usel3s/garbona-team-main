const User = require("../models/User");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { sendOnChainPayout, SUPPORTED_AUTO_PAYOUT_METHODS } = require("./treasuryPayoutService");

/**
 * Персональные казначейские кошельки воркеров: один мастер-сид, из которого
 * детерминированно (HD, hardened-путь) выводится отдельный адрес/ключ на
 * каждого воркера в каждой поддерживаемой сети. Это кошельки, которыми
 * владеет команда (не воркер) — воркер туда доступа не имеет, это внутренняя
 * "полочка" для уже причитающихся ему денег, снятых с холда. Реальный вывод
 * воркеру на его личный внешний адрес происходит отдельно, по заявке
 * (см. withdrawalService.js).
 */

/**
 * Деривация через официальную @trustwallet/wallet-core (WASM) — та же
 * библиотека, на которой построено само приложение TrustWallet. Один
 * мастер-сид → любое число кошельков по кастомному hardened-пути на индекс.
 * secp256k1-сети (Tron/BSC) и ed25519-сети (TON) обрабатываются единым API —
 * WASM-модуль сам знает нужную кривую для каждого CoinType.
 *
 * ВНИМАНИЕ: этот блок не был исполнен в текущей среде (здесь нет Node.js) —
 * имена классов/методов (`HDWallet`, `CoinType`, `AnyAddress`,
 * `getPublicKeySecp256k1`/`getPublicKeyEd25519`) взяты из документированного
 * API wallet-core, но перед боевым использованием обязательно прогоните
 * scripts/test-release-hold.js в DRY_RUN и сверьте деривацию с реальным
 * приложением TrustWallet (импортировав ту же мнемонику на тестовом устройстве).
 */

// Tron coin type 195, BSC/EVM coin type 60, TON coin type 607 (SLIP-44), все уровни hardened.
const DERIVATION_PATHS = {
  usdt_trc20: (index) => `m/44'/195'/0'/0'/${index}'`,
  usdt_bep20: (index) => `m/44'/60'/0'/0'/${index}'`,
  ton_gram: (index) => `m/44'/607'/${index}'`,
};

// Имена значений CoinType в JS-биндингах wallet-core.
const WALLET_CORE_COIN_NAME = {
  usdt_trc20: "tron",
  usdt_bep20: "smartChain", // BNB Smart Chain (BSC)
  ton_gram: "ton",
};

let corePromise = null;
/** Единственная точка инициализации WASM-модуля — переиспользуется во всём процессе. */
function getWalletCore() {
  if (!corePromise) {
    const { initWasm } = require("@trustwallet/wallet-core");
    corePromise = initWasm();
  }
  return corePromise;
}

let hdWalletPromise = null;
async function getHDWallet() {
  if (hdWalletPromise) return hdWalletPromise;
  if (!env.treasuryMasterMnemonic) {
    throw new Error("TREASURY_MASTER_MNEMONIC не задан.");
  }
  hdWalletPromise = (async () => {
    const core = await getWalletCore();
    const { HDWallet, Mnemonic } = core;
    if (Mnemonic && typeof Mnemonic.isValid === "function") {
      if (!Mnemonic.isValid(env.treasuryMasterMnemonic)) {
        throw new Error("TREASURY_MASTER_MNEMONIC невалиден (проверьте фразу).");
      }
    }
    const wallet = HDWallet.createWithMnemonic(env.treasuryMasterMnemonic, "");
    return { core, wallet };
  })();
  try {
    return await hdWalletPromise;
  } catch (error) {
    hdWalletPromise = null; // не кэшируем провалившуюся инициализацию
    throw error;
  }
}

/**
 * Деривует приватный ключ + адрес на заданном пути через wallet-core.
 * @returns {Promise<{ address: string, privateKeyHex: string, privateKeyBytes: Uint8Array }>}
 */
async function deriveKeyAndAddress(method, index) {
  const { core, wallet } = await getHDWallet();
  const coinName = WALLET_CORE_COIN_NAME[method];
  const coin = coinName ? core.CoinType[coinName] : null;
  if (coin == null) throw new Error(`Неизвестный CoinType для метода ${method}.`);
  const pathFn = DERIVATION_PATHS[method];
  if (!pathFn) throw new Error(`Нет пути деривации для метода ${method}.`);

  const privateKey = wallet.getKey(coin, pathFn(index));
  const isEd25519 = method === "ton_gram";
  const publicKey = isEd25519
    ? privateKey.getPublicKeyEd25519()
    : privateKey.getPublicKeySecp256k1(false);
  const address = core.AnyAddress.createWithPublicKey(publicKey, coin).description();
  const privateKeyBytes = privateKey.data();
  const privateKeyHex = Buffer.from(privateKeyBytes).toString("hex");
  return { address, privateKeyHex, privateKeyBytes };
}

async function deriveWorkerAddress(index, method) {
  const { address } = await deriveKeyAndAddress(method, index);
  return address;
}

/** secp256k1 hex-ключ (Tron/BSC) на отправку — без 0x. */
async function derivePrivateKeyForSending(index, method) {
  if (method !== "usdt_trc20" && method !== "usdt_bep20") {
    throw new Error(`derivePrivateKeyForSending не поддерживает метод ${method}.`);
  }
  const { privateKeyHex } = await deriveKeyAndAddress(method, index);
  return privateKeyHex;
}

/**
 * ed25519-keyPair (TON) в формате, ожидаемом @ton/ton (`{publicKey, secretKey}`,
 * nacl-совместимый 64-байтный secretKey). wallet-core отдаёт 32-байтный
 * ed25519-сид — расширяем его тем же способом, что и сама TON-экосистема
 * (`@ton/crypto`), просто источник сида теперь wallet-core, а не ручная
 * SLIP-0010 реализация.
 */
async function deriveTonKeyPair(index) {
  const { privateKeyBytes } = await deriveKeyAndAddress("ton_gram", index);
  const seed = Buffer.from(privateKeyBytes);
  if (seed.length !== 32) {
    throw new Error(`Неожиданная длина ed25519-сида от wallet-core: ${seed.length} байт (ожидалось 32).`);
  }
  const { keyPairFromSeed } = require("@ton/crypto");
  return keyPairFromSeed(seed);
}

/** Случайный уникальный индекс деривации для нового воркера. */
async function allocateTreasuryWalletIndex() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    // 31-битный диапазон — без знака, безопасно для hardened-индекса (< 2^31).
    const candidate = Math.floor(Math.random() * 0x7fffffff) + 1;
    const taken = await User.exists({ treasuryWalletIndex: candidate });
    if (!taken) return candidate;
  }
  throw new Error("Не удалось выделить уникальный treasuryWalletIndex.");
}

/**
 * Создаёт (если ещё нет) персональный кошелёк воркера на всех поддерживаемых
 * сетях и сохраняет адреса на User. Идемпотентна — повторный вызов ничего не
 * трогает, если кошелёк уже создан.
 */
async function ensureWorkerWallet(userOrTelegramId) {
  const user =
    userOrTelegramId && typeof userOrTelegramId === "object" && userOrTelegramId.telegramId
      ? userOrTelegramId
      : await User.findOne({ telegramId: String(userOrTelegramId) });
  if (!user) return null;

  const hasAllAddresses = [...SUPPORTED_AUTO_PAYOUT_METHODS].every(
    (method) => Boolean(user.treasuryAddresses?.[method])
  );
  if (user.treasuryWalletIndex != null && hasAllAddresses) {
    return user;
  }

  if (user.treasuryWalletIndex == null) {
    user.treasuryWalletIndex = await allocateTreasuryWalletIndex();
  }
  const index = user.treasuryWalletIndex;

  const addresses = {};
  for (const method of SUPPORTED_AUTO_PAYOUT_METHODS) {
    try {
      addresses[method] = await deriveWorkerAddress(index, method);
    } catch (error) {
      logger.error("ensureWorkerWallet: derive failed", user.telegramId, method, error.message);
    }
  }
  user.treasuryAddresses = { ...(user.treasuryAddresses?.toObject?.() || user.treasuryAddresses || {}), ...addresses };
  await user.save();
  return user;
}

/** Перевод "казна → персональный кошелёк воркера". */
async function sendFromTreasury({ method, toAddress, amountUsd }) {
  // В dry-run режиме sendOnChainPayout не трогает ключ вовсе — не требуем его
  // здесь, чтобы можно было проверить всю цепочку без единого реального секрета.
  if (method === "ton_gram") {
    const privateKey = env.treasuryPayoutDryRun ? "" : env.treasuryTonMnemonic;
    if (!env.treasuryPayoutDryRun && !privateKey) {
      throw new Error("TREASURY_TON_MNEMONIC не задан.");
    }
    return sendOnChainPayout({ method, privateKey, toAddress, amountUsd });
  }
  const privateKey = env.treasuryPayoutDryRun
    ? ""
    : method === "usdt_trc20"
      ? env.treasuryTronPrivateKey
      : env.treasuryBscPrivateKey;
  if (!env.treasuryPayoutDryRun && !privateKey) {
    throw new Error(`Нет мастер-ключа казны для метода ${method}.`);
  }
  return sendOnChainPayout({ method, privateKey, toAddress, amountUsd });
}

/**
 * Перевод "персональный кошелёк воркера → внешний адрес" — подписывается
 * дочерним ключом этого воркера, вызывается только при одобрении заявки на
 * вывод админом (ручной гейт сохранён).
 */
async function sendFromWorkerWallet({ user, method, toAddress, amountUsd }) {
  if (user.treasuryWalletIndex == null) {
    throw new Error("У воркера ещё нет персонального казначейского кошелька.");
  }
  const index = user.treasuryWalletIndex;

  if (method === "ton_gram") {
    if (env.treasuryPayoutDryRun) {
      return sendOnChainPayout({ method, privateKey: "", toAddress, amountUsd });
    }
    // TON требует отдельного пути отправки: подписываем через выведенный keyPair,
    // а не через мнемонику (у дочернего кошелька мнемоники нет). sendOnChainPayout
    // здесь не задействован, поэтому валидацию адреса дублируем явно.
    const { validateWalletAddress } = require("./withdrawalService");
    const check = validateWalletAddress(method, toAddress);
    if (!check.ok) throw new Error(`Некорректный адрес получателя (${method}): ${check.error}`);
    const { TonClient, internal, toNano } = require("@ton/ton");
    const { WalletContractV4 } = require("@ton/ton");
    const { getUsdTonRate } = require("./treasuryPayoutService");
    const keyPair = await deriveTonKeyPair(index);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    const client = new TonClient({
      endpoint: env.treasuryTonApiEndpoint,
      apiKey: env.treasuryTonApiKey || undefined,
    });
    const contract = client.open(wallet);
    const seqno = await contract.getSeqno();
    const rate = await getUsdTonRate();
    const tonAmount = Number(amountUsd) / rate;
    await contract.sendTransfer({
      secretKey: keyPair.secretKey,
      seqno,
      messages: [internal({ to: check.address, value: toNano(tonAmount.toFixed(9)), body: "Garbona payout", bounce: false })],
    });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      if ((await contract.getSeqno()) > seqno) {
        const txId = `${wallet.address.toString()}:${seqno}`;
        return { txId, explorerUrl: `https://tonscan.org/address/${wallet.address.toString()}` };
      }
    }
    throw new Error("TON: перевод отправлен, но подтверждение seqno не получено вовремя.");
  }

  const privateKey = env.treasuryPayoutDryRun ? "" : await derivePrivateKeyForSending(index, method);
  return sendOnChainPayout({ method, privateKey, toAddress, amountUsd });
}

/**
 * Пытается автоматически подписать и отправить уже одобренную заявку на вывод
 * с персонального казначейского кошелька воркера — без ручной вставки ссылки
 * админом. Ручной гейт "админ нажал одобрить" остаётся; меняется только то,
 * что происходит дальше. При любой невозможности (неподдерживаемый метод,
 * не хватает средств на персональном кошельке, ошибка отправки) — возвращает
 * { ok: false }, и вызывающий код падает обратно на существующий ручной
 * флоу (запрос ссылки у админа), ничего не ломая.
 */
async function tryAutoSignWithdrawal(requestId, adminTelegramId) {
  const WithdrawalRequest = require("../models/WithdrawalRequest");
  const {
    calcPayoutBreakdown,
    completePayoutWithLink,
    setAwaitingPayoutLink,
    resetPendingApproval,
  } = require("./withdrawalService");
  const { SUPPORTED_AUTO_PAYOUT_METHODS } = require("./treasuryPayoutService");

  const request = await WithdrawalRequest.findOne({ _id: requestId, status: "pending" });
  if (!request) return { ok: false };
  if (!SUPPORTED_AUTO_PAYOUT_METHODS.has(request.method)) return { ok: false };

  const user = await User.findById(request.userId);
  if (!user || user.treasuryWalletIndex == null) return { ok: false };

  const { payoutAmount } = calcPayoutBreakdown(request.amountUsd, request.method);
  const available = Number(user.treasuryWalletBalanceUsd?.[request.method] || 0);
  if (!(payoutAmount > 0) || available < payoutAmount) return { ok: false };

  // Атомарно переводит pending → awaiting_payout_link (та же точка входа, что и
  // в ручном флоу) — это и клейм от повторного клика/гонки, и обязательное
  // условие для completePayoutWithLink ниже.
  const claimed = await setAwaitingPayoutLink(request._id, adminTelegramId, {
    note: "Авто-подпись с персонального кошелька",
  });
  if (!claimed) return { ok: false };

  let sent;
  try {
    sent = await sendFromWorkerWallet({
      user,
      method: request.method,
      toAddress: request.walletAddress,
      amountUsd: payoutAmount,
    });
  } catch (error) {
    logger.error("tryAutoSignWithdrawal: send failed", String(request._id), error.message);
    // Откатываем обратно в pending, чтобы вызывающий код мог упасть на ручной флоу.
    await resetPendingApproval(request._id, {
      actorTelegramId: String(adminTelegramId),
      note: "Авто-отправка не удалась, возврат в очередь",
    });
    return { ok: false };
  }

  await User.updateOne(
    { _id: user._id, [`treasuryWalletBalanceUsd.${request.method}`]: { $gte: payoutAmount } },
    { $inc: { [`treasuryWalletBalanceUsd.${request.method}`]: -payoutAmount } }
  );

  const explorerUrl = sent.explorerUrl || "";
  const linkForRecord = explorerUrl || `https://tx.local/${sent.txId}`;
  const { request: completed } = await completePayoutWithLink(
    request._id,
    linkForRecord,
    adminTelegramId,
    { note: "Авто-подпись с персонального кошелька" }
  );
  await WithdrawalRequest.updateOne(
    { _id: completed._id },
    { $set: { txId: sent.txId, autoSigned: true } }
  );
  completed.txId = sent.txId;
  completed.autoSigned = true;
  return { ok: true, request: completed };
}

module.exports = {
  deriveWorkerAddress,
  ensureWorkerWallet,
  allocateTreasuryWalletIndex,
  sendFromTreasury,
  sendFromWorkerWallet,
  tryAutoSignWithdrawal,
};
