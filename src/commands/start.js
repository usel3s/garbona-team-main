const { applicationStartKeyboard, participantPanelKeyboard, homeOnlyKeyboard } = require("../keyboards/common");
const { upsertBotMessage } = require("../utils/message");
const { upsertMenuSection } = require("../utils/menuBanner");
const { ensureUser } = require("../services/userService");
const { getApplicationSubmitGate } = require("../services/applicationService");
const { renderPublicProfile } = require("./top");
const { pe } = require("../utils/emoji");
const { clearPendingInputs } = require("../utils/session");
const { renderFeedbackMenu, startFeedbackAdminReply, startFeedbackAdminClose } = require("./feedback");
const { adminCancelKeyboard } = require("../keyboards/admin");
const { isAdminTelegramId } = require("../services/userService");
const {
  setAwaitingPayoutLink,
  buildAdminPayoutApprovalHtml,
} = require("../services/withdrawalService");
const {
  isDiscordStartPayload,
  handleDiscordStartPayload,
} = require("../handlers/discordVerifyHandler");
const {
  parseCampaignStartPayload,
  attributeUserFromStartPayload,
} = require("../services/adCampaignService");

async function renderTeamHome(ctx, user) {
  const replyMarkup = participantPanelKeyboard(user.role === "admin").reply_markup;
  return upsertMenuSection(ctx, "home", { reply_markup: replyMarkup });
}

async function renderHome(ctx) {
  const user = await ensureUser(ctx.from);
  if (user.isBanned) {
    return upsertBotMessage(
      ctx,
      `${pe("userBlocked")} Ты заблокирован. Доступ ограничен.`
    );
  }

  if (!user.isTeamMember) {
    const gate = await getApplicationSubmitGate(user);
    if (!gate.allowed) {
      return upsertBotMessage(ctx, gate.message, {
        reply_markup: homeOnlyKeyboard().reply_markup,
      });
    }

    return upsertBotMessage(
      ctx,
      [
        `${pe("bot")} <b>Garbona</b>`,
        "",
        "Добро пожаловать!",
        "Чтобы начать работу с нами — подай заявку.",
      ].join("\n"),
      { reply_markup: applicationStartKeyboard().reply_markup }
    );
  }

  return renderTeamHome(ctx, user);
}

function registerStartCommand(bot) {
  bot.start(async (ctx) => {
    if (ctx.scene?.current) {
      try {
        await ctx.scene.leave();
      } catch (_) {
        // Scene may already be inactive.
      }
    }

    if (ctx.scene?.session?.formState) {
      ctx.scene.session.formState = null;
    }

    clearPendingInputs(ctx);

    const payload = String(ctx.startPayload || "").trim();
    const payoutMatch = /^payout_([a-f0-9]{24})$/i.exec(payload);
    if (payoutMatch) {
      if (!isAdminTelegramId(ctx.from.id)) {
        await upsertBotMessage(ctx, `${pe("error")} У вас нет прав для обработки выплаты.`);
        return;
      }
      const request = await setAwaitingPayoutLink(payoutMatch[1], ctx.from.id);
      if (!request) {
        await upsertBotMessage(ctx, `${pe("error")} Заявка уже обработана или недоступна.`);
        return;
      }
      await upsertBotMessage(ctx, buildAdminPayoutApprovalHtml(request), {
        reply_markup: adminCancelKeyboard().reply_markup,
      });
      return;
    }

    if (isDiscordStartPayload(payload)) {
      await handleDiscordStartPayload(ctx, payload);
      return;
    }

    if (/^(feedback|fb)$/i.test(payload)) {
      await renderFeedbackMenu(ctx);
      return;
    }

    const feedbackReplyMatch = /^fb_reply_([a-f0-9]{24})$/i.exec(payload);
    if (feedbackReplyMatch) {
      await startFeedbackAdminReply(ctx, feedbackReplyMatch[1]);
      return;
    }

    const feedbackCloseMatch = /^fb_close_([a-f0-9]{24})$/i.exec(payload);
    if (feedbackCloseMatch) {
      await startFeedbackAdminClose(ctx, feedbackCloseMatch[1]);
      return;
    }

    const profileMatch = /^u_(\d+)(?:_(all|24h|7d|30d))?$/.exec(payload);
    if (profileMatch) {
      const period = profileMatch[2] || "all";
      await renderPublicProfile(ctx, profileMatch[1], "all", {
        back: period === "all" ? "menu:top_workers" : `top:period:${period}`,
      });
      return;
    }

    if (parseCampaignStartPayload(payload)) {
      const user = await ensureUser(ctx.from);
      await attributeUserFromStartPayload(user, payload);
    }

    await renderHome(ctx);
  });
}

module.exports = { registerStartCommand, renderHome };
