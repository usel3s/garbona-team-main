const User = require("../models/User");
const WalletTransfer = require("../models/WalletTransfer");
const ProfitTransaction = require("../models/ProfitTransaction");
const { getAvailableUsd, sumReservedUsd } = require("./withdrawalService");
const { creditWalletBalanceUsd, CREDIT_KINDS } = require("./profitService");
const mongoose = require("mongoose");

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAmountUsd(amountUsd) {
  const amount = Math.round(Number(amountUsd) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0.01) {
    throw new Error("Сумма должна быть числом не меньше 0.01.");
  }
  return amount;
}

function recipientDisplay(user) {
  if (!user) return null;
  const username = String(user.username || "").trim();
  const customId = String(user.customId || "").trim();
  const firstName = String(user.firstName || "").trim();
  return {
    telegramId: String(user.telegramId),
    username,
    customId,
    firstName,
    displayName:
      (username ? `@${username}` : "") ||
      customId ||
      firstName ||
      String(user.telegramId),
  };
}

/**
 * Ищет воркера по telegramId / @username / customId / panelUsername.
 */
async function findWorkerRecipient(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const q = raw.replace(/^@/, "");
  if (!q) return null;

  const base = { isTeamMember: true, isBanned: { $ne: true } };

  if (/^\d+$/.test(q)) {
    const byId = await User.findOne({ ...base, telegramId: q });
    if (byId) return byId;
  }

  const exact = new RegExp(`^${escapeRegex(q)}$`, "i");
  const byCustomId = await User.findOne({ ...base, customId: exact });
  if (byCustomId) return byCustomId;

  const byUsername = await User.findOne({ ...base, username: exact });
  if (byUsername) return byUsername;

  const byPanel = await User.findOne({ ...base, panelUsername: exact });
  if (byPanel) return byPanel;

  return null;
}

async function lookupWorkerRecipient(query) {
  const user = await findWorkerRecipient(query);
  if (!user) return null;
  return recipientDisplay(user);
}

/**
 * Перевод доступного баланса между воркерами.
 * Списание атомарно; зачисление получателя через creditWalletBalanceUsd (история начислений).
 */
async function transferWalletBalance(fromUser, recipientQuery, amountUsd) {
  const amount = normalizeAmountUsd(amountUsd);
  const recipient = await findWorkerRecipient(recipientQuery);
  if (!recipient) {
    throw new Error("Получатель не найден или не является воркером.");
  }
  if (String(recipient.telegramId) === String(fromUser.telegramId)) {
    throw new Error("Нельзя перевести средства самому себе.");
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      // Same availability rule as getAvailableUsd / withdrawals.
      const sender = await User.findOneAndUpdate(
        {
          _id: fromUser._id,
          isTeamMember: true,
          isBanned: { $ne: true },
          $expr: {
            $gte: [
              {
                $subtract: [
                  "$totalProfit",
                  {
                    $add: [
                      { $ifNull: ["$reservedWithdrawalUsd", 0] },
                      { $ifNull: ["$frozenSaleUsd", 0] },
                    ],
                  },
                ],
              },
              amount,
            ],
          },
        },
        { $inc: { totalProfit: -amount } },
        { new: true, session }
      );
      if (!sender) {
        throw new Error("Недостаточно средств с учётом холда продаж и активных заявок на вывод.");
      }
      const creditResult = await creditWalletBalanceUsd(recipient.telegramId, amount, {
        filter: { _id: recipient._id, isTeamMember: true, isBanned: { $ne: true } },
        kind: CREDIT_KINDS.TRANSFER_IN,
        actorTelegramId: String(sender.telegramId),
        counterpartyTelegramId: String(sender.telegramId),
        counterpartyUsername: sender.username || "",
        note: "Перевод от воркера",
        notFoundError: "Получатель не найден или не является воркером.",
        session,
      });
      const rows = await WalletTransfer.create([{
        fromUserId: sender._id, fromTelegramId: String(sender.telegramId), fromUsername: sender.username || "",
        toUserId: recipient._id, toTelegramId: String(recipient.telegramId), toUsername: recipient.username || "", amountUsd: amount,
      }], { session });
      result = { transfer: rows[0], sender, recipient: creditResult.user, amountUsd: amount };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function listUserTransfers(telegramId, limit = 20, skip = 0) {
  const tid = String(telegramId);
  return WalletTransfer.find({
    $or: [{ fromTelegramId: tid }, { toTelegramId: tid }],
  })
    .sort({ createdAt: -1 })
    .skip(Math.max(0, Number(skip) || 0))
    .limit(limit)
    .lean();
}

async function countUserTransfers(telegramId) {
  const tid = String(telegramId);
  return WalletTransfer.countDocuments({
    $or: [{ fromTelegramId: tid }, { toTelegramId: tid }],
  });
}

function serializeTransferForUser(row, telegramId) {
  const tid = String(telegramId);
  const outgoing = String(row.fromTelegramId) === tid;
  const peerUsername = outgoing ? row.toUsername : row.fromUsername;
  const peerTelegramId = outgoing ? row.toTelegramId : row.fromTelegramId;
  return {
    id: String(row._id || ""),
    createdAt: row.createdAt || null,
    amountUsd: Number(row.amountUsd || 0),
    direction: outgoing ? "out" : "in",
    peerTelegramId: String(peerTelegramId || ""),
    peerUsername: String(peerUsername || ""),
    type: "transfer",
  };
}

module.exports = {
  findWorkerRecipient,
  lookupWorkerRecipient,
  transferWalletBalance,
  listUserTransfers,
  countUserTransfers,
  serializeTransferForUser,
  recipientDisplay,
  normalizeAmountUsd,
};
