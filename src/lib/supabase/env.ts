/**
 * The only Supabase values the Next.js app reads. Both are public by design;
 * row-level security protects the data. A service-role key is deliberately not
 * read anywhere in this codebase yet.
 */
export type SupabaseEnv = { url: string; publishableKey: string };

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return { url, publishableKey };
}
