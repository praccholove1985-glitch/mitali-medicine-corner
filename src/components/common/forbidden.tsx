import { ShieldOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";

/** Shown instead of a page the user's role doesn't include. The database is the real gate. */
export function Forbidden({ section }: { section: string }) {
  return (
    <Card>
      <EmptyState
        size="page"
        icon={ShieldOff}
        title={`You don't have access to ${section}`}
        description="Ask the shop owner if you need it."
      />
    </Card>
  );
}
