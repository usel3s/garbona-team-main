(function () {
  const COPY = {
    ru: {
      title: "Страница не найдена",
      text: "Возможно, ссылка устарела или была введена с опечаткой. Вернитесь на главную и попробуйте ещё раз.",
      home: "На главную",
      back: "Назад",
      brand: "Garbona",
    },
    en: {
      title: "Page not found",
      text: "The link may be outdated or typed incorrectly. Go back home and try again.",
      home: "Go home",
      back: "Back",
      brand: "Garbona",
    },
  };

  function prefs() {
    try {
      const parsed = JSON.parse(localStorage.getItem("garbona_worker_prefs") || "{}");
      return {
        lang: parsed.lang === "en" ? "en" : "ru",
        theme: parsed.theme === "light" ? "light" : "dark",
      };
    } catch (_) {
      return { lang: "ru", theme: "dark" };
    }
  }

  const { lang, theme } = prefs();
  const copy = COPY[lang] || COPY.ru;
  document.documentElement.lang = lang;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "light" ? "#fafafa" : "#0a0a0a"
  );
  document.title = `${copy.title} — ${copy.brand}`;

  const labels = {
    "notFound.title": copy.title,
    "notFound.text": copy.text,
    "notFound.home": copy.home,
    "common.back": copy.back,
  };
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const text = labels[el.getAttribute("data-i18n")];
    if (text) el.textContent = text;
  });

  const back = document.getElementById("notFoundBack");
  if (back && history.length > 1) {
    back.addEventListener("click", (event) => {
      event.preventDefault();
      history.back();
    });
  }
})();
