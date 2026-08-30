window.WorkerViews = window.WorkerViews || {};

WorkerViews.supportState = {
  type: "bug", // bug | question | idea
  submitting: false,
  items: [],
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badgeClassForFeedbackStatus(status) {
  const raw = String(status || "").toLowerCase();
  if (raw === "closed") return "ok";
  return "warn";
}

function statusLabelForFeedback(status) {
  const raw = String(status || "").toLowerCase();
  if (raw === "closed") return "Закрыто";
  return "Открыто";
}

async function loadFeedback() {
  const res = await WorkerAPI.get("/feedback", { force: true });
  return res?.items || [];
}

WorkerViews.support = async function renderSupport(ctx) {
  const { main } = ctx;
  main.innerHTML = `
    <h1 class="page-greeting">Поддержка</h1>
    <p class="page-subtitle" style="margin-top:-8px; color: var(--muted);">
      Фидбек (баги, вопросы, идеи). Команда ответит в Telegram.
    </p>

    <section class="section" style="padding-bottom: 6px;">
      <div class="section-head">
        <h2 class="section-title">Создать обращение</h2>
      </div>

      <div style="padding: 14px 16px;">
        <div class="inline-alert" id="supportStatus" style="display:none;"></div>
        <form id="supportForm">
          <div class="settings-field">
            <label class="settings-label">Направление</label>
            <select class="input" id="supportType" style="height: 32px;">
              <option value="bug" selected>Баг</option>
              <option value="question">Вопрос</option>
              <option value="idea">Идея</option>
            </select>
          </div>
          <div class="settings-field" style="margin-top:10px;">
            <label class="settings-label" for="supportText">Текст обращения</label>
            <textarea class="input" id="supportText" style="height: 92px; padding-top:8px;" maxlength="2000" placeholder="Опишите проблему или идею…"></textarea>
            <div class="kpi-hint" style="margin-top:6px;">
              Минимум 5 символов. Максимум 2000.
            </div>
          </div>
          <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap;">
            <button type="submit" class="btn btn-primary" id="supportSubmit">Отправить</button>
            <button type="button" class="btn btn-ghost" id="supportCancel">Очистить</button>
          </div>
        </form>
      </div>
    </section>

    <section class="section" style="margin-top:12px;">
      <div class="section-head">
        <h2 class="section-title">Ваши обращения</h2>
      </div>
      <div style="padding: 8px 0 0;">
        <div id="supportList"></div>
      </div>
    </section>
  `;

  const statusEl = document.getElementById("supportStatus");
  const setStatus = (msg, type = "error") => {
    statusEl.style.display = "block";
    statusEl.className = `inline-alert ${type === "error" ? "" : ""}`;
    statusEl.textContent = msg;
  };
  const hideStatus = () => {
    statusEl.style.display = "none";
    statusEl.textContent = "";
  };

  async function paintList() {
    const items = await loadFeedback();
    WorkerViews.supportState.items = items;

    const wrap = document.getElementById("supportList");
    if (!items.length) {
      wrap.innerHTML = `<div class="empty">Пока нет обращений.</div>`;
      return;
    }

    wrap.innerHTML = items
      .map((t) => {
        const openClosedBadge = statusLabelForFeedback(t.status);
        const replyBlock = t.adminReply
          ? `<div class="muted" style="margin-top:8px; white-space: pre-wrap;">Ответ команды: ${escapeHtml(
              t.adminReply
            )}</div>`
          : "";
        return `
          <div style="padding: 14px 16px; border-bottom: 1px solid var(--line-soft);">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
              <div>
                <div style="font-size:12.5px; font-weight:600;">
                  ${escapeHtml(String(t.type || "").toUpperCase())} · #${escapeHtml(String(t.id || "").slice(0, 6))}
                </div>
                <div class="muted" style="margin-top:6px;">${escapeHtml(
                  WorkerFormat.date(t.createdAt)
                )}</div>
              </div>
              <span class="badge ${badgeClassForFeedbackStatus(t.status)}">${escapeHtml(openClosedBadge)}</span>
            </div>
            <div style="margin-top:10px; white-space: pre-wrap;">${escapeHtml(t.text || "")}</div>
            ${replyBlock}
          </div>
        `;
      })
      .join("");
  }

  await paintList();

  const form = document.getElementById("supportForm");
  const typeEl = document.getElementById("supportType");
  const textEl = document.getElementById("supportText");

  document.getElementById("supportCancel").addEventListener("click", () => {
    hideStatus();
    textEl.value = "";
    typeEl.value = "bug";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (WorkerViews.supportState.submitting) return;
    WorkerViews.supportState.submitting = true;
    hideStatus();

    try {
      const type = String(typeEl.value || "").trim();
      const text = String(textEl.value || "").trim();
      if (!text) throw new Error("Введите текст обращения.");

      await WorkerAPI.post("/feedback", { type, text });
      textEl.value = "";
      typeEl.value = "bug";
      setStatus("Обращение отправлено.", "ok");
      await paintList();
    } catch (error) {
      setStatus(error?.message || "Не удалось отправить обращение.", "error");
    } finally {
      WorkerViews.supportState.submitting = false;
    }
  });
};

