(() => {
  const key = "theme";
  const themes = ["light", "dark", "auto"];
  const root = document.documentElement;

  const saved = () => {
    try {
      const theme = localStorage.getItem(key);
      return themes.includes(theme) ? theme : "auto";
    } catch {
      return "auto";
    }
  };

  const apply = (theme) => {
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    for (const meta of document.querySelectorAll('meta[name="theme-color"][media]')) {
      meta.dataset.media ??= meta.media;
      const scheme = meta.dataset.media.includes("dark") ? "dark" : "light";
      meta.media = theme === "auto" ? meta.dataset.media : theme === scheme ? "all" : "not all";
    }
    for (const input of document.querySelectorAll("[data-theme-switch] input")) {
      input.checked = input.value === theme;
    }
  };

  const choose = (theme) => {
    try {
      if (theme === "auto") localStorage.removeItem(key);
      else localStorage.setItem(key, theme);
    } catch {}
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !still) document.startViewTransition(() => apply(theme));
    else apply(theme);
  };

  const init = () => {
    for (const control of document.querySelectorAll("[data-theme-switch]")) {
      control.hidden = false;
      control.addEventListener("change", (event) => choose(event.target.value));
    }
    apply(saved());
  };

  apply(saved());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply(saved());
  });
})();
