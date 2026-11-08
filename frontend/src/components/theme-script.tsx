// Inline, blocking script that sets data-theme before first paint to avoid a
// flash of the wrong theme (zustand's persisted store only rehydrates after
// React mounts on the client).
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem("soila-pay-theme");
    var theme = raw ? JSON.parse(raw).state.theme : null;
    if (!theme) {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
`;

export function ThemeScript() {
  // suppressHydrationWarning: the browser has already executed (and may have
  // dropped the text of) this script before React hydrates, so its content
  // legitimately differs from the server HTML - that's not a real mismatch.
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
