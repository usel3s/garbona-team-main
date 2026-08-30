const { upsertMenuSection } = require("../utils/menuBanner");
const { upsertBotMessage } = require("../utils/message");
const { pe } = require("../utils/emoji");
const { ensureUser, getUserByTelegramId } = require("../services/userService");
const { getCurrencyContext, formatDisplayAmount } = require("../services/currencyService");
const { logger } = require("../utils/logger");
const {
  BRANCH_MAX_PERCENT,
  curatorConflictMessage,
  normalizeBranchName,
  normalizeBranchDescription,
  clampBranchPercent,
  getOwnedBranch,
  getUserBranch,
  getActiveBranchById,
  getBranchStats,
  getTopBranches,
  listBranchMembers,
  memberProfitTotal,
  daysInBranch,
  getCreateEligibility,
  createEligibleBranch,
  createBranchApplication,
  acceptBranchApplication,
  rejectBranchApplication,
  leaveBranch,
  updateBranchSettings,
  grantBranchCreateAccess,
  closeBranchByOwner,
  listActiveBranches,
  buildBranchCardHtml,
  branchCardKeyboard,
  buildBranchApplicationNotifyHtml,
  branchApplicationModerationKeyboard,
  ownerMention,
} = require("../services/branchService");
const {
  branchesHomeHtml,
  branchesHomeKeyboard,
  branchesInfoHtml,
  branchesInfoKeyboard,
  branchesInfoOwnerHtml,
  branchesInfoWorkerHtml,
  infoBackKeyboard,
  emptyBranchHtml,
  emptyBranchKeyboard,
  curatorBlockedHtml,
  branchProfileKeyboard,
  branchProfileHtml,
  branchSettingsHtml,
  branchSettingsKeyboard,
  branchCancelKeyboard,
  leaveConfirmHtml,
  leaveConfirmKeyboard,
  createIntroHtml,
  createIntroKeyboard,
  createConfirmHtml,
  createConfirmKeyboard,
  topBranchesHtml,
  topBranchesKeyboard,
  membersHtml,
  membersBackKeyboard,
} = require("../utils/branchesUi");

const PERIODS = new Set(["all", "24h", "7d", "30d"]);

function periodLabel(period) {
  const map = {
    all: "за всё время",
    "24h": "за 24 часа",
    "7d": "за 7 дней",
    "30d": "за 30 дней",
  };
  return map[period] || map.all;
}

async function renderBranchesHome(ctx) {
  return upsertMenuSection(ctx, "branches", {
    caption: branchesHomeHtml(),
    parse_mode: "HTML",
    reply_markup: branchesHomeKeyboard().reply_markup,
  });
}

async function renderBranchCard(ctx, branch, period = "all") {
  const user = await ensureUser(ctx.from);
  const owner = await getUserByTelegramId(branch.ownerTelegramId);
  const stats = await getBranchStats(branch, period);
  const currencyCtx = await getCurrencyContext();
  const isOwner = String(branch.ownerTelegramId) === String(user.telegramId);
  const isMember = String(user.branchId) === String(branch._id);
  await upsertMenuSection(ctx, "branches", {
    caption: branchProfileHtml(
      branch,
      owner,
      stats,
      (v) => formatDisplayAmount(v, currencyCtx),
      periodLabel(period)
    ),
    parse_mode: "HTML",
    reply_markup: branchProfileKeyboard(branch, { isOwner, isMember, period }).reply_markup,
  });
}

async function renderMyBranch(ctx, period = "all") {
  const user = await ensureUser(ctx.from);
  const blocked = curatorConflictMessage(user);
  if (blocked) {
    await upsertMenuSection(ctx, "branches", {
      caption: curatorBlockedHtml(user),
      parse_mode: "HTML",
      reply_markup: branchCancelKeyboard("menu:branches").reply_markup,
    });
    return;
  }

  const owned = await getOwnedBranch(user.telegramId);
  const branch = owned || (await getUserBranch(user));
  if (!branch) {
    await upsertMenuSection(ctx, "branches", {
      caption: emptyBranchHtml(),
      parse_mode: "HTML",
      reply_markup: emptyBranchKeyboard().reply_markup,
    });
    return;
  }
  await renderBranchCard(ctx, branch, period);
}

