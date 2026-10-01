export type Role = "ADMIN" | "MANAGER" | "PHARMACIST" | "CASHIER" | "STAFF";

export type SessionUser = {
  id: string;
  email: string | null;
  fullName: string;
};

export type ActiveBranch = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
};

export type SessionContext =
  | { status: "unconfigured" }
  | { status: "anonymous" }
  | { status: "no_access"; user: SessionUser }
  | {
      status: "ready";
      user: SessionUser;
      branch: ActiveBranch;
      /** Number of branches the user can act in; >1 will enable a switcher. */
      branchCount: number;
      role: Role;
      /** Effective permission codes. Drives the UI only; the database re-checks. */
      permissions: string[];
    };
