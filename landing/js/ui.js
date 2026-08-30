window.GarbonaUI = (function () {
  function toast(message, type = "") {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.className = `toast show ${type}`;
    el.textContent = message;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function ensureAuthModal() {
    if (document.getElementById("authModal")) return;
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.id = "authModal";
    wrap.innerHTML = `
      <div class="modal auth-modal" role="dialog" aria-modal="true">
        <button type="button" class="modal-x" id="authClose" aria-label="Close">×</button>
        <div class="auth-modal-logo">
          <img src="assets/logo.png?v=gb3" alt="Garbona" />
        </div>
        <h2>AUTHORIZATION</h2>
        <p>To access the service, accept the terms of use and sign in via Steam.</p>
        <label class="check-row">
          <input type="checkbox" id="authAge" />
          <span>I confirm that I am over 18 years of age</span>
        </label>
        <label class="check-row">
          <input type="checkbox" id="authTerms" />
          <span>I accept the <a href="terms.html" class="link-accent" target="_blank" rel="noopener">rules and conditions</a> of using the website</span>
        </label>
        <button type="button" class="btn btn-auth-steam" id="authContinue" disabled>
          SIGN IN VIA STEAM
          <img src="assets/steam.svg" alt="" />
        </button>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  function syncAuthContinue() {
    const btn = document.getElementById("authContinue");
    const age = document.getElementById("authAge");
    const terms = document.getElementById("authTerms");
    if (!btn) return;
    btn.disabled = !(age?.checked && terms?.checked);
  }

  function openAuthModal() {
    ensureAuthModal();
    document.getElementById("authModal")?.classList.add("open");
    syncAuthContinue();
  }

  function closeAuthModal() {
    document.getElementById("authModal")?.classList.remove("open");
  }

  function syncHeaderAuth() {
    const session = window.GarbonaAuth.getSession();
    const loginBtn = document.getElementById("loginBtn");
    const chip = document.getElementById("userChip");
    const nick = document.getElementById("userNick");
    const avatar = document.getElementById("userAvatar");

    if (session) {
      if (loginBtn) loginBtn.style.display = "none";
      chip?.classList.add("visible");
      if (nick) nick.textContent = session.nickname;
      if (avatar) avatar.src = session.avatar;
    } else {
      if (loginBtn) loginBtn.style.display = "";
      chip?.classList.remove("visible");
    }
  }

  function guardProtectedLinks() {
    document.querySelectorAll("[data-requires-auth]").forEach((link) => {
      link.addEventListener("click", (e) => {
        if (!window.GarbonaAuth.isLoggedIn()) {
          e.preventDefault();
          openAuthModal();
        }
      });
    });
  }

  function bindAuthActions() {
    document.getElementById("loginBtn")?.addEventListener("click", openAuthModal);
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
      window.GarbonaAuth.logout();
      toast("You have logged out");
    });

    document.body.addEventListener("click", (e) => {
      if (e.target.id === "authClose" || e.target.closest?.("#authClose")) {
        closeAuthModal();
      }
      if (e.target.id === "authModal") closeAuthModal();
      if (e.target.id === "authContinue" || e.target.closest?.("#authContinue")) {
        const btn = document.getElementById("authContinue");
        if (btn?.disabled) return;
        closeAuthModal();
        toast("Steam sign-in is not available yet");
      }
    });

    document.body.addEventListener("change", (e) => {
      if (e.target.id === "authAge" || e.target.id === "authTerms") {
        syncAuthContinue();
      }
    });
  }

  function initChrome(options = {}) {
    ensureAuthModal();
    syncHeaderAuth();
    guardProtectedLinks();
    bindAuthActions();

    window.addEventListener("garbona:need-auth", openAuthModal);
    window.addEventListener("garbona:auth", syncHeaderAuth);

    if (options.withFeed) {
      const list = document.getElementById("feedList");
      window.GarbonaFeed.start(list);

      const tabs = [...document.querySelectorAll("[data-filter]")];
      tabs.forEach((btn) => {
        btn.addEventListener("click", () => {
          window.GarbonaFeed.setFilter(btn.dataset.filter, list, tabs);
        });
      });

      const turboBtn = document.getElementById("turboBtn");
      const soundBtn = document.getElementById("soundBtn");
      turboBtn?.addEventListener("click", () => {
        const on = !turboBtn.classList.contains("active");
        turboBtn.classList.toggle("active", on);
        window.GarbonaFeed.setTurbo(on, list);
      });
      soundBtn?.addEventListener("click", () => {
        const on = !soundBtn.classList.contains("active");
        soundBtn.classList.toggle("active", on);
        window.GarbonaUpgrade?.setSound(on);
      });
      if (soundBtn) {
        soundBtn.classList.toggle("active", false);
        window.GarbonaUpgrade?.setSound(false);
      }
    }

    if (options.withUpgrade) {
      window.GarbonaUpgrade.init();
    }

    if (options.withRewards) {
      window.GarbonaRewards?.init();
    }
  }

  return { initChrome, toast, openAuthModal, closeAuthModal, syncHeaderAuth, ensureAuthModal };
})();
