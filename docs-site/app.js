(function () {
  "use strict";

  const docs = window.GarbonaDocs;
  const article = document.getElementById("article");
  const nav = document.getElementById("docsNav");
  const toc = document.getElementById("pageToc");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("mobileBackdrop");
  const menuButton = document.getElementById("menuButton");
  const closeMenuButton = document.getElementById("closeMenuButton");
  const searchModal = document.getElementById("searchModal");
  const searchTrigger = document.getElementById("searchTrigger");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  const copyPageLink = document.getElementById("copyPageLink");
  const toast = document.getElementById("toast");

  if (!docs || !Array.isArray(docs.pages) || docs.pages.length === 0) {
    article.innerHTML = "<h1>Документация недоступна</h1><p>Не удалось загрузить содержимое.</p>";
    return;
  }

  const pageById = new Map(docs.pages.map((page) => [page.id, page]));
  const headingToPage = new Map();
  const searchIndex = [];
  let currentPage = docs.pages[0];
  let selectedSearchIndex = 0;
  let visibleSearchResults = [];
  let toastTimer = 0;
  let tocObserver = null;
  let lastFocusedElement = null;

  const icons = {
    home: '<path d="M4 10.5 12 4l8 6.5V20H5a1 1 0 0 1-1-1v-8.5Z"/><path d="M9.5 20v-6h5v6"/>',
    rocket: '<path d="M14 5.2c2.1-1.4 4.2-1.3 5.8-1-0.1 1.8-0.7 4.1-2.6 6l-4.7 4.7-3.6-3.6L14 5.2Z"/><path d="m8.9 11.3-3.4.5-2 2 4.1 1.3M12.5 14.9l-.5 3.5-2 2-1.3-4.1"/><circle cx="15.6" cy="8.4" r="1.4"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M8.5 9v10.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
    link: '<path d="M9.5 14.5 14.5 9"/><path d="M7.8 17.2H6.5a4 4 0 0 1 0-8h3M16.2 6.8h1.3a4 4 0 1 1 0 8h-3"/>',
    chart: '<path d="M4 19.5h16M7 16v-5M12 16V6.5M17 16v-3"/>',
    wallet: '<path d="M4 7.5h14.5A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V7.5Z"/><path d="M4 7.5V6a1.5 1.5 0 0 1 1.5-1.5H17M15 12h5v3h-5a1.5 1.5 0 0 1 0-3Z"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.2a2.5 2.5 0 0 1 4.8 1c0 1.9-2.5 2.2-2.5 4M12 17.5h.01"/>',
    book: '<path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h4.5v16H7a2.5 2.5 0 0 0-2.5 2V5.5Z"/><path d="M19.5 5.5A2.5 2.5 0 0 0 17 3h-5.5v16H17a2.5 2.5 0 0 1 2.5 2V5.5Z"/>',
    shield: '<path d="M12 3.5 19 6v5.5c0 4.3-2.8 7.4-7 9-4.2-1.6-7-4.7-7-9V6l7-2.5Z"/><path d="m8.8 12 2.1 2.1 4.5-4.5"/>',
    bot: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8.5 12h.01M15.5 12h.01M8.5 16h7"/>',
    media: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/>',
  };

  function iconSvg(name, className) {
    return `<svg class="${className || ""}" viewBox="0 0 24 24" aria-hidden="true">${
      icons[name] || icons.home
    }</svg>`;
  }

  function plainText(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return (template.content.textContent || "").replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildIndex() {
    docs.pages.forEach((page) => {
      searchIndex.push({
        pageId: page.id,
        hash: page.id,
        title: page.title,
        meta: page.description,
        searchText: normalize(`${page.title} ${page.description} ${plainText(page.body)}`),
        type: "page",
      });

      const template = document.createElement("template");
      template.innerHTML = page.body;
      template.content.querySelectorAll("h2[id], h3[id]").forEach((heading) => {
        headingToPage.set(heading.id, page.id);
        let context = "";
        let sibling = heading.nextElementSibling;
        while (sibling && !/^H[23]$/.test(sibling.tagName)) {
          context += ` ${sibling.textContent || ""}`;
          if (context.length > 240) break;
          sibling = sibling.nextElementSibling;
        }
        searchIndex.push({
          pageId: page.id,
          hash: heading.id,
          title: heading.textContent.trim(),
          meta: `${page.title} · ${context.replace(/\s+/g, " ").trim().slice(0, 115)}`,
          searchText: normalize(`${heading.textContent} ${context} ${page.title}`),
          type: "heading",
        });
      });
    });
  }

  function renderNavigation() {
    nav.innerHTML = docs.groups
      .map((group) => {
        const pages = docs.pages.filter((page) => page.group === group.id);
        if (!pages.length) return "";
        return `
          <section class="nav-group" aria-labelledby="nav-group-${group.id}">
            <h2 class="nav-group-title" id="nav-group-${group.id}">${group.title}</h2>
            ${pages
              .map(
                (page) => `
                <a class="nav-link" href="#${page.id}" data-page="${page.id}">
                  ${iconSvg(page.icon, "nav-icon")}
                  <span>${page.title}</span>
                </a>`
              )
              .join("")}
          </section>`;
      })
      .join("");
  }

  function articleNavigation(page) {
    const index = docs.pages.findIndex((item) => item.id === page.id);
    const previous = docs.pages[index - 1];
    const next = docs.pages[index + 1];
    return `
      <footer class="article-footer">
        ${
          previous
            ? `<a class="article-prev" href="#${previous.id}">
                <span class="article-nav-label">Назад</span>
                <span class="article-nav-title">← ${previous.title}</span>
              </a>`
            : "<span></span>"
        }
        ${
          next
            ? `<a class="article-next" href="#${next.id}">
                <span class="article-nav-label">Далее</span>
                <span class="article-nav-title">${next.title} →</span>
              </a>`
            : "<span></span>"
        }
      </footer>`;
  }

  function enhanceHeadings() {
    article.querySelectorAll(".article-body h2[id], .article-body h3[id]").forEach((heading) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "heading-anchor";
      button.setAttribute("aria-label", `Скопировать ссылку на раздел «${heading.textContent}»`);
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8M10 8H8a4 4 0 0 0 0 8h2M14 8h2a4 4 0 0 1 0 8h-2"/></svg>';
      button.addEventListener("click", () => copyHashLink(heading.id));
      heading.prepend(button);
    });
  }

  function enhanceCodeBlocks() {
    article.querySelectorAll(".code-block").forEach((block) => {
      const code = block.querySelector("code");
      if (!code) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-code";
      button.setAttribute("aria-label", "Скопировать код");
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
      button.addEventListener("click", async () => {
        const copied = await copyText(code.textContent.trim());
        showToast(copied ? "Скопировано" : "Не удалось скопировать");
      });
      block.append(button);
    });
  }

  function renderToc() {
    const headings = [...article.querySelectorAll(".article-body h2[id], .article-body h3[id]")];
    toc.innerHTML = headings
      .map(
        (heading) =>
          `<a class="toc-link" data-level="${heading.tagName.slice(1)}" href="#${heading.id}">${heading.textContent.trim()}</a>`
      )
      .join("");

    if (tocObserver) tocObserver.disconnect();
    if (!headings.length || !("IntersectionObserver" in window)) return;

    tocObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (!visible.length) return;
        setActiveToc(visible[0].target.id);
      },
      { rootMargin: "-90px 0px -72% 0px", threshold: 0 }
    );
    headings.forEach((heading) => tocObserver.observe(heading));
  }

  function setActiveToc(id) {
    toc.querySelectorAll(".toc-link").forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
    });
  }

  function renderPage(page, targetHash, options) {
    currentPage = page;
    document.title = `${page.title} — Garbona Docs`;
    article.innerHTML = `
      <header class="article-header">
        <div class="eyebrow">${page.eyebrow}</div>
        <h1>${page.title}</h1>
        <p class="article-lead">${page.description}</p>
      </header>
      <div class="article-body">${page.body}</div>
      ${articleNavigation(page)}
    `;

    nav.querySelectorAll(".nav-link").forEach((link) => {
      const active = link.dataset.page === page.id;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    enhanceHeadings();
    enhanceCodeBlocks();
    renderToc();
    closeMenu();

    requestAnimationFrame(() => {
      const target = targetHash && targetHash !== page.id ? document.getElementById(targetHash) : null;
      if (target) {
        target.scrollIntoView({ behavior: options?.instant ? "auto" : "smooth", block: "start" });
        setActiveToc(targetHash);
      } else {
        window.scrollTo({ top: 0, behavior: options?.instant ? "auto" : "smooth" });
      }
    });
  }

  function routeFromHash(options) {
    const hash = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
    const pageId = pageById.has(hash) ? hash : headingToPage.get(hash);
    const page = pageById.get(pageId) || docs.pages[0];

    if (!hash) {
      history.replaceState(null, "", `#${page.id}`);
    }
    renderPage(page, hash || page.id, options);
  }

  function openMenu() {
    sidebar.classList.add("is-open");
    backdrop.hidden = false;
    document.body.classList.add("menu-open");
    menuButton.setAttribute("aria-expanded", "true");
    closeMenuButton.focus();
  }

  function closeMenu() {
    sidebar.classList.remove("is-open");
    backdrop.hidden = true;
    document.body.classList.remove("menu-open");
    menuButton.setAttribute("aria-expanded", "false");
  }

  function search(query) {
    const words = normalize(query).split(" ").filter(Boolean);
    if (!words.length) {
      return searchIndex.filter((item) => item.type === "page").slice(0, 8);
    }

    return searchIndex
      .map((item) => {
        if (!words.every((word) => item.searchText.includes(word))) return null;
        const title = normalize(item.title);
        const score = words.reduce((total, word) => {
          if (title === word) return total + 8;
          if (title.startsWith(word)) return total + 5;
          if (title.includes(word)) return total + 3;
          return total + 1;
        }, item.type === "heading" ? 1 : 0);
        return { ...item, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ru"))
      .slice(0, 10);
  }

  function renderSearchResults(query) {
    visibleSearchResults = search(query);
    selectedSearchIndex = Math.min(selectedSearchIndex, Math.max(visibleSearchResults.length - 1, 0));

    if (!visibleSearchResults.length) {
      searchResults.innerHTML = '<div class="search-empty">Ничего не найдено. Попробуйте другой запрос.</div>';
      return;
    }

    searchResults.innerHTML = visibleSearchResults
      .map(
        (result, index) => `
          <button
            class="search-result${index === selectedSearchIndex ? " is-selected" : ""}"
            type="button"
            role="option"
            aria-selected="${index === selectedSearchIndex}"
            data-result-index="${index}"
          >
            <span class="search-result-icon">${iconSvg(result.type === "page" ? "panel" : "link")}</span>
            <span class="search-result-copy">
              <span class="search-result-title">${escapeHtml(result.title)}</span>
              <span class="search-result-meta">${escapeHtml(
                result.meta || pageById.get(result.pageId)?.title || ""
              )}</span>
            </span>
          </button>`
      )
      .join("");

    searchResults.querySelectorAll("[data-result-index]").forEach((button) => {
      button.addEventListener("mouseenter", () => {
        selectedSearchIndex = Number(button.dataset.resultIndex);
        syncSearchSelection();
      });
      button.addEventListener("click", () => openSearchResult(Number(button.dataset.resultIndex)));
    });
  }

  function syncSearchSelection() {
    searchResults.querySelectorAll("[data-result-index]").forEach((button, index) => {
      const selected = index === selectedSearchIndex;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
      if (selected) button.scrollIntoView({ block: "nearest" });
    });
  }

  function openSearchResult(index) {
    const result = visibleSearchResults[index];
    if (!result) return;
    closeSearch();
    if (location.hash === `#${result.hash}`) {
      routeFromHash();
    } else {
      location.hash = result.hash;
    }
  }

  function openSearch() {
    lastFocusedElement = document.activeElement;
    searchModal.hidden = false;
    document.body.classList.add("search-open");
    searchInput.value = "";
    selectedSearchIndex = 0;
    renderSearchResults("");
    requestAnimationFrame(() => searchInput.focus());
  }

  function closeSearch() {
    if (searchModal.hidden) return;
    searchModal.hidden = true;
    document.body.classList.remove("search-open");
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    }
  }

  async function copyHashLink(hash) {
    const url = new URL(location.href);
    url.hash = hash;
    const copied = await copyText(url.href);
    if (copied) {
      history.replaceState(null, "", `#${hash}`);
    }
    showToast(copied ? "Ссылка скопирована" : "Не удалось скопировать ссылку");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  menuButton.addEventListener("click", openMenu);
  closeMenuButton.addEventListener("click", closeMenu);
  backdrop.addEventListener("click", closeMenu);
  searchTrigger.addEventListener("click", openSearch);
  searchModal.querySelector("[data-close-search]").addEventListener("click", closeSearch);
  copyPageLink.addEventListener("click", () => copyHashLink(currentPage.id));

  searchInput.addEventListener("input", () => {
    selectedSearchIndex = 0;
    renderSearchResults(searchInput.value);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedSearchIndex = Math.min(selectedSearchIndex + 1, visibleSearchResults.length - 1);
      syncSearchSelection();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedSearchIndex = Math.max(selectedSearchIndex - 1, 0);
      syncSearchSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      openSearchResult(selectedSearchIndex);
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (searchModal.hidden) openSearch();
      else closeSearch();
      return;
    }

    if (event.key === "/" && searchModal.hidden) {
      const tag = document.activeElement?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        event.preventDefault();
        openSearch();
      }
      return;
    }

    if (event.key === "Escape") {
      if (!searchModal.hidden) closeSearch();
      else if (sidebar.classList.contains("is-open")) closeMenu();
    }
  });

  window.addEventListener("hashchange", () => routeFromHash());
  window.addEventListener("resize", () => {
    if (window.innerWidth >= 1024) closeMenu();
  });

  buildIndex();
  renderNavigation();
  routeFromHash({ instant: true });
})();
