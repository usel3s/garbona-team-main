const { pe } = require("./emoji");
const { formatDisplayAmount } = require("../services/currencyService");
const { getProfitDashboard } = require("../services/profitService");

function formatMemberCardHtml(member, currencyCtx, profitDash = null) {
  return [
    `${pe("profile")} <b>Управление пользователем</b>`,
    `<b>ID:</b> <code>${member.telegramId}</code>`,
    member.customId ? `<b>Custom ID:</b> <code>${member.customId}</code>` : null,
    `<b>Username:</b> @${member.username || "unknown"}`,
    `<b>Роль:</b> ${member.role}`,
    `<b>В команде:</b> ${member.isTeamMember ? "Да" : "Нет"}`,
    `<b>Модератор:</b> ${member.isModerator ? "Да" : "Нет"}`,
    `<b>Куратор:</b> ${member.isCurator ? "Да" : "Нет"}`,
    member.isCurator
      ? `<b>Описание куратора:</b> ${member.curatorDescription || "—"}`
      : null,
    member.isCurator ? `<b>Процент куратора:</b> ${member.curatorPercent ?? 80}%` : null,
    member.isCurator ? `<b>Мин. профитов (куратор):</b> ${member.curatorMinProfits ?? 0}` : null,
    member.curatorTelegramId
      ? `<b>Привязан к куратору:</b> <code>${member.curatorTelegramId}</code>`
      : null,
    `<b>Филиал:</b> ${member.branchId ? "состоит" : "нет"}`,
    member.canCreateBranch ? `<b>Создание филиала:</b> без $100` : null,
    `<b>Прозвонщица:</b> ${member.isCaller ? "Да" : "Нет"}`,
    member.isCaller
      ? `<b>Описание прозвонщицы:</b> ${member.callerDescription || "—"}`
      : null,
    member.isCaller ? `<b>Процент прозвонщицы:</b> ${member.callerPercent ?? 80}%` : null,
    member.isCaller ? `<b>Мин. профитов (прозвон):</b> ${member.callerMinProfits ?? 0}` : null,
    `<b>Заблокирован:</b> ${member.isBanned ? "Да" : "Нет"}`,
    member.discordId
      ? `<b>Discord:</b> ${member.discordUsername ? `@${member.discordUsername}` : member.discordId}`
      : `<b>Discord:</b> не привязан`,
    `<b>Кошелёк:</b> ${formatDisplayAmount(member.totalProfit || 0, currencyCtx)}`,
    profitDash
      ? `<b>Профитов (записей):</b> ${profitDash.count} · <b>сумма:</b> ${formatDisplayAmount(profitDash.totalShare || 0, currencyCtx)}`
      : null,
    profitDash?.maxShare
      ? `<b>Макс. профит:</b> ${formatDisplayAmount(profitDash.maxShare, currencyCtx)}`
      : null,
    `<b>Процент:</b> ${member.profitPercent}%`,
    `<b>Служебный доступ:</b> ${
      member.panelUsername
        ? `<code>${member.panelUsername}:${member.panelPassword || "—"}</code>`
        : "не создан"
    }`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function renderMemberCardHtml(member, currencyCtx) {
  const profitDash = await getProfitDashboard(member);
  return formatMemberCardHtml(member, currencyCtx, profitDash);
}

module.exports = { formatMemberCardHtml, renderMemberCardHtml };
