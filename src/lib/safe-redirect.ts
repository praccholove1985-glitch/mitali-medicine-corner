/**
 * Accepts only same-site absolute paths for post-login redirects, so
 * `?next=https://evil.example` or `?next=//evil.example` can never leave the app.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Control characters, backslashes or an embedded scheme are never legitimate.
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;
  if (/^\/[^?#]*:\/\//.test(value)) return fallback;
  // Do not bounce back to the login page itself.
  if (value === "/login" || value.startsWith("/login?")) return fallback;
  return value;
}
