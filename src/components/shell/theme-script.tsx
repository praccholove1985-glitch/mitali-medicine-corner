export const THEME_STORAGE_KEY = "mmc-theme";

/**
 * Mitali Pharmacy uses a light, paper-white interface throughout the app.
 * Set the theme before first paint and replace any previously stored dark
 * preference so returning users see the same consistent workspace.
 */
const script = `document.documentElement.setAttribute("data-theme","light");try{localStorage.setItem("${THEME_STORAGE_KEY}","light")}catch(e){}`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
