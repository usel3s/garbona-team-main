const crypto = require("crypto");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");

/**
 * Единственное место в коде, которое трогает приватные ключи сетей и шлёт
 * on-chain транзакции. Всё остальное (autoLogSaleService, withdrawalService,
 * treasuryWalletService) работает через `sendOnChainPayout` как через чёрный
 * ящик и никогда не видит ключи.
 *
 * ВАЖНО: сюда никогда не логируется приватный ключ/мнемоника/сырая подписанная
 * транзакция — только метод/адрес/сумма/итоговый хэш.
 */

const SUPPORTED_AUTO_PAYOUT_METHODS = new Set(["usdt_trc20", "usdt_bep20", "ton_gram"]);

class UnsupportedPayoutMethodError extends Error {
  constructor(method) {
    super(`Метод "${method}" не поддерживается для автоматической on-chain отправки.`);
    this.code = "UNSUPPORTED_METHOD";
    this.method = method;
  }
}

function dryRunTxId() {
  return `DRYRUN-${crypto.randomBytes(8).toString("hex")}`;
}

// ── Tron (USDT TRC20) ────────────────────────────────────────────────────────

/**
 * Новый лёгкий клиент на каждый вызов, БЕЗ приватного ключа в конструкторе.
 * Разные вызовы подписывают разными ключами (казна vs. дочерний ключ воркера) —
 * закешированный инстанс с ключом, зашитым в конструктор, тихо продолжил бы
 * подписывать первым переданным ключом при всех последующих вызовах.
 * privateKey передаётся явно в fromPrivateKey/trx.sign ниже на каждый вызов.
 */
function getTronWeb() {
  const { TronWeb } = require("tronweb");
  return new TronWeb({
    fullHost: env.treasuryTronFullHost,
    headers: env.treasuryTronApiKey ? { "TRON-PRO-API-KEY": env.treasuryTronApiKey } : undefined,
  });
}

async function sendUsdtTrc20(privateKey, toAddress, amountUsd) {
  const tronWeb = getTronWeb();
  // USDT TRC20 — 6 знаков после запятой.
  const tokenAmount = Math.round(Number(amountUsd) * 1e6);
  if (!(tokenAmount > 0)) throw new Error("Сумма перевода TRC20 должна быть больше нуля.");

  const fromAddress = tronWeb.address.fromPrivateKey(privateKey);
  const { transaction } = await tronWeb.transactionBuilder.triggerSmartContract(
    env.treasuryTronUsdtContract,
    "transfer(address,uint256)",
    { feeLimit: 30_000_000 },
    [
      { type: "address", value: toAddress },
      { type: "uint256", value: tokenAmount },
    ],
    fromAddress
  );
  const signed = await tronWeb.trx.sign(transaction.transaction, privateKey);
  const txId = signed.txID;
  const receipt = await tronWeb.trx.sendRawTransaction(signed);
  if (receipt?.result !== true && receipt?.code) {
    // Транзакция могла всё же уйти в сеть — txId уже известен для последующей сверки.
    throw new Error(`Tron broadcast error: ${receipt.code} ${receipt.message || ""} (txId=${txId})`);
  }
  return { txId, explorerUrl: `https://tronscan.org/#/transaction/${txId}` };
}

// ── BSC (USDT BEP20, EVM) ────────────────────────────────────────────────────

const ERC20_TRANSFER_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];

