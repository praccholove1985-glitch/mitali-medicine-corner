"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/common/error-state";

/**
 * Route error boundary. The raw error message is never shown to the user;
 * the digest lets support match the server log.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Route error", { digest: error.digest, name: error.name });
  }, [error]);

  return (
    <Card>
      <ErrorState
        size="page"
        title="This page couldn't be shown"
        message="Something went wrong on our side. Try again, and if it keeps happening let the shop manager know."
        reference={error.digest}
        onRetry={retry}
      />
    </Card>
  );
}
