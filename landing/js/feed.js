window.GarbonaFeed = (function () {
  const state = {
    online: 1840 + Math.floor(Math.random() * 400),
    players: 312450,
    upgrades: 8421190,
    filter: "all",
    turbo: false,
    timer: null,
  };

  function formatNum(n) {
    return Math.floor(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function renderOnline() {
    document.querySelectorAll("[data-online]").forEach((el) => {
      el.textContent = formatNum(state.online);
    });
    document.querySelectorAll("[data-players]").forEach((el) => {
      el.textContent = formatNum(state.players);
    });
    document.querySelectorAll("[data-upgrades]").forEach((el) => {
      el.textContent = formatNum(state.upgrades);
    });
  }

  function createFeedItem(skin, nick) {
    const item = document.createElement("article");
    item.className = "feed-item";
    item.dataset.hot = skin.hot ? "1" : "0";
    item.innerHTML = `
      <div class="bar" style="background:${skin.color}"></div>
      <div class="thumb" style="--rarity:${skin.color}">
        <img src="${skin.image}" alt="${skin.label}" loading="lazy"
          onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'thumb-fallback',textContent:'${skin.wear}'}))" />
      </div>
      <div class="meta">
        <div class="skin">${skin.weapon}</div>
        <div class="wear">${skin.skin} <span>(${skin.wearName})</span></div>
        <button type="button" class="nick-pill">
          <span class="nick-avatar" style="background:${skin.color}"></span>
          ${nick}
        </button>
      </div>
    `;
    return item;
  }

  function pushDrop(listEl) {
    if (!listEl) return;
    const skin = window.GarbonaData.makeSkin();
    const nick = window.GarbonaData.rand(window.GarbonaData.nicks);
    const node = createFeedItem(skin, nick);
    listEl.prepend(node);

    if (state.filter === "hot" && !skin.hot) {
      node.style.display = "none";
    }

    while (listEl.children.length > 40) {
      listEl.lastElementChild.remove();
    }

    state.upgrades += Math.floor(1 + Math.random() * 3);
    if (Math.random() > 0.7) state.players += 1;
    renderOnline();
  }

  function seed(listEl) {
    if (!listEl) return;
    listEl.innerHTML = "";
    for (let i = 0; i < 16; i += 1) {
      const skin = window.GarbonaData.makeSkin(Math.random());
      const nick = window.GarbonaData.rand(window.GarbonaData.nicks);
      const node = createFeedItem(skin, nick);
      listEl.appendChild(node);
    }
    applyFilter(listEl);
  }

  function applyFilter(listEl) {
    if (!listEl) return;
    [...listEl.children].forEach((child) => {
      if (state.filter === "hot") {
        child.style.display = child.dataset.hot === "1" ? "" : "none";
      } else {
        child.style.display = "";
      }
    });
  }

  function setFilter(filter, listEl, tabs) {
    state.filter = filter;
    tabs?.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    applyFilter(listEl);
  }

  function jitterOnline() {
    const delta = Math.floor(Math.random() * 17) - 8;
    state.online = Math.max(900, state.online + delta);
    renderOnline();
  }

  function start(listEl) {
    seed(listEl);
    renderOnline();
    clearInterval(state.timer);
    const tick = () => {
      pushDrop(listEl);
      jitterOnline();
    };
    state.timer = setInterval(tick, state.turbo ? 900 : 2200);
  }

  function setTurbo(on, listEl) {
    state.turbo = Boolean(on);
    if (listEl) start(listEl);
  }

  return {
    state,
    start,
    setFilter,
    setTurbo,
    formatNum,
    renderOnline,
  };
})();