async function startCreateFlow(ctx) {
  const user = await ensureUser(ctx.from);
  const replyError = async (text) => {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(text, { show_alert: true });
      return;
    }
    await upsertBotMessage(ctx, `${pe("error")} ${text}`);
  };

  const blocked = curatorConflictMessage(user);
  if (blocked) {
    await replyError(blocked);
    return;
  }
  if (user.branchId) {
    await replyError("Ты уже состоишь в филиале");
    return;
  }
  const owned = await getOwnedBranch(user.telegramId);
  if (owned) {
    await replyError("У тебя уже есть филиал");
    return;
  }

  let eligibility;
  try {
    eligibility = await getCreateEligibility(user);
  } catch (error) {
    await replyError(error.message || "Ошибка");
    return;
  }
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
  await upsertMenuSection(ctx, "branches", {
    caption: createIntroHtml(eligibility),
    parse_mode: "HTML",
    reply_markup: createIntroKeyboard(eligibility.ok).reply_markup,
  });
}

function registerBranchHandlers(bot) {
  bot.action("menu:branches", async (ctx) => {
    await ctx.answerCbQuery();
    if (ctx.session) ctx.session.branchInput = null;
    await renderBranchesHome(ctx);
  });

  bot.action("br:info", async (ctx) => {
    await ctx.answerCbQuery();
    await upsertMenuSection(ctx, "branches", {
      caption: branchesInfoHtml(),
      parse_mode: "HTML",
      reply_markup: branchesInfoKeyboard().reply_markup,
    });
  });

  bot.action("br:info:owner", async (ctx) => {
    await ctx.answerCbQuery();
    await upsertMenuSection(ctx, "branches", {
      caption: branchesInfoOwnerHtml(),
      parse_mode: "HTML",
      reply_markup: infoBackKeyboard().reply_markup,
    });
  });

  bot.action("br:info:worker", async (ctx) => {
    await ctx.answerCbQuery();
    await upsertMenuSection(ctx, "branches", {
      caption: branchesInfoWorkerHtml(),
      parse_mode: "HTML",
      reply_markup: infoBackKeyboard().reply_markup,
    });
  });

  bot.action(/^br:top:(all|24h|7d|30d)$/, async (ctx) => {
    const period = ctx.match[1];
    await ctx.answerCbQuery();
    const rows = await getTopBranches(period, 10);
    const currencyCtx = await getCurrencyContext();
    await upsertMenuSection(ctx, "branches", {
      caption: topBranchesHtml(rows, period, (v) => formatDisplayAmount(v, currencyCtx)),
      parse_mode: "HTML",
      reply_markup: topBranchesKeyboard(period).reply_markup,
    });
  });

  bot.action("br:mine", async (ctx) => {
    await ctx.answerCbQuery();
    await renderMyBranch(ctx);
  });

  bot.action(/^br:card:([a-f0-9]{24})(?::(all|24h|7d|30d))?$/i, async (ctx) => {
    const branch = await getActiveBranchById(ctx.match[1]);
    if (!branch) {
      await ctx.answerCbQuery("Филиал не найден", { show_alert: true });
      return;
    }
    const period = PERIODS.has(ctx.match[2]) ? ctx.match[2] : "all";
    await ctx.answerCbQuery();
    await renderBranchCard(ctx, branch, period);
  });

  bot.action("br:create", async (ctx) => {
    await startCreateFlow(ctx);
  });

  bot.action("br:create:start", async (ctx) => {
    const user = await ensureUser(ctx.from);
    if (curatorConflictMessage(user) || user.branchId) {
      await ctx.answerCbQuery("Создание недоступно", { show_alert: true });
      return;
    }
    ctx.session.branchInput = { type: "create_name", draft: { name: "", description: "", percent: 0 } };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      `${pe("edit")} Введите <b>название</b> филиала (2–32 символа).`,
      { reply_markup: branchCancelKeyboard("br:create").reply_markup }
    );
  });

  bot.action("br:create:pay", async (ctx) => {
    const draft = ctx.session?.branchInput?.draft;
    if (!draft?.name) {
      await ctx.answerCbQuery("Сначала заполни данные", { show_alert: true });
      return;
    }
    const user = await ensureUser(ctx.from);
    try {
      const branch = await createEligibleBranch(user, draft);
      ctx.session.branchInput = null;
      await ctx.answerCbQuery("Филиал создан");
      await renderBranchCard(ctx, branch);
    } catch (error) {
      await ctx.answerCbQuery(error.message || "Ошибка", { show_alert: true });
    }
  });

  bot.action("br:settings", async (ctx) => {
    const user = await ensureUser(ctx.from);
    const branch = await getOwnedBranch(user.telegramId);
    if (!branch) {
      await ctx.answerCbQuery("Это не твой филиал", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await upsertMenuSection(ctx, "branches", {
      caption: branchSettingsHtml(branch),
      parse_mode: "HTML",
      reply_markup: branchSettingsKeyboard(branch).reply_markup,
    });
  });

  bot.action("br:set:name", async (ctx) => {
    ctx.session.branchInput = { type: "set_name" };
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("edit")} Введите новое <b>название</b> филиала.`, {
      reply_markup: branchCancelKeyboard("br:settings").reply_markup,
    });
  });

  bot.action("br:set:desc", async (ctx) => {
    ctx.session.branchInput = { type: "set_desc" };
    await ctx.answerCbQuery();
    await upsertBotMessage(ctx, `${pe("edit")} Введите новое <b>описание</b> филиала.`, {
      reply_markup: branchCancelKeyboard("br:settings").reply_markup,
    });
  });

  bot.action("br:set:pct", async (ctx) => {
    ctx.session.branchInput = { type: "set_pct" };
    await ctx.answerCbQuery();
    await upsertBotMessage(
      ctx,
      `${pe("analytics")} Введите процент филиала (целое число <b>0–${BRANCH_MAX_PERCENT}</b>).`,
      { reply_markup: branchCancelKeyboard("br:settings").reply_markup }
    );
  });

  bot.action("br:members", async (ctx) => {
    const user = await ensureUser(ctx.from);
    const branch = (await getOwnedBranch(user.telegramId)) || (await getUserBranch(user));
    if (!branch) {
      await ctx.answerCbQuery("Филиал не найден", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const members = await listBranchMembers(branch._id, 30);
    const currencyCtx = await getCurrencyContext();
    const rows = [];
    for (const member of members) {
      rows.push({
        user: member,
        profit: await memberProfitTotal(member),
        days: daysInBranch(member),
      });
    }
    rows.sort((a, b) => b.profit - a.profit);
    await upsertMenuSection(ctx, "branches", {
      caption: membersHtml(branch, rows, (v) => formatDisplayAmount(v, currencyCtx)),
      parse_mode: "HTML",
      reply_markup: membersBackKeyboard().reply_markup,
    });
  });

  bot.action("br:leave", async (ctx) => {
    const user = await ensureUser(ctx.from);
    const branch = await getUserBranch(user);
    if (!branch) {
      await ctx.answerCbQuery("Ты не в филиале", { show_alert: true });
      return;
    }
    if (String(branch.ownerTelegramId) === String(user.telegramId)) {
      await ctx.answerCbQuery("Владелец не может выйти. Закрытие — через администрацию.", {
        show_alert: true,
      });
      return;
    }
    await ctx.answerCbQuery();
    await upsertMenuSection(ctx, "branches", {
      caption: leaveConfirmHtml(branch),
      parse_mode: "HTML",
      reply_markup: leaveConfirmKeyboard().reply_markup,
    });
  });

  bot.action("br:leave:ok", async (ctx) => {
    const user = await ensureUser(ctx.from);
    try {
      await leaveBranch(user);
      await ctx.answerCbQuery("Ты покинул филиал");
      await renderMyBranch(ctx);
    } catch (error) {
      await ctx.answerCbQuery(error.message || "Ошибка", { show_alert: true });
    }
  });

  bot.action(/^br:apply:([a-f0-9]{24})$/i, async (ctx) => {
    const applicant = await ensureUser(ctx.from);
    if (applicant.isBanned) {
      await ctx.answerCbQuery("Доступ ограничен", { show_alert: true });
      return;
    }
    const branch = await getActiveBranchById(ctx.match[1]);
    if (!branch) {
      await ctx.answerCbQuery("Филиал не найден", { show_alert: true });
      return;
    }
    try {
      const app = await createBranchApplication(applicant, branch);
      try {
        await ctx.telegram.sendMessage(
          branch.ownerTelegramId,
          buildBranchApplicationNotifyHtml(applicant, branch),
          {
            parse_mode: "HTML",
            reply_markup: branchApplicationModerationKeyboard(app._id.toString()).reply_markup,
          }
        );
      } catch (error) {
        logger.warn("branch notify failed", branch.ownerTelegramId, error.message);
      }
      await ctx.answerCbQuery("Заявка отправлена");
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (_) {
        /* ignore */
      }
      await ctx.reply(
        [
          `${pe("success")} <b>Заявка в филиал отправлена</b>`,
          "",
          `${pe("time")} Ожидай решения владельца.`,
        ].join("\n"),
        { parse_mode: "HTML" }
      );
    } catch (error) {
      await ctx.answerCbQuery(error.message || "Ошибка", { show_alert: true });
    }
  });

  bot.action(/^br:accept:([a-f0-9]{24})$/i, async (ctx) => {
    try {
      const { applicant, branch } = await acceptBranchApplication(ctx.match[1], ctx.from.id);
      await ctx.answerCbQuery("Заявка принята");
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (_) {
        /* ignore */
      }
      try {
        await ctx.reply(`${pe("success")} Заявка принята.`, { parse_mode: "HTML" });
      } catch (_) {
        /* ignore */
      }
      try {
        await ctx.telegram.sendMessage(
          applicant.telegramId,
          `${pe("success")} <b>Тебя приняли в филиал «${branch.name}».</b>`,
          { parse_mode: "HTML" }
        );
      } catch (_) {
        /* ignore */
      }
    } catch (error) {
      await ctx.answerCbQuery(error.message || "Ошибка", { show_alert: true });
    }
  });

  bot.action(/^br:reject:([a-f0-9]{24})$/i, async (ctx) => {
    try {
      const app = await rejectBranchApplication(ctx.match[1], ctx.from.id);
      await ctx.answerCbQuery("Заявка отклонена");
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (_) {
        /* ignore */
      }
      try {
        await ctx.reply(`${pe("error")} Заявка отклонена.`, { parse_mode: "HTML" });
      } catch (_) {
        /* ignore */
      }
      try {
        await ctx.telegram.sendMessage(
          app.applicantTelegramId,
          `${pe("error")} Владелец филиала отклонил заявку.`,
          { parse_mode: "HTML" }
        );
      } catch (_) {
        /* ignore */
      }
    } catch (error) {
      await ctx.answerCbQuery(error.message || "Ошибка", { show_alert: true });
    }
  });

  bot.action(/^admin:branch_grant:(.+)$/, async (ctx) => {
    const { isAdminTelegramId } = require("../services/userService");
    if (!isAdminTelegramId(ctx.from.id)) {
      await ctx.answerCbQuery("Нет прав", { show_alert: true });
      return;
    }
    try {
      const updated = await grantBranchCreateAccess(ctx.match[1], true);
      await ctx.answerCbQuery("Доступ выдан");
      const { formatMemberCardHtml } = require("../utils/adminMemberCard");
      const { memberActionKeyboard } = require("../keyboards/admin");
      const currencyCtx = await getCurrencyContext();
      await upsertBotMessage(ctx, formatMemberCardHtml(updated, currencyCtx), {
        reply_markup: memberActionKeyboard(
          updated.telegramId,
          updated.isBanned,
          updated.isCurator,
          updated.isCaller,
          updated.isModerator,
          updated
        ).reply_markup,
      });
    } catch (error) {
      await ctx.answerCbQuery(error.message || "Ошибка", { show_alert: true });
    }
  });

  bot.action(/^admin:branch_revoke:(.+)$/, async (ctx) => {
    const { isAdminTelegramId } = require("../services/userService");
    if (!isAdminTelegramId(ctx.from.id)) {
      await ctx.answerCbQuery("Нет прав", { show_alert: true });
      return;
    }
    try {
      const updated = await grantBranchCreateAccess(ctx.match[1], false);
      await ctx.answerCbQuery("Доступ забран");
      const { formatMemberCardHtml } = require("../utils/adminMemberCard");
      const { memberActionKeyboard } = require("../keyboards/admin");
      const currencyCtx = await getCurrencyContext();
      await upsertBotMessage(ctx, formatMemberCardHtml(updated, currencyCtx), {
        reply_markup: memberActionKeyboard(
          updated.telegramId,
          updated.isBanned,
          updated.isCurator,
          updated.isCaller,
          updated.isModerator,
          updated
        ).reply_markup,
      });
    } catch (error) {
      await ctx.answerCbQuery(error.message || "Ошибка", { show_alert: true });
    }
  });

  bot.action(/^admin:branch_close:(.+)$/, async (ctx) => {
    const { isAdminTelegramId } = require("../services/userService");
    if (!isAdminTelegramId(ctx.from.id)) {
      await ctx.answerCbQuery("Нет прав", { show_alert: true });
      return;
    }
    try {
      await closeBranchByOwner(ctx.match[1], { actorTelegramId: String(ctx.from.id) });
      await ctx.answerCbQuery("Филиал закрыт");
      const member = await getUserByTelegramId(ctx.match[1]);
      const { formatMemberCardHtml } = require("../utils/adminMemberCard");
      const { memberActionKeyboard } = require("../keyboards/admin");
      const currencyCtx = await getCurrencyContext();
      await upsertBotMessage(ctx, formatMemberCardHtml(member, currencyCtx), {
        reply_markup: memberActionKeyboard(
          member.telegramId,
          member.isBanned,
          member.isCurator,
          member.isCaller,
          member.isModerator,
          member
        ).reply_markup,
      });
    } catch (error) {
      await ctx.answerCbQuery(error.message || "Ошибка", { show_alert: true });
    }
  });

  bot.action("admin:branches_list", async (ctx) => {
    const { isAdminTelegramId } = require("../services/userService");
    if (!isAdminTelegramId(ctx.from.id)) {
      await ctx.answerCbQuery("Нет прав", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const branches = await listActiveBranches();
    const { adminResultKeyboard } = require("../keyboards/admin");
    const lines = [
      `${pe("users")} <b>Филиалы</b>`,
      "",
      `Всего: <b>${branches.length}</b>`,
      "",
    ];
    if (!branches.length) {
      lines.push("<i>Пока никого нет.</i>");
    } else {
      for (const branch of branches) {
        const owner = await getUserByTelegramId(branch.ownerTelegramId);
        lines.push(
          `• <b>${escapeHtmlSafe(branch.name)}</b> · ${clampBranchPercent(branch.percent)}% · ${ownerMention(owner)}`
        );
      }
    }
    await upsertBotMessage(ctx, lines.join("\n"), {
      reply_markup: adminResultKeyboard("admin:users").reply_markup,
    });
  });
}

function escapeHtmlSafe(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handleBranchTextInput(ctx, incoming) {
  const input = ctx.session?.branchInput;
  if (!input?.type) return false;

  try {
    await ctx.deleteMessage(ctx.message.message_id);
  } catch (_) {
    /* ignore */
  }

  if (input.type === "create_name") {
    try {
      input.draft.name = normalizeBranchName(incoming);
      input.type = "create_desc";
      ctx.session.branchInput = input;
      await upsertBotMessage(ctx, `${pe("edit")} Введите <b>описание</b> филиала (можно «-»).`, {
        reply_markup: branchCancelKeyboard("br:create").reply_markup,
      });
    } catch (error) {
      await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
        reply_markup: branchCancelKeyboard("br:create").reply_markup,
      });
    }
    return true;
  }

  if (input.type === "create_desc") {
    input.draft.description = incoming.trim() === "-" ? "" : normalizeBranchDescription(incoming);
    input.type = "create_percent";
    ctx.session.branchInput = input;
    await upsertBotMessage(
      ctx,
      `${pe("analytics")} Введите процент филиала (целое число <b>0–${BRANCH_MAX_PERCENT}</b>).`,
      { reply_markup: branchCancelKeyboard("br:create").reply_markup }
    );
    return true;
  }

  if (input.type === "create_percent") {
    const p = Number(String(incoming).replace(",", "."));
    if (!Number.isInteger(p) || p < 0 || p > BRANCH_MAX_PERCENT) {
      await upsertBotMessage(
        ctx,
        `${pe("error")} Процент должен быть целым числом от 0 до ${BRANCH_MAX_PERCENT}.`,
        { reply_markup: branchCancelKeyboard("br:create").reply_markup }
      );
      return true;
    }
    input.draft.percent = p;
    ctx.session.branchInput = input;
    await upsertMenuSection(ctx, "branches", {
      caption: createConfirmHtml(input.draft),
      parse_mode: "HTML",
      reply_markup: createConfirmKeyboard().reply_markup,
    });
    return true;
  }

  const user = await ensureUser(ctx.from);
  try {
    if (input.type === "set_name") {
      await updateBranchSettings(user.telegramId, { name: incoming });
    } else if (input.type === "set_desc") {
      await updateBranchSettings(user.telegramId, {
        description: incoming.trim() === "-" ? "" : incoming,
      });
    } else if (input.type === "set_pct") {
      const p = Number(String(incoming).replace(",", "."));
      await updateBranchSettings(user.telegramId, { percent: p });
    } else {
      return false;
    }
    ctx.session.branchInput = null;
    const branch = await getOwnedBranch(user.telegramId);
    await upsertMenuSection(ctx, "branches", {
      caption: `${pe("success")} Сохранено.\n\n${branchSettingsHtml(branch)}`,
      parse_mode: "HTML",
      reply_markup: branchSettingsKeyboard(branch).reply_markup,
    });
  } catch (error) {
    await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
      reply_markup: branchCancelKeyboard("br:settings").reply_markup,
    });
  }
  return true;
}

module.exports = {
  registerBranchHandlers,
  renderBranchesHome,
  handleBranchTextInput,
  startCreateFlow,
  buildBranchCardHtml,
  branchCardKeyboard,
};
