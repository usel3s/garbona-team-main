const { pe } = require("./emoji");
const { adminTemplatesKeyboard } = require("../keyboards/admin");
const { getVisibleTemplates } = require("../services/settingsService");

function escapeAdminHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatAdminTemplatesHtml(templates = [], headerLines = []) {
  const lines = [...headerLines];
  if (headerLines.length) lines.push("");
  lines.push(
    `${pe("file")} <b>Шаблоны</b>`,
    "",
    "Только включённые ID видны в боте и при создании ссылок.",
    ""
  );
  if (!templates.length) {
    lines.push("<i>Список пуст — шаблоны скрыты.</i>");
  } else {
    lines.push(`Включено: <b>${templates.length}</b>`, "");
    for (const template of templates.slice(0, 30)) {
      lines.push(
        `• <code>${template.id}</code> — ${escapeAdminHtml(template.name || `Template #${template.id}`)}`
      );
    }
    if (templates.length > 30) {
      lines.push("", `<i>…и ещё ${templates.length - 30}</i>`);
    }
  }
  return lines.join("\n");
}

async function buildAdminTemplatesView(headerLines = []) {
  const templates = await getVisibleTemplates();
  return {
    templates,
    text: formatAdminTemplatesHtml(templates, headerLines),
    reply_markup: adminTemplatesKeyboard(templates).reply_markup,
  };
}

module.exports = {
  escapeAdminHtml,
  formatAdminTemplatesHtml,
  buildAdminTemplatesView,
};
