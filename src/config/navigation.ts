import {
  BarChart3,
  Boxes,
  Building2,
  CornerUpLeft,
  Landmark,
  LayoutDashboard,
  Palette,
  Pill,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Implementation phase that delivers this module (docs/IMPLEMENTATION_PLAN.md). */
  phase: number | null;
  /** One line shown on the placeholder page. */
  summary: string;
  /** What the module will do; shown on the placeholder page. */
  planned: string[];
  /** The module has its own pages; it needs no placeholder. */
  built?: boolean;
  /**
   * The item is shown when the user holds ANY of these permissions. Omitted
   * means everyone signed in. Cosmetic only: the database enforces access.
   */
  anyOf?: string[];
};

export type NavGroup = { label: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        phase: null,
        summary: "Today at a glance.",
        planned: [],
      },
    ],
  },
  {
    label: "Sell",
    items: [
      {
        href: "/pos",
        anyOf: ["sale.create"],
        label: "POS",
        icon: ShoppingCart,
        phase: 5,
        summary: "Fast counter sales with FEFO batch selection and mixed payments.",
        planned: [
          "Search by name, generic, brand, company, barcode or SKU",
          "Earliest-expiry batch chosen automatically; expired stock blocked",
          "Cash, bKash, Nagad, Rocket, card, bank and credit, split across methods",
          "One atomic server call per sale, with invoice printing",
        ],
      },
      {
        href: "/customers",
        anyOf: ["customer.view"],
        label: "Customers",
        icon: Users,
        phase: 6,
        summary: "Customer records, dues and statements.",
        planned: [
          "Walk-in and registered customers, phone search",
          "Transaction-based ledger with payments and credits",
          "Statements and SMS due reminders",
        ],
      },
    ],
  },
  {
    label: "Stock",
    items: [
      {
        href: "/medicines",
        anyOf: ["medicine.view"],
        label: "Medicines",
        icon: Pill,
        phase: null,
        built: true,
        summary: "The medicine catalogue: names, generics, companies, categories and prices.",
        planned: [
          "Medicine master with company, category and dosage form",
          "Batches with expiry, cost and sale price kept separate",
          "Barcode and SKU, with change history",
        ],
      },
      {
        href: "/inventory",
        anyOf: ["stock.view"],
        label: "Inventory",
        icon: Boxes,
        phase: null,
        built: true,
        summary: "Stock on hand by batch, expiry watch and the movement history.",
        planned: [
          "Per-batch stock with FEFO order",
          "Expiry buckets and low-stock alerts",
          "Adjustments, damage and write-offs with a reason on every change",
        ],
      },
      {
        href: "/purchases",
        anyOf: ["purchase.view"],
        label: "Purchases",
        icon: Truck,
        phase: 7,
        summary: "Receive stock from suppliers and track what is owed.",
        planned: [
          "Supplier invoices with batch, expiry, free quantity and VAT",
          "Supplier ledger and payments",
          "OCR import of invoice photos, reviewed before saving",
        ],
      },
      {
        href: "/suppliers",
        anyOf: ["supplier.view"],
        label: "Suppliers",
        icon: Building2,
        phase: 7,
        summary: "Supplier records and balances.",
        planned: ["Supplier directory", "Supplier ledger and statements"],
      },
      {
        href: "/returns",
        anyOf: ["sale.return", "purchase.return"],
        label: "Returns",
        icon: CornerUpLeft,
        phase: 8,
        summary: "Sales and purchase returns that reverse stock, revenue and profit.",
        planned: [
          "Returns never edit or delete the original sale or purchase",
          "Stock goes back to the original batch",
          "Revenue, cost and profit reversed from the recorded batch cost",
        ],
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        href: "/finance",
        anyOf: ["expense.view", "finance.view_profit"],
        label: "Finance",
        icon: Landmark,
        phase: 9,
        summary: "Expenses, payment methods and profit and loss.",
        planned: [
          "Expense tracking by category",
          "Profit from the actual cost of the batches sold",
          "Cash and mobile-banking summaries",
        ],
      },
      {
        href: "/reports",
        anyOf: ["report.view", "report.view_own"],
        label: "Reports",
        icon: BarChart3,
        phase: 10,
        summary: "Server-side reports for any date range.",
        planned: [
          "Sales, purchases, profit and expenses",
          "Inventory, movements, expiry and low stock",
          "Customer and supplier dues, staff sales",
        ],
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/staff",
        anyOf: ["staff.view", "staff.manage"],
        label: "Staff",
        icon: UserCog,
        phase: 14,
        summary: "Staff accounts, roles and permissions, and the audit trail.",
        planned: [
          "Admin, manager, pharmacist, cashier and staff roles",
          "Permissions enforced in the database",
          "Audit log of sales, stock, price and permission changes",
        ],
      },
      {
        href: "/settings",
        anyOf: ["settings.view", "settings.edit"],
        label: "Settings",
        icon: Settings,
        phase: 14,
        summary: "Pharmacy profile, invoice details and system settings.",
        planned: ["Pharmacy profile and invoice header", "Timezone and tax defaults"],
      },
    ],
  },
];

/** The component gallery is a development aid and is not linked in production. */
export const developerGroup: NavGroup = {
  label: "Developer",
  items: [
    {
      href: "/design-system",
      label: "Design system",
      icon: Palette,
      phase: null,
      summary: "Tokens and components.",
      planned: [],
    },
  ],
};

export function getNavGroups(): NavGroup[] {
  return process.env.NODE_ENV === "production"
    ? navGroups
    : [...navGroups, developerGroup];
}

/** Modules served by the generic placeholder route (everything but the dashboard). */
export const placeholderModules: NavItem[] = navGroups
  .flatMap((group) => group.items)
  .filter((item) => item.href !== "/" && !item.built);

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function canSee(
  item: { readonly anyOf?: readonly string[] },
  permissions: readonly string[],
): boolean {
  if (!item.anyOf || item.anyOf.length === 0) return true;
  return item.anyOf.some((code) => permissions.includes(code));
}

/** Groups with the items the user may see; empty groups are dropped. */
export function visibleNavGroups(permissions: readonly string[]): NavGroup[] {
  return getNavGroups()
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSee(item, permissions)),
    }))
    .filter((group) => group.items.length > 0);
}
