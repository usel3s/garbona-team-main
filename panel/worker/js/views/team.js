window.WorkerViews = window.WorkerViews || {};

WorkerViews.teamState = {
  tab: "curators", // curators | callers
  members: [],
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badgeClassForTeamStatus() {
  // В панели это всегда "условно активные" роли; для UI достаточно нейтральной метки.
  return "type";
}

function renderMemberCard(member, { roleType } = {}) {
  const desc = escapeHtml(member.description || "Описание пока не указано.");
  const username = member.username ? `@${escapeHtml(member.username)}` : "без username";
  const percent = Number(member.percent ?? 80);
  const minProfits = Number(member.minProfits ?? 0);

  const actionHtml = (() => {
    if (roleType === "curators") {
      return `
        <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
          <button type="button" class="btn btn-primary team-apply-btn" data-curator-id="${escapeHtml(
            member.telegramId
          )}">
            Подать заявку
          </button>
          ${
            member.telegramLink
              ? `
            <a class="btn btn-blue" href="${escapeHtml(member.telegramLink)}" target="_blank" rel="noopener noreferrer">
              Написать
            </a>`
              : `<button type="button" class="btn btn-ghost" disabled>Написать</button>`
          }
        </div>
      `;
    }

    if (roleType === "callers") {
      if (!member.telegramLink) {
        return `<button type="button" class="btn btn-ghost" disabled>Написать</button>`;
      }
      return `
        <a class="btn btn-blue" href="${escapeHtml(member.telegramLink)}" target="_blank" rel="noopener noreferrer">
          Написать
        </a>
      `;
    }

    return "";
  })();

  return `
    <div class="team-card" data-member-id="${escapeHtml(member.telegramId)}">
      <div class="team-card-head">
        <div>
          <div style="font-weight:600; font-size:13px;">${escapeHtml(member.roleLabel || "")} ${username}</div>
          <div class="muted" style="margin-top:6px; line-height:1.35;">${desc}</div>
        </div>
      </div>
      <div class="kpi-grid" style="grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top:10px;">
        <div class="kpi-cell" style="padding:10px 12px;">
          <div class="kpi-label">Процент</div>
          <div class="kpi-value">${percent}%</div>
        </div>
        <div class="kpi-cell" style="padding:10px 12px;">
          <div class="kpi-label">Мин. профитов</div>
          <div class="kpi-value">${minProfits}</div>
        </div>
      </div>
      <div class="team-card-actions" style="margin-top:12px;">
        ${actionHtml}
      </div>
    </div>
  `;
}

async function loadMembers(tab) {
  if (tab === "curators") {
    const data = await WorkerAPI.get("/team/curators", { force: true });
    return data?.members || [];
  }
  const data = await WorkerAPI.get("/team/callers", { force: true });
  return data?.members || [];
}

WorkerViews.team = async function renderTeam(ctx) {
  const { main, user } = ctx;
  const tab = WorkerViews.teamState.tab || "curators";
  WorkerViews.teamState.tab = tab;

  main.innerHTML = `
    <h1 class="page-greeting">Команда</h1>

    <section class="section">
      <div class="section-head">
        <h2 class="section-title">Роли</h2>
        <div class="link-segments" id="teamTabs">
          <button type="button" class="link-segment ${tab === "curators" ? "is-active" : ""}" data-team-tab="curators">Кураторы</button>
          <button type="button" class="link-segment ${tab === "callers" ? "is-active" : ""}" data-team-tab="callers">Прозвонщицы</button>
        </div>
      </div>

      <div style="padding: 14px 16px 16px;">
        <div class="inline-alert" id="teamStatus" style="display:none;"></div>
        <div id="teamGrid" style="margin-top:14px;"></div>
      </div>
    </section>
  `;

  const statusEl = document.getElementById("teamStatus");
  const grid = document.getElementById("teamGrid");
  const roleType = tab === "curators" ? "curators" : "callers";

  function showStatus(msg, type = "error") {
    statusEl.style.display = "block";
    statusEl.className = `inline-alert ${type === "error" ? "" : ""}`;
    statusEl.textContent = msg;
  }

  async function paint() {
    try {
      grid.innerHTML = `<div class="muted">Загрузка…</div>`;
      const members = await loadMembers(roleType);
      // Роль в UI.
      const mapped = members.map((m) => ({
        ...m,
        roleLabel: roleType === "curators" ? "Куратор" : "Прозвонщица",
      }));
      WorkerViews.teamState.members = mapped;
      grid.innerHTML = mapped.length
        ? mapped.map((m) => renderMemberCard(m, { roleType: roleType === "curators" ? "curator" : "caller" })).join("")
        : `<div class="empty">Пока никого нет</div>`;

      // Bind apply buttons for curators.
      if (roleType === "curators") {
        grid.querySelectorAll(".team-apply-btn").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const curatorId = btn.dataset.curatorId;
            if (!curatorId) return;
            try {
              btn.disabled = true;
              statusEl.style.display = "none";
              await WorkerAPI.post(`/team/curators/${encodeURIComponent(curatorId)}/apply`, {});
              showStatus("Заявка отправлена. Ожидайте решения.", "ok");
              // Refresh.
              await paint();
            } catch (error) {
              showStatus(error?.message || "Не удалось отправить заявку.", "error");
              btn.disabled = false;
            }
          });
        });
      }
    } catch (error) {
      showStatus(error?.message || "Ошибка загрузки команды.", "error");
    }
  }

  paint();

  document.getElementById("teamTabs").querySelectorAll("button[data-team-tab]").forEach((b) => {
    b.addEventListener("click", async () => {
      WorkerViews.teamState.tab = b.dataset.teamTab;
      await WorkerViews.team(ctx);
    });
  });
};

