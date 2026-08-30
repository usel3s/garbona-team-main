const AppSettings = require("../models/AppSettings");
const { FORM_DEFINITIONS } = require("../config/forms");

const QUESTIONS_KEY_PREFIX = "formQuestions:";

function cloneDefaultQuestions(formId) {
  const def = FORM_DEFINITIONS[formId];
  if (!def?.questions?.length) return [];
  return def.questions.map((q) => ({
    key: q.key,
    label: q.label,
    prompt: q.prompt,
  }));
}

function questionsStorageKey(formId) {
  return `${QUESTIONS_KEY_PREFIX}${formId}`;
}

function sanitizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const key = String(raw.key || "").trim();
  const label = String(raw.label || "").trim();
  const prompt = String(raw.prompt || "").trim();
  if (!key || !label || !prompt) return null;
  return { key, label, prompt };
}

async function loadStoredQuestions(formId) {
  const row = await AppSettings.findOne({ key: questionsStorageKey(formId) });
  if (!row?.valueString) return null;
  try {
    const parsed = JSON.parse(row.valueString);
    if (!Array.isArray(parsed)) return null;
    const list = parsed.map(sanitizeQuestion).filter(Boolean);
    return list.length ? list : null;
  } catch (_) {
    return null;
  }
}

async function saveQuestions(formId, questions) {
  const clean = (questions || []).map(sanitizeQuestion).filter(Boolean);
  await AppSettings.findOneAndUpdate(
    { key: questionsStorageKey(formId) },
    { valueString: JSON.stringify(clean) },
    { upsert: true, new: true }
  );
  return clean;
}

async function getForm(formId = "teamApplication") {
  const base = FORM_DEFINITIONS[formId];
  if (!base) {
    throw new Error(`Форма не найдена: ${formId}`);
  }
  const stored = await loadStoredQuestions(formId);
  return {
    id: base.id,
    title: base.title,
    questions: stored || cloneDefaultQuestions(formId),
  };
}

function makeQuestionKey() {
  return `q_${Date.now().toString(36)}`;
}

async function addFormQuestion(formId, { label, prompt }) {
  const form = await getForm(formId);
  const question = sanitizeQuestion({
    key: makeQuestionKey(),
    label,
    prompt,
  });
  if (!question) {
    throw new Error("Нужны название и текст вопроса");
  }
  const next = [...form.questions, question];
  await saveQuestions(formId, next);
  return question;
}

async function removeFormQuestion(formId, questionKey) {
  const form = await getForm(formId);
  if (form.questions.length <= 1) {
    throw new Error("Нельзя удалить последний вопрос");
  }
  const next = form.questions.filter((q) => q.key !== questionKey);
  if (next.length === form.questions.length) {
    throw new Error("Вопрос не найден");
  }
  await saveQuestions(formId, next);
  return next;
}

function formatApplicationPreview(form, answers) {
  const lines = [`<b>${form.title}</b>`, ""];
  for (const question of form.questions) {
    lines.push(`<b>${question.label}:</b> ${answers[question.key] || "-"}`);
  }
  return lines.join("\n");
}

module.exports = {
  getForm,
  formatApplicationPreview,
  addFormQuestion,
  removeFormQuestion,
};
