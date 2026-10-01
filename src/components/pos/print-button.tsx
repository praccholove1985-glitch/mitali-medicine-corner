"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" size="lg" variant="outline" onClick={() => window.print()}>
      <Printer aria-hidden />
      Print invoice
    </Button>
  );
}
