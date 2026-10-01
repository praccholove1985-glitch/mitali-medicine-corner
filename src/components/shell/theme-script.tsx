export const THEME_STORAGE_KEY = "mmc-theme";

/**
 * Runs before first paint so the page never flashes the wrong theme. The saved
 * choice wins, otherwise the OS preference. Wrapped in try/catch because storage
 * can be blocked.
 */
const script = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
