"use client";

import { useEffect, useRef, useState } from "react";
import { toApiItems, type CartLine } from "@/lib/pos/cart";
import type { PosMedicine, Quote, QuoteFailure } from "@/server/db/pos";

/**
 * Server-priced cart. Every change re-asks the server (debounced, and a stale answer
 * is abandoned), so the totals on screen are always what complete_sale would charge.
 * Status is derived from which request the latest answer belongs to, so it never
 * shows an old total as if it were current.
 */
export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: Quote }
  | { status: "error"; failure: QuoteFailure };

type Answer = { key: string; quote?: Quote; failure?: QuoteFailure };

export function useQuote(lines: CartLine[], debounceMs = 150): QuoteState {
  const items = toApiItems(lines);
  const key = JSON.stringify(items);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (items.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/pos/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: JSON.parse(key) }),
          signal: controller.signal,
        });
        const body = (await response.json()) as { quote?: Quote; error?: QuoteFailure };
        if (response.ok && body.quote) setAnswer({ key, quote: body.quote });
        else
          setAnswer({
            key,
            failure: body.error ?? { code: "UNKNOWN", message: "Couldn't price the cart. Try again.", hint: null },
          });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setAnswer({
          key,
          failure: { code: "UNAVAILABLE", message: "We couldn't reach the server. Check your connection.", hint: null },
        });
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` fully describes the cart; `items` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs]);

  if (items.length === 0) return { status: "idle" };
  if (!answer || answer.key !== key) return { status: "loading" };
  if (answer.quote) return { status: "ready", quote: answer.quote };
  return { status: "error", failure: answer.failure ?? { code: "UNKNOWN", message: "Couldn't price the cart.", hint: null } };
}

export type SearchState =
  | { status: "idle"; items: PosMedicine[] }
  | { status: "loading"; items: PosMedicine[] }
  | { status: "ready"; items: PosMedicine[] }
  | { status: "error"; items: PosMedicine[]; message: string };

type SearchAnswer = { query: string; items: PosMedicine[]; error?: string };

async function fetchSearch(query: string, signal?: AbortSignal): Promise<PosMedicine[]> {
  const response = await fetch(`/api/pos/search?q=${encodeURIComponent(query)}`, { signal, cache: "no-store" });
  const body = (await response.json()) as { items?: PosMedicine[]; error?: { message?: string } };
  if (!response.ok || !body.items) throw new Error(body.error?.message ?? "Search failed.");
  return body.items;
}

/**
 * Debounced search that cancels the previous request. `searchNow` skips the debounce
 * (a barcode scanner ends with Enter) and returns the fresh results.
 */
export function useProductSearch(query: string, debounceMs = 150) {
  const trimmed = query.trim();
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const latest = useRef(trimmed);

  useEffect(() => {
    latest.current = trimmed;
    if (trimmed === "") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const items = await fetchSearch(trimmed, controller.signal);
        setAnswer({ query: trimmed, items });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setAnswer({ query: trimmed, items: [], error: (error as Error).message });
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, debounceMs]);

  async function searchNow(): Promise<PosMedicine[]> {
    const q = latest.current;
    if (q === "") return [];
    try {
      const items = await fetchSearch(q);
      setAnswer({ query: q, items });
      return items;
    } catch (error) {
      setAnswer({ query: q, items: [], error: (error as Error).message });
      return [];
    }
  }

  let state: SearchState;
  if (trimmed === "") state = { status: "idle", items: [] };
  else if (!answer || answer.query !== trimmed) state = { status: "loading", items: answer?.items ?? [] };
  else if (answer.error) state = { status: "error", items: [], message: answer.error };
  else state = { status: "ready", items: answer.items };

  return { state, searchNow };
}
