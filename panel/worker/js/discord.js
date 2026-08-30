(function () {
  const ERROR_MAP = {
    invalid_or_expired: "discord.errorInvalid",
    expired: "discord.errorExpired",
    consumed: "discord.errorConsumed",
    not_team_member: "discord.errorNotTeam",
    banned: "discord.errorBanned",
    discord_taken: "discord.errorTaken",
    unauthorized: "discord.errorLogin",
    verify_failed: "discord.errorGeneric",
  };

  function tokenFromUrl() {
    const token = new URLSearchParams(location.search).get("token") || "";
    return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : "";
  }

  function loginHref(token) {
    return `/app/login?next=${encodeURIComponent(`/app/discord?token=${token}`)}`;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function showState(id) {
    document.querySelectorAll(".dsc-state").forEach((el) => {
      el.classList.toggle("is-visible", el.id === id);
    });
  }

  function showError(key, fallback) {
    const text = $("dscErrorText");
    const box = $("dscError");
    text.textContent = WorkerI18n.t(key) || fallback || WorkerI18n.t("discord.errorGeneric");
    box.classList.add("is-visible");
  }

  function hideError() {
    $("dscError").classList.remove("is-visible");
  }

  function applyChrome() {
    WorkerI18n.apply(document);
    const { lang, theme } = WorkerPrefs.get();
    $("langBtn").textContent = lang.toUpperCase();
    $("themeBtn").textContent = theme === "dark" ? "☾" : "☀";
    document.title = `${WorkerI18n.t("discord.title")} - ${WorkerI18n.t("brand.name")}`;
  }

  function fillDiscord(prefix, discord) {
    const avatar = $(`${prefix}Avatar`);
    const name = $(`${prefix}Name`);
    const user = $(`${prefix}User`);
    if (avatar) {
      const url = String(discord.avatarUrl || "").trim();
      if (url) {
        avatar.src = url;
        avatar.alt = discord.displayName || "";
      } else {
        avatar.removeAttribute("src");
        avatar.alt = "";
      }
    }
    if (name) name.textContent = discord.displayName || "Discord";
    if (user) user.textContent = discord.username ? `@${discord.username}` : "";
  }

  async function boot() {
    WorkerPrefs.init();
    applyChrome();

    $("langBtn").addEventListener("click", () => {
      WorkerPrefs.toggleLang();
      applyChrome();
    });
    $("themeBtn").addEventListener("click", () => {
      WorkerPrefs.toggleTheme();
      applyChrome();
    });

    const token = tokenFromUrl();
    if (!token) {
      showState("");
      showError("discord.errorInvalid");
      $("dscSubtitle").textContent = WorkerI18n.t("discord.subtitle");
      return;
    }

    let session;
    try {
      session = await WorkerAPI.get(`/discord/session?token=${encodeURIComponent(token)}`, {
        force: true,
      });
    } catch (error) {
      showState("");
      showError(ERROR_MAP[error.message] || "discord.errorInvalid");
      return;
    }

    if (session.status !== "pending") {
      showState("");
      showError(session.status === "consumed" ? "discord.errorConsumed" : "discord.errorExpired");
      return;
    }

    fillDiscord("dscLogin", session.discord);
    fillDiscord("dscDiscord", session.discord);
    $("dscLoginBtn").href = loginHref(token);

    let me = null;
    try {
      me = await WorkerAuth.me();
    } catch (_) {
      showState("dscLogin");
      return;
    }

    const user = me.user || me;
    const garbonaAvatar = $("dscGarbonaAvatar");
    const photo = String(user.photoUrl || "").trim();
    if (photo && garbonaAvatar) {
      garbonaAvatar.src = photo;
    } else if (garbonaAvatar) {
      garbonaAvatar.removeAttribute("src");
    }
    $("dscGarbonaName").textContent = user.firstName || user.username || "Garbona";
    $("dscGarbonaUser").textContent = user.username
      ? `@${user.username}`
      : user.customId || user.telegramId || "";
    showState("dscConfirm");

    $("dscConfirmBtn").addEventListener("click", async () => {
      hideError();
      $("dscConfirmBtn").disabled = true;
      try {
        await WorkerAPI.post("/discord/verify", { token });
        showState("dscSuccess");
      } catch (error) {
        $("dscConfirmBtn").disabled = false;
        const code = error.data?.error || error.message;
        showError(ERROR_MAP[code] || "discord.errorGeneric", error.data?.message);
        if (error.status === 401) {
          location.replace(loginHref(token));
        }
      }
    });
  }

  boot().catch(() => {
    showState("");
    showError("discord.errorGeneric");
  });
})();
