"use client";

import { useSyncExternalStore } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * Reports the browser's network state only (navigator.onLine). The server
 * snapshot is "online" so server and first client render match; it settles to
 * the real value right after hydration.
 */
export function ConnectionIndicator() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const Icon = online ? Wifi : WifiOff;

  return (
    <div
      role="status"
      title="Browser network status"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
        online
          ? "bg-success-soft text-success-text"
          : "bg-warning-soft text-warning-text",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{online ? "Online" : "Offline"}</span>
      <span className="sr-only sm:hidden">{online ? "Online" : "Offline"}</span>
    </div>
  );
}
