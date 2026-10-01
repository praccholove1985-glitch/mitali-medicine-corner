"use client";

import { useEffect, useState } from "react";
import type { PurchaseQuote } from "@/server/db/purchases";
import type { QuoteFailure } from "@/server/db/pos";

/**
 * Looks something up on the server as the user types. The latest answer wins: a slow older
 * request is abandoned, so a stale list never replaces a newer one.
 */
export function useLookup<T>(url: string, query: string, pick: (body: unknown) => T[], enabled = true, debounceMs = 200) {
  const [answer, setAnswer] = useState<{ key: string; items: T[]; failed: boolean } | null>(null);
  const key = `${url}?q=${query}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${url}?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) {
          setAnswer({ key, items: [], failed: true });
          return;
        }
        setAnswer({ key, items: pick(await response.json()), failed: false });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setAnswer({ key, items: [], failed: true });
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` fully describes the request; `pick` is a stable parser supplied by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, debounceMs]);

  const current = answer && answer.key === key ? answer : null;
  return { items: current?.items ?? [], loading: enabled && current === null, failed: current?.failed ?? false };
}

export type PurchaseQuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: PurchaseQuote }
  | { status: "error"; failure: QuoteFailure };

type Answer = { key: string; quote?: PurchaseQuote; failure?: QuoteFailure };

/**
 * Server-priced purchase. Every change re-asks the server (debounced, stale answers abandoned), so the
 * totals shown are exactly what create_purchase would record. Status is derived from which request
 * the latest answer belongs to, so an old total is never shown as current.
 */
export function usePurchaseQuote(supplierId: string | null, items: Array<Record<string, unknown>> | null, debounceMs = 250): PurchaseQuoteState {
  const key = supplierId && items && items.length > 0 ? JSON.stringify({ supplierId, items }) : "";
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/purchases/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: key,
          signal: controller.signal,
        });
        const body = (await response.json()) as { quote?: PurchaseQuote; error?: QuoteFailure };
        if (response.ok && body.quote) setAnswer({ key, quote: body.quote });
        else setAnswer({ key, failure: body.error ?? { code: "UNKNOWN", message: "Couldn't price the purchase. Try again.", hint: null } });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setAnswer({ key, failure: { code: "UNAVAILABLE", message: "We couldn't reach the server. Check your connection.", hint: null } });
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, debounceMs]);

  if (!key) return { status: "idle" };
  if (answer && answer.key === key) {
    if (answer.quote) return { status: "ready", quote: answer.quote };
    if (answer.failure) return { status: "error", failure: answer.failure };
  }
  return { status: "loading" };
}
