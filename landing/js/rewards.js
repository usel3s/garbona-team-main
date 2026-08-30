window.GarbonaRewards = (function () {
  const giveaways = [
    {
      id: "hour",
      title: "Every hour",
      weapon: "M4A4",
      skin: "Asiimov",
      wear: "FT",
      price: 1962.05,
      depositFrom: 600,
      endsInSec: 13 * 60 + 19,
      players: 108,
    },
    {
      id: "day",
      title: "Every day",
      weapon: "AWP",
      skin: "Containment Breach",
      wear: "FT",
      price: 19309.99,
      depositFrom: 2000,
      endsInSec: 11 * 3600 + 13 * 60 + 19,
      players: 491,
    },
    {
      id: "week",
      title: "Every week",
      weapon: "Desert Eagle",
      skin: "Printstream",
      wear: "FN",
      price: 70975.07,
      depositFrom: 5000,
      endsInSec: 2 * 86400 + 11 * 3600 + 13 * 60,
      players: 2290,
    },
  ];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatLeft(sec) {
    const s = Math.max(0, Math.floor(sec));
    const days = Math.floor(s / 86400);
    const hrs = Math.floor((s % 86400) / 3600);
    const min = Math.floor((s % 3600) / 60);
    const secLeft = s % 60;
    return {
      days,
      hrs: pad(hrs),
      min: pad(min),
      sec: pad(secLeft),
    };
  }

  function skinImage(weapon, skin, wearName) {
    const hash = `${weapon} | ${skin} (${wearName})`;
    return window.GarbonaData.imageUrl(hash);
  }

  const wearNames = {
    FN: "Factory New",
    MW: "Minimal Wear",
    FT: "Field-Tested",
    WW: "Well-Worn",
    BS: "Battle-Scarred",
  };

  function renderGiveaways() {
    const root = document.getElementById("giveawaysRow");
    if (!root) return;
    root.innerHTML = "";

    giveaways.forEach((g) => {
      const wearName = wearNames[g.wear];
      const img = skinImage(g.weapon, g.skin, wearName);
      const left = formatLeft(g.endsInSec);
      const card = document.createElement("article");
      card.className = "giveaway-card glass";
      card.dataset.id = g.id;
      card.innerHTML = `
        <div class="giveaway-tag">${g.title}</div>
        <div class="giveaway-art" style="--rarity:#eb4b4b">
          <img src="${img}" alt="${g.weapon} | ${g.skin}" loading="lazy"
            onerror="this.style.display='none'" />
        </div>
        <div class="giveaway-name">${g.weapon}</div>
        <div class="giveaway-skin">${g.skin}</div>
        <div class="giveaway-price">${g.price.toLocaleString("en-US", { minimumFractionDigits: 2 })} <small>T</small></div>
        <div class="giveaway-timer" data-timer="${g.id}">
          <div><b data-d>${left.days}</b><span>Days</span></div>
          <div><b data-h>${left.hrs}</b><span>Hrs</span></div>
          <div><b data-m>${left.min}</b><span>Min</span></div>
          <div><b data-s>${left.sec}</b><span>Sec</span></div>
        </div>
        <div class="giveaway-players">${g.players} players</div>
        <button type="button" class="btn btn-join" data-join="${g.id}">Join</button>
        <div class="giveaway-dep">On deposit from: ${g.depositFrom.toFixed(2)} T</div>
        <button type="button" class="btn-link" data-winners="${g.id}">Recent winners</button>
      `;
      root.appendChild(card);
    });

    root.querySelectorAll("[data-join]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!window.GarbonaAuth.requireAuth()) return;
        window.GarbonaUI.toast("You joined the giveaway");
      });
    });

    root.querySelectorAll("[data-winners]").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.GarbonaUI.toast("Recent winners will appear here");
      });
    });
  }

  function tickTimers() {
    giveaways.forEach((g) => {
      g.endsInSec = Math.max(0, g.endsInSec - 1);
      const box = document.querySelector(`[data-timer="${g.id}"]`);
      if (!box) return;
      const left = formatLeft(g.endsInSec);
      box.querySelector("[data-d]").textContent = left.days;
      box.querySelector("[data-h]").textContent = left.hrs;
      box.querySelector("[data-m]").textContent = left.min;
      box.querySelector("[data-s]").textContent = left.sec;
    });
  }

  function renderTopDrops() {
    const root = document.getElementById("topDrops");
    if (!root || !window.GarbonaData) return;
    root.innerHTML = "";
    const pool = [...window.GarbonaData.catalog]
      .sort((a, b) => b.price - a.price)
      .slice(0, 24);
    pool.forEach((skin) => {
      const nick = window.GarbonaData.rand(window.GarbonaData.nicks);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "top-drop-card";
      btn.innerHTML = `
        <div class="skin-art" style="--rarity:${skin.color}">
          <img src="${skin.image}" alt="${skin.label}" loading="lazy"
            onerror="this.style.display='none';this.parentElement.classList.add('no-img')" />
        </div>
        <div class="card-price">${(skin.price * 12).toFixed(2)}</div>
        <div class="name">${skin.weapon}</div>
        <div class="sub">${skin.skin}</div>
        <div class="nick-pill"><span class="nick-avatar" style="background:${skin.color}"></span>${nick}</div>
      `;
      root.appendChild(btn);
    });
  }

  function bindWeekly() {
    document.getElementById("weeklySignIn")?.addEventListener("click", () => {
      if (!window.GarbonaAuth.requireAuth()) return;
      window.GarbonaUI.toast("Weekly drop unlocked");
    });
    document.getElementById("bonusesSignIn")?.addEventListener("click", () => {
      if (!window.GarbonaAuth.requireAuth()) return;
      window.GarbonaUI.toast("Bonus claimed");
    });
  }

  function init() {
    renderGiveaways();
    renderTopDrops();
    bindWeekly();
    setInterval(tickTimers, 1000);
  }

  return { init };
})();
