const { Markup } = require("telegraf");
const { pe, btn } = require("../utils/emoji");
const { upsertBotMessage } = require("../utils/message");
const { ensureUser } = require("../services/userService");
const {
  parseTelegramStartPayload,
  getOpenSession,
  getPublicSession,
  completeVerification,
  DiscordVerifyError,
  displayDiscordName,
  canVerifyUser,
} = require("../services/discordVerifyService");
const { finalizeVerification } = require("../discord/guild");
const { logger } = require("../utils/logger");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isDiscordStartPayload(payload) {
  return Boolean(parseTelegramStartPayload(payload));
}

function discordConfirmKeyboard(token) {
  return Markup.inlineKeyboard([
    [
      btn("Подтвердить", `dsc:ok:${token}`, "success"),
      btn("Отмена", `dsc:no:${token}`, "error"),
    ],
  ]);
}

function discordDoneKeyboard() {
  return Markup.inlineKeyboard([[btn("В главное меню", "menu:home", "home")]]);
}

function sessionCardHtml(session, user, { replacing = false } = {}) {
  const discordName = escapeHtml(displayDiscordName(session));
  const discordUser = session.discordUsername
    ? ` (@${escapeHtml(session.discordUsername)})`
    : "";
  const tg = user.username
    ? `@${escapeHtml(user.username)}`
    : escapeHtml(user.firstName || user.telegramId);

  const lines = [
    `${pe("userVerified")} <b>Подтверждение Discord</b>`,
    "",
    `${pe("profile")} Discord: <b>${discordName}</b>${discordUser}`,
    `${pe("bot")} Garbona: <b>${tg}</b>`,
    "",
    "Нажми «Подтвердить», чтобы связать аккаунты и получить доступ на сервере.",
  ];
  if (replacing) {
    lines.push(
      "",
      `${pe("info")} Текущая привязка Discord будет заменена.`
    );
  }
  return lines.join("\n");
}

async function handleDiscordStartPayload(ctx, payload) {
  const token = parseTelegramStartPayload(payload);
  if (!token) return false;

  const user = await ensureUser(ctx.from);
  if (user.isBanned) {
    await upsertBotMessage(
      ctx,
      `${pe("userBlocked")} Ты заблокирован. Доступ ограничен.`
    );
    return true;
  }

  if (!canVerifyUser(user)) {
    await upsertBotMessage(
      ctx,
      [
        `${pe("lock")} Верификация Discord доступна только участникам команды.`,
        "",
        "Подай заявку в боте, и после принятия сможешь подтвердить Discord.",
      ].join("\n"),
      { reply_markup: discordDoneKeyboard().reply_markup }
    );
    return true;
  }

  const session = await getOpenSession(token);
  if (!session) {
    const publicSession = await getPublicSession(token);
    const reason =
      publicSession?.status === "consumed"
        ? "Эта ссылка уже использована."
        : "Ссылка устарела. Нажми «Подтвердить» в Discord ещё раз.";
    await upsertBotMessage(ctx, `${pe("error")} ${reason}`, {
      reply_markup: discordDoneKeyboard().reply_markup,
    });
    return true;
  }

  const replacing = Boolean(user.discordId && user.discordId !== session.discordId);
  await upsertBotMessage(ctx, sessionCardHtml(session, user, { replacing }), {
    reply_markup: discordConfirmKeyboard(token).reply_markup,
  });
  return true;
}

function registerDiscordVerifyHandlers(bot) {
  bot.action(/^dsc:ok:([A-Za-z0-9_-]{16,64})$/, async (ctx) => {
    await ctx.answerCbQuery();
    const token = ctx.match[1];
    const user = await ensureUser(ctx.from);
    try {
      const result = await completeVerification({
        token,
        user,
        method: "telegram",
      });
      await finalizeVerification(result);
      const name = escapeHtml(displayDiscordName(result.session));
      await upsertBotMessage(
        ctx,
        [
          `${pe("success")} <b>Discord подтверждён</b>`,
          "",
          `Аккаунт <b>${name}</b> связан с Garbona.`,
          "Роль на сервере выдана.",
        ].join("\n"),
        { reply_markup: discordDoneKeyboard().reply_markup }
      );
    } catch (error) {
      const message =
        error instanceof DiscordVerifyError
          ? error.message
          : "Не получилось подтвердить Discord. Попробуй ещё раз.";
      if (!(error instanceof DiscordVerifyError)) {
        logger.error("Telegram Discord verify failed", error);
      }
      await upsertBotMessage(ctx, `${pe("error")} ${escapeHtml(message)}`, {
        reply_markup: discordDoneKeyboard().reply_markup,
      });
    }
  });

  bot.action(/^dsc:no:([A-Za-z0-9_-]{16,64})$/, async (ctx) => {
    await ctx.answerCbQuery("Отменено");
    await upsertBotMessage(
      ctx,
      `${pe("info")} Подтверждение Discord отменено. Можешь начать заново кнопкой в Discord.`,
      { reply_markup: discordDoneKeyboard().reply_markup }
    );
  });
}

module.exports = {
  isDiscordStartPayload,
  handleDiscordStartPayload,
  registerDiscordVerifyHandlers,
};
