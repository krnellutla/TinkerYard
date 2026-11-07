import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accessFor, deleteRecord, listRecords, recentLog, saveRecord, settings, type AccessRecord } from "./access";
import { ensureAuthTables, getAuth } from "./auth";
import { APP_IDS, appLabel, appsFor, can, normalEmail, resolveAccess, ROLES, type Access, type AppId, type Role } from "./policy";
import { adminUser, signedInUser, signInRequired } from "./session";

// The admin dashboard's API (/api/admin/people) and what every page asks about itself (/api/access).

export interface Person {
  email: string;
  role: Role;
  apps: AppId[]; // what they can open (the role's apps included)
  granted: AppId[]; // as stored, for editing
  status: Access["status"];
  source: Access["source"];
  locked: string | null; // why this row can't be edited here, if it can't
  note: string;
  joined: boolean; // has signed in at least once
  addedBy: string | null;
  updatedAt: string | null;
}

// Every reply is JSON, even when something unexpected throws.
function json(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      console.error("admin route failed:", e);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

async function authContext() {
  await ensureAuthTables();
  return (await getAuth().$context).internalAdapter;
}

// Sign someone out everywhere: used when they're suspended or removed, so it takes effect at once.
async function endSessions(email: string) {
  const adapter = await authContext();
  const user = await adapter.findUserByEmail(email);
  if (user) await adapter.deleteUserSessions(user.user.id);
}

// ---- GET /api/access: who am I and what may I open (for the nav, the app gate and the admin link) ----
export const me = json(async (req) => {
  const user = await signedInUser(req);
  if (!user) return signInRequired("see your access");
  const access = await accessFor(user.email);
  return NextResponse.json({
    email: user.email,
    role: access?.role ?? null,
    status: access?.status ?? null,
    apps: appsFor(access),
    admin: can(access, { type: "users:manage" }),
  });
});

// ---- GET /api/admin/people: everyone on any list, plus the recent change log ----
export const list = json(async (req) => {
  const admin = await adminUser(req);
  if (admin instanceof Response) return admin;
  const s = settings();
  const records = await listRecords();
  const byEmail = new Map<string, AccessRecord>(records.map((r) => [r.email, r]));
  const emails = [...new Set([...s.admins, ...byEmail.keys(), ...s.allowed])];
  const adapter = await authContext();
  const people: Person[] = [];
  for (const email of emails) {
    const record = byEmail.get(email) ?? null;
    const access = resolveAccess(email, s, record)!;
    const inAdmins = s.admins.has(email);
    people.push({
      email,
      role: access.role,
      apps: appsFor({ ...access, status: "active" }),
      granted: access.apps,
      status: access.status,
      source: access.source,
      locked: inAdmins ? "Named in ADMIN_EMAILS, so it can only change in the server settings." : null,
      note: record?.note ?? (s.allowed.has(email) && !record ? "From ALLOWED_EMAILS" : ""),
      joined: !!(await adapter.findUserByEmail(email)),
      addedBy: record?.createdBy ?? null,
      updatedAt: record?.updatedAt ?? null,
    });
  }
  const order = (p: Person) => (p.role === "admin" ? 0 : 1);
  people.sort((a, b) => order(a) - order(b) || a.email.localeCompare(b.email));
  return NextResponse.json({
    me: normalEmail(admin.email),
    people,
    log: await recentLog(),
    apps: APP_IDS.map((id) => ({ id, label: appLabel(id) })),
    roles: Object.entries(ROLES).map(([id, r]) => ({ id, label: r.label, about: r.about })),
  });
});

const personIn = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("That email doesn't look right.")),
  role: z.enum(["admin", "member"]),
  apps: z.array(z.enum(APP_IDS as [AppId, ...AppId[]])).max(APP_IDS.length),
  status: z.enum(["active", "suspended"]),
  note: z.string().trim().max(200).default(""),
});

// Guard rails shared by edits and removals: nobody locks themselves out, settings admins stay put,
// and there is always at least one active admin.
async function checkChange(actorEmail: string, email: string, next: { role: Role; status: string } | null): Promise<string | null> {
  const s = settings();
  if (s.admins.has(email)) return `${email} is named in ADMIN_EMAILS, so it can only change in the server settings.`;
  const self = email === normalEmail(actorEmail);
  if (self && (!next || next.role !== "admin" || next.status !== "active")) return "You can't remove, demote or suspend yourself. Ask another admin.";
  const before = await accessFor(email);
  const wasAdmin = before?.role === "admin" && before.status === "active";
  const staysAdmin = next?.role === "admin" && next.status === "active";
  if (wasAdmin && !staysAdmin && s.admins.size === 0) {
    const admins = (await listRecords()).filter((r) => r.role === "admin" && r.status === "active");
    if (admins.length <= 1) return "That would leave the yard with no admin. Make someone else an admin first.";
  }
  return null;
}

// Say what changed, for the log: "role member → admin; apps + TallyBack; suspended".
function describe(before: Access | null, after: z.infer<typeof personIn>) {
  const as = `${ROLES[after.role].label}${after.role === "member" ? ` (${after.apps.map(appLabel).join(", ") || "no apps"})` : ""}`;
  if (!before) return `added as ${as}`;
  if (before.source === "settings") return `taken over from ALLOWED_EMAILS as ${as}${after.status === "suspended" ? ", suspended" : ""}`;
  const parts: string[] = [];
  if (before.role !== after.role) parts.push(`role ${ROLES[before.role].label} → ${ROLES[after.role].label}`);
  const added = after.apps.filter((a) => !before.apps.includes(a)).map(appLabel);
  const removed = before.apps.filter((a) => !after.apps.includes(a)).map(appLabel);
  if (added.length) parts.push(`apps + ${added.join(", ")}`);
  if (removed.length) parts.push(`apps − ${removed.join(", ")}`);
  if (before.status !== after.status) parts.push(after.status === "suspended" ? "suspended" : "reactivated");
  return parts.join("; ") || "note updated";
}

// ---- POST /api/admin/people: add someone, or change their role, apps, status or note ----
export const save = json(async (req) => {
  const admin = await adminUser(req);
  if (admin instanceof Response) return admin;
  const parsed = personIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return refuse(400, parsed.error.issues[0]?.message ?? "Something in the form isn't right.");
  const input = parsed.data;
  const problem = await checkChange(admin.email, input.email, input);
  if (problem) return refuse(409, problem);
  const before = await accessFor(input.email);
  await saveRecord(normalEmail(admin.email), input, describe(before, input));
  if (input.status === "suspended") await endSessions(input.email);
  return NextResponse.json({ ok: true });
});

// ---- DELETE /api/admin/people?email=…: take someone off the dashboard list ----
export const remove = json(async (req) => {
  const admin = await adminUser(req);
  if (admin instanceof Response) return admin;
  const email = normalEmail(new URL(req.url).searchParams.get("email"));
  if (!email) return refuse(400, "Which email?");
  const problem = await checkChange(admin.email, email, null);
  if (problem) return refuse(409, problem);
  await deleteRecord(normalEmail(admin.email), email);
  // Still on ALLOWED_EMAILS? Then they fall back to that list's default access; otherwise they're out.
  if (!(await accessFor(email))) await endSessions(email);
  return NextResponse.json({ ok: true, fallback: !!(await accessFor(email)) });
});
