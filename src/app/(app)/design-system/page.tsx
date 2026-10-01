import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge, ExpiryBadge, StockBadge } from "@/components/common/status-badge";
import { MoneyText } from "@/components/common/money-text";
import { StatCard } from "@/components/common/stat-card";
import { Banknote } from "lucide-react";
import { DesignSystemDemo } from "./demo";

export const metadata: Metadata = { title: "Design system" };

const swatches = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["muted", "bg-muted"],
  ["primary", "bg-primary"],
  ["accent", "bg-accent"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
  ["foreground", "bg-foreground"],
  ["muted-foreground", "bg-muted-foreground"],
] as const;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function DesignSystemPage() {
  // Development aid only; it is not linked and does not exist in production.
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <>
      <PageHeader
        eyebrow="Developer"
        title="Design system"
        description="Tokens and components used across the application. Use the theme toggle in the top bar to check both themes."
      />

      <Alert tone="warning" title="Sample values" className="mb-4">
        Names, quantities and amounts on this page exist only to show layout.
        They are not stored anywhere and are not pharmacy data.
      </Alert>

      <Section title="Colour tokens" description="Defined once in globals.css; components never use raw hex.">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {swatches.map(([name, cls]) => (
            <li key={name} className="flex flex-col gap-1.5">
              <span className={`h-14 rounded-lg border ${cls}`} />
              <span className="font-mono text-xs text-muted-foreground">{name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-semibold tracking-tight">Page title — 24 / semibold</p>
          <p className="text-base font-semibold">Section heading — 16 / semibold</p>
          <p className="text-sm">Body text — 14 / regular. Dispensing notes stay readable at counter distance.</p>
          <p className="text-xs text-muted-foreground">Caption — 12 / muted</p>
          <p className="tabular text-lg font-semibold">
            Tabular figures: <MoneyText amount="1234567.5" /> · <MoneyText amount="98.05" /> · <MoneyText amount="7" />
          </p>
          <p lang="bn" className="text-base">বাংলা লেখা: প্যারাসিটামল ৫০০ মি.গ্রা. ট্যাবলেট</p>
          <p className="text-sm">
            No value: <MoneyText amount={null} />
          </p>
        </div>
      </Section>

      <Section title="Buttons" description="Primary, secondary, outline, ghost, danger, link; sizes sm/md/lg and a 48px POS size.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Saving</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="pos">Charge (POS)</Button>
          </div>
        </div>
      </Section>

      <Section title="Status badges" description="Icon plus text; colour only reinforces.">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="success">Paid</StatusBadge>
          <StatusBadge tone="warning">Partly paid</StatusBadge>
          <StatusBadge tone="danger">Due</StatusBadge>
          <StatusBadge tone="primary">Draft</StatusBadge>
          <StatusBadge tone="neutral">Cancelled</StatusBadge>
          <ExpiryBadge daysToExpiry={0} />
          <ExpiryBadge daysToExpiry={12} />
          <ExpiryBadge daysToExpiry={75} />
          <ExpiryBadge daysToExpiry={400} />
          <StockBadge quantity={0} reorderLevel={20} />
          <StockBadge quantity={8} reorderLevel={20} />
          <StockBadge quantity={150} reorderLevel={20} />
        </div>
      </Section>

      <Section title="Stat cards">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="With a value" icon={Banknote} value={<MoneyText amount="48250" />} caption="Sample figure" />
          <StatCard label="No data source" icon={Banknote} value={null} pendingNote="Available after Phase 5" />
          <StatCard label="Loading" icon={Banknote} value={null} loading />
        </div>
      </Section>

      <Section title="Alerts">
        <div className="flex flex-col gap-2">
          <Alert tone="info" title="Information">A neutral note about what is happening.</Alert>
          <Alert tone="success" title="Saved">The change was recorded.</Alert>
          <Alert tone="warning" title="Check this">Stock is running low.</Alert>
          <Alert tone="danger" title="Couldn't complete">Try again or contact the manager.</Alert>
        </div>
      </Section>

      <DesignSystemDemo />
    </>
  );
}