async function sendUsdtBep20(privateKey, toAddress, amountUsd) {
  const { ethers } = require("ethers");
  const provider = new ethers.JsonRpcProvider(env.treasuryBscRpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(env.treasuryBscUsdtContract, ERC20_TRANSFER_ABI, wallet);
  // Binance-Peg USDT — 18 знаков после запятой.
  const tokenAmount = ethers.parseUnits(Number(amountUsd).toFixed(6), 18);
  if (tokenAmount <= 0n) throw new Error("Сумма перевода BEP20 должна быть больше нуля.");

  const tx = await contract.transfer(toAddress, tokenAmount);
  const receipt = await tx.wait(1);
  if (receipt?.status !== 1) {
    throw new Error(`BSC tx failed on-chain (txId=${tx.hash})`);
  }
  return { txId: tx.hash, explorerUrl: `https://bscscan.com/tx/${tx.hash}` };
}

// ── TON (нативный) ───────────────────────────────────────────────────────────

let cachedUsdTonRate = null;
let cachedUsdTonRateAt = 0;

async function getUsdTonRate() {
  const now = Date.now();
  if (cachedUsdTonRate && now - cachedUsdTonRateAt < env.usdTonPriceCacheMs) {
    return cachedUsdTonRate;
  }
  const { getUsdTonRate: getStoredRate } = require("./settingsService");
  const rate = await getStoredRate();
  if (rate > 0) {
    cachedUsdTonRate = rate;
    cachedUsdTonRateAt = now;
    return rate;
  }
  throw new Error("Не удалось получить курс USD/TON.");
}

async function sendTonNative(mnemonic, toAddress, amountUsd) {
  const { TonClient, WalletContractV4, internal, toNano } = require("@ton/ton");
  const { mnemonicToPrivateKey } = require("@ton/crypto");

  const rate = await getUsdTonRate();
  const tonAmount = Number(amountUsd) / rate;
  if (!(tonAmount > 0)) throw new Error("Сумма перевода TON должна быть больше нуля.");

  const keyPair = await mnemonicToPrivateKey(mnemonic.split(" "));
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
  const client = new TonClient({
    endpoint: env.treasuryTonApiEndpoint,
    apiKey: env.treasuryTonApiKey || undefined,
  });
  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();

  await contract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [
      internal({
        to: toAddress,
        value: toNano(tonAmount.toFixed(9)),
        body: "Garbona payout",
        bounce: false,
      }),
    ],
  });

  // TON не возвращает хэш синхронно из sendTransfer — ждём инкремента seqno
  // как подтверждения, что сообщение принято сетью.
  const deadline = Date.now() + 60_000;
  let confirmed = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const next = await contract.getSeqno();
    if (next > seqno) {
      confirmed = true;
      break;
    }
  }
  if (!confirmed) {
    throw new Error("TON: перевод отправлен, но подтверждение seqno не получено вовремя — проверьте вручную.");
  }
  const txId = `${wallet.address.toString()}:${seqno}`;
  return { txId, explorerUrl: `https://tonscan.org/address/${wallet.address.toString()}` };
}

/**
 * @param {{ method: string, privateKey: string, toAddress: string, amountUsd: number }} params
 * @returns {Promise<{ txId: string, explorerUrl: string, dryRun?: boolean }>}
 */
async function sendOnChainPayout({ method, privateKey, toAddress, amountUsd }) {
  if (!SUPPORTED_AUTO_PAYOUT_METHODS.has(method)) {
    throw new UnsupportedPayoutMethodError(method);
  }
  const { validateWalletAddress } = require("./withdrawalService");
  const check = validateWalletAddress(method, toAddress);
  if (!check.ok) {
    throw new Error(`Некорректный адрес получателя (${method}): ${check.error}`);
  }
  const amount = Number(amountUsd);
  if (!(amount > 0)) throw new Error("Сумма выплаты должна быть больше нуля.");

  if (env.treasuryPayoutDryRun) {
    logger.info(
      "[treasuryPayoutService] DRY RUN",
      `method=${method}`,
      `to=${check.address}`,
      `amountUsd=${amount}`
    );
    return { txId: dryRunTxId(), explorerUrl: "", dryRun: true };
  }

  if (!privateKey) {
    throw new Error(`Нет приватного ключа для отправки методом ${method}.`);
  }

  logger.info(
    "[treasuryPayoutService] sending",
    `method=${method}`,
    `to=${check.address}`,
    `amountUsd=${amount}`
  );

  if (method === "usdt_trc20") return sendUsdtTrc20(privateKey, check.address, amount);
  if (method === "usdt_bep20") return sendUsdtBep20(privateKey, check.address, amount);
  if (method === "ton_gram") return sendTonNative(privateKey, check.address, amount);
  throw new UnsupportedPayoutMethodError(method);
}

module.exports = {
  SUPPORTED_AUTO_PAYOUT_METHODS,
  UnsupportedPayoutMethodError,
  sendOnChainPayout,
  getUsdTonRate,
};
