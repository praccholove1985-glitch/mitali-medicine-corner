import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canSee, navGroups, visibleNavGroups } from "./navigation";

const hrefs = (permissions: string[]) =>
  visibleNavGroups(permissions).flatMap((group) => group.items.map((item) => item.href));

describe("navigation permissions", () => {
  it("always shows the dashboard", () => {
    expect(hrefs([])).toContain("/");
  });

  it("shows nothing else without permissions", () => {
    expect(hrefs([]).filter((href) => href !== "/" && href !== "/design-system")).toEqual([]);
  });

  it("gives a cashier the counter modules only", () => {
    const cashier = ["sale.create", "medicine.view", "stock.view", "customer.view", "customer.edit", "customer.payment", "report.view_own"];
    const visible = hrefs(cashier);
    expect(visible).toEqual(expect.arrayContaining(["/pos", "/customers", "/medicines", "/inventory", "/reports"]));
    expect(visible).not.toContain("/purchases");
    expect(visible).not.toContain("/finance");
    expect(visible).not.toContain("/staff");
    expect(visible).not.toContain("/settings");
  });

  it("accepts any one of an item's permissions", () => {
    const returns = navGroups.flatMap((g) => g.items).find((i) => i.href === "/returns");
    expect(returns).toBeDefined();
    expect(canSee(returns!, ["purchase.return"])).toBe(true);
    expect(canSee(returns!, ["sale.return"])).toBe(true);
    expect(canSee(returns!, ["sale.create"])).toBe(false);
  });

  it("drops groups that end up empty", () => {
    const groups = visibleNavGroups([]);
    expect(groups.map((g) => g.label)).not.toContain("Money");
  });

  it("every gated module names real permission codes", () => {
    for (const item of navGroups.flatMap((g) => g.items)) {
      for (const code of item.anyOf ?? []) expect(code).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("only references permission codes that exist in the database catalogue", () => {
    const sql = readFileSync("supabase/migrations/20261001000004_reference_data.sql", "utf8");
    const catalogue = new Set([...sql.matchAll(/^\s*\('([a-z_]+\.[a-z_]+)',\s*'/gm)].map((m) => m[1]));
    expect(catalogue.size).toBeGreaterThan(20);
    for (const item of navGroups.flatMap((g) => g.items)) {
      for (const code of item.anyOf ?? []) expect(catalogue.has(code), code).toBe(true);
    }
  });
});
