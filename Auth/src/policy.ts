// Who may do what: roles, apps and the one policy function every part of the yard asks.
// Pure (no server code), so the pages, the API routes and the tests all use the same rules.
//
//   role    — a named bundle of permissions (admin, member)
//   apps    — which apps a member may open; admins get every app
//   status  — active, or suspended (locked out at once, sessions and all)
//   source  — "settings" for people named in ADMIN_EMAILS / ALLOWED_EMAILS (can't be edited in the
//             dashboard, so the owner can never be locked out), "dashboard" for everyone else

export const APPS = [
  { id: "tallyback", label: "TallyBack", href: "/tallyback" },
  { id: "reviewscout", label: "Review Scout", href: "/reviewscout" },
  { id: "splitbill", label: "SplitBill", href: "/splitbill" },
] as const;
export type AppId = (typeof APPS)[number]["id"];
export const APP_IDS: AppId[] = APPS.map((a) => a.id);
export const isAppId = (v: unknown): v is AppId => typeof v === "string" && (APP_IDS as string[]).includes(v);
export const appLabel = (id: AppId) => APPS.find((a) => a.id === id)!.label;

export type Permission = "apps:all" | "users:manage";
export const ROLES = {
  admin: { label: "Admin", about: "Every app, plus the admin dashboard: add people, set roles and app access.", permissions: ["apps:all", "users:manage"] },
  member: { label: "Member", about: "Only the apps an admin grants.", permissions: [] },
} as const satisfies Record<string, { label: string; about: string; permissions: readonly Permission[] }>;
export type Role = keyof typeof ROLES;
export const ROLE_IDS = Object.keys(ROLES) as Role[];
export const isRole = (v: unknown): v is Role => typeof v === "string" && v in ROLES;

export type Status = "active" | "suspended";

export interface Access {
  email: string;
  role: Role;
  apps: AppId[]; // as granted; see appsFor() for what the role adds
  status: Status;
  source: "settings" | "dashboard";
}

export type Action = { type: "app:use"; app: AppId } | { type: "users:manage" } | { type: "sign-in" };

const has = (a: Access, p: Permission) => (ROLES[a.role].permissions as readonly Permission[]).includes(p);

// The policy. No access record, or a suspended one, can do nothing at all.
export function can(access: Access | null | undefined, action: Action): boolean {
  if (!access || access.status !== "active") return false;
  switch (action.type) {
    case "sign-in":
      return true;
    case "users:manage":
      return has(access, "users:manage");
    case "app:use":
      return has(access, "apps:all") || access.apps.includes(action.app);
  }
}

// The apps someone can actually open, in nav order.
export const appsFor = (access: Access | null | undefined): AppId[] => APP_IDS.filter((app) => can(access, { type: "app:use", app }));

// Which app a page belongs to, from its path ("/splitbill?g=…" → splitbill). "/admin" is not an app.
export const appOfPath = (path: string): AppId | null => APPS.find((a) => path === a.href || path.startsWith(`${a.href}/`))?.id ?? null;

// ---- where someone's access comes from ----

export const normalEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");

// Comma, space, semicolon or newline separated; anything without an @ is ignored.
export function parseEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map(normalEmail)
      .filter((e) => e.includes("@")),
  );
}

export interface Settings {
  admins: Set<string>; // ADMIN_EMAILS
  allowed: Set<string>; // ALLOWED_EMAILS (the original invite list)
}

// Someone's access, in order: named admin in settings → their dashboard record → the old invite list.
// A dashboard record beats the old invite list, so an admin can restrict or suspend those people too.
export function resolveAccess(email: unknown, settings: Settings, record: Omit<Access, "source"> | null): Access | null {
  const e = normalEmail(email);
  if (!e) return null;
  if (settings.admins.has(e)) return { email: e, role: "admin", apps: [...APP_IDS], status: "active", source: "settings" };
  if (record) return { ...record, email: e, source: "dashboard" };
  if (settings.allowed.has(e)) return { email: e, role: "member", apps: [...APP_IDS], status: "active", source: "settings" };
  return null;
}
