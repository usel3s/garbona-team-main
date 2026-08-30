window.GarbonaUpgrade = (function () {
  const state = {
    stake: null,
    target: null,
    sound: false,
  };

  function chance() {
    if (!state.stake || !state.target) return 0;
    const raw = (state.stake.price / state.target.price) * 0.72;
    return Math.max(5, Math.min(78, Math.round(raw * 100)));
  }

  function playClick() {
    if (!state.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = 520;
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.07);
    } catch (_) {
      /* ignore */
    }
  }

  function skinArt(skin, tall = false) {
    return `
      <div class="skin-art ${tall ? "tall" : ""}" style="--rarity:${skin.color}">
        <img src="${skin.image}" alt="${skin.label}" loading="lazy"
          onerror="this.style.display='none';this.parentElement.classList.add('no-img')" />
        <span class="wear-badge">${skin.wear}</span>
      </div>
    `;
  }

  function renderSlots() {
    const stakeEl = document.getElementById("stakeSlot");
    const targetEl = document.getElementById("targetSlot");
    const chanceEl = document.getElementById("chanceValue");
    const wheel = document.getElementById("upgradeWheel");
    const btn = document.getElementById("upgradeBtn");

    if (stakeEl) {
      if (!state.stake) {
        stakeEl.classList.remove("filled");
        stakeEl.innerHTML = `<span class="slot-placeholder">Selected items will appear here</span>`;
      } else {
        stakeEl.classList.add("filled");
        stakeEl.innerHTML = `
          <div class="selected-card">
            ${skinArt(state.stake, true)}
            <div class="selected-meta">
              <strong>${state.stake.label}</strong>
              <span>${state.stake.wearName}</span>
              <div class="price">${state.stake.price.toFixed(2)} T</div>
            </div>
          </div>
        `;
      }
    }

    if (targetEl) {
      if (!state.target) {
        targetEl.classList.remove("filled");
        targetEl.innerHTML = `<span class="slot-placeholder">Pick an item from the list below</span>`;
      } else {
        targetEl.classList.add("filled");
        targetEl.innerHTML = `
          <div class="selected-card">
            ${skinArt(state.target, true)}
            <div class="selected-meta">
              <strong>${state.target.label}</strong>
              <span>${state.target.wearName}</span>
              <div class="price">${state.target.price.toFixed(2)} T</div>
            </div>
          </div>
        `;
      }
    }

    const ch = chance();
    if (chanceEl) chanceEl.textContent = `${ch}%`;
    if (wheel) wheel.style.setProperty("--chance", `${ch}%`);
    if (btn) btn.disabled = !(state.stake && state.target);
  }

  function setStake(skin) {
    if (!window.GarbonaAuth.requireAuth()) return;
    state.stake = skin;
    renderSlots();
    highlightSelected();
  }

  function setTarget(skin) {
    state.target = skin;
    renderSlots();
    highlightSelected();
  }

  function highlightSelected() {
    document.querySelectorAll("[data-inv-id]").forEach((el) => {
      el.classList.toggle("selected", state.stake && el.dataset.invId === state.stake.id);
    });
    document.querySelectorAll("[data-cat-id]").forEach((el) => {
      el.classList.toggle("selected", state.target && el.dataset.catId === state.target.id);
    });
  }

  function skinCardButton(skin, datasetKey) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "skin-card";
    btn.dataset[datasetKey] = skin.id;
    btn.style.setProperty("--rarity", skin.color);
    btn.innerHTML = `
      ${skinArt(skin)}
      <div class="card-price">${skin.price.toFixed(2)} <small>T</small></div>
      <div class="card-wear">${skin.wear}</div>
      <div class="name">${skin.weapon}</div>
      <div class="sub">${skin.skin}</div>
    `;
    return btn;
  }

  function renderInventory() {
    const root = document.getElementById("myItems");
    if (!root) return;

    if (!window.GarbonaAuth.isLoggedIn()) {
      root.innerHTML = `<div class="auth-empty">
          <p class="empty-hint">Sign in to use your items</p>
          <button class="btn btn-steam" type="button" data-open-auth>
            <img src="assets/steam.svg" alt="" />
            Sign in via Steam
          </button>
        </div>`;
      bindAuthButtons(root);
      return;
    }

    const items = window.GarbonaData.inventoryPool;
    root.innerHTML = `<div class="inventory-grid"></div>`;
    const grid = root.querySelector(".inventory-grid");
    items.forEach((skin) => {
      const btn = skinCardButton(skin, "invId");
      btn.addEventListener("click", () => setStake(skin));
      grid.appendChild(btn);
    });
    highlightSelected();
  }

  function renderCatalog(min = 0, max = Infinity) {
    const root = document.getElementById("catalogGrid");
    if (!root) return;
    root.innerHTML = "";
    window.GarbonaData.catalog
      .filter((s) => s.price >= min && s.price <= max)
      .forEach((skin) => {
        const btn = skinCardButton(skin, "catId");
        btn.addEventListener("click", () => setTarget(skin));
        root.appendChild(btn);
      });
    highlightSelected();
  }

  function bindAuthButtons(scope = document) {
    scope.querySelectorAll("[data-open-auth]").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("garbona:need-auth"));
      });
    });
  }

  function runUpgrade() {
    if (!window.GarbonaAuth.requireAuth()) return;
    if (!state.stake || !state.target) return;

    const wheel = document.getElementById("upgradeWheel");
    const btn = document.getElementById("upgradeBtn");
    const ch = chance();
    btn.disabled = true;
    wheel?.classList.add("spinning");
    playClick();

    setTimeout(() => {
      wheel?.classList.remove("spinning");
      const win = Math.random() * 100 < ch;
      window.GarbonaUI?.toast(
        win
          ? `Success! You got ${state.target.label}`
          : `Fail. Stake ${state.stake.label} is lost`,
        win ? "win" : "lose"
      );
      if (win) {
        state.stake = { ...state.target, id: `${state.target.id}-won-${Date.now()}` };
      } else {
        state.stake = null;
      }
      renderSlots();
      renderInventory();
      btn.disabled = !(state.stake && state.target);
    }, 1100);
  }

  function init() {
    renderSlots();
    renderInventory();
    renderCatalog();

    document.getElementById("upgradeBtn")?.addEventListener("click", runUpgrade);
    document.getElementById("priceFrom")?.addEventListener("input", applyPriceFilter);
    document.getElementById("priceTo")?.addEventListener("input", applyPriceFilter);

    window.addEventListener("garbona:auth", () => {
      renderInventory();
      renderSlots();
    });

    bindAuthButtons();
  }

  function applyPriceFilter() {
    const from = Number(document.getElementById("priceFrom")?.value || 0);
    const toRaw = document.getElementById("priceTo")?.value;
    const to = toRaw === "" || toRaw == null ? Infinity : Number(toRaw);
    renderCatalog(from || 0, Number.isFinite(to) ? to : Infinity);
  }

  return {
    init,
    setStake,
    setTarget,
    renderInventory,
    setSound(v) {
      state.sound = Boolean(v);
    },
    getSound: () => state.sound,
  };
})();
