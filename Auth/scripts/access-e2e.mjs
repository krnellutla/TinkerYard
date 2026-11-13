// End-to-end test of roles and app access against a running dev server (see docs/05-DEVELOPER-SETUP-AND-RUNBOOK.md).
// Start the server with ADMIN_EMAILS=admin@test.local and ALLOWED_EMAILS=old@test.local, no database,
// no RESEND_API_KEY (codes are printed to its log), then:
//   node Auth/scripts/access-e2e.mjs http://localhost:3103 dev.log
import fs from "node:fs";

const [BASE, LOG] = process.argv.slice(2);
const ORIGIN = new URL(BASE).origin;
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};

function device() {
  const jar = new Map();
  return async function call(path, { method = "GET", body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { Origin: ORIGIN, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json };
  };
}

async function signIn(email) {
  const d = device();
  const sent = await d("/api/auth/email-otp/send-verification-otp", { method: "POST", body: { email, type: "sign-in" } });
  if (sent.status !== 200) return { d, status: sent.status };
  await new Promise((r) => setTimeout(r, 600));
  const otp = [...fs.readFileSync(LOG, "utf8").matchAll(new RegExp(`${email.replace(".", "\\.")}[\\s\\S]{0,300}?\\b(\\d{6})\\b`, "g"))].pop()?.[1];
  const r = await d("/api/auth/sign-in/email-otp", { method: "POST", body: { email, otp } });
  return { d, status: r.status };
}

const apps = async (d) => ({
  tallyback: (await d("/api/tallyback/bills?deviceId=x")).status,
  reviewscout: (await d("/api/reviewscout/searches?deviceId=x")).status,
  split: (await d("/api/tallyback/groups")).status, // TallyBack's Split tab
  admin: (await d("/api/admin/people")).status,
});
const person = (email, role, apps, status = "active") => ({ email, role, apps, status, note: "" });

// 1. The owner, named in ADMIN_EMAILS
const admin = await signIn("admin@test.local");
check(admin.status === 200, "admin signs in");
const me = (await admin.d("/api/access")).json;
check(me?.admin === true && me.apps.length === 2, `admin sees every app and the dashboard (${me?.apps})`);
check(JSON.stringify(await apps(admin.d)) === JSON.stringify({ tallyback: 200, reviewscout: 200, split: 200, admin: 200 }), "admin can open everything");

// 2. Strangers are refused before any code is sent
check((await signIn("bob@test.local")).status === 403, "bob (not on any list) can't even get a code");

// 3. Admin adds bob as a member with Review Scout only
check((await admin.d("/api/admin/people", { method: "POST", body: person("bob@test.local", "member", ["reviewscout"]) })).status === 200, "admin adds bob: member, Review Scout only");
const bob = await signIn("bob@test.local");
check(bob.status === 200, "bob can sign in now");
let b = await apps(bob.d);
check(b.reviewscout === 200 && b.tallyback === 403 && b.split === 403 && b.admin === 403, `bob: Review Scout yes; TallyBack (bills and split) 403; admin 403 (${JSON.stringify(b)})`);
check(JSON.stringify((await bob.d("/api/access")).json?.apps) === '["reviewscout"]', "bob's nav lists only Review Scout");

// 4. Granting an app takes effect at once
await admin.d("/api/admin/people", { method: "POST", body: person("bob@test.local", "member", ["reviewscout", "tallyback"]) });
const granted = await apps(bob.d);
check(granted.tallyback === 200 && granted.split === 200, "admin grants TallyBack → bob can check and split bills at once");

// 5. Members can't change access, even through the API
check((await bob.d("/api/admin/people", { method: "POST", body: person("bob@test.local", "admin", []) })).status === 403, "bob can't make himself admin");

// 6. Guard rails for admins
check((await admin.d("/api/admin/people", { method: "POST", body: person("admin@test.local", "member", []) })).status === 409, "settings admin can't be demoted from the dashboard");
await admin.d("/api/admin/people", { method: "POST", body: person("second@test.local", "admin", []) });
const second = await signIn("second@test.local");
check((await second.d("/api/admin/people", { method: "POST", body: person("second@test.local", "member", []) })).status === 409, "a dashboard admin can't demote themselves");
check((await second.d("/api/admin/people?email=second%40test.local", { method: "DELETE" })).status === 409, "…or remove themselves");

// 7. Suspending locks out at once, and blocks new sign-ins
await admin.d("/api/admin/people", { method: "POST", body: person("bob@test.local", "member", ["reviewscout", "tallyback"], "suspended") });
b = await apps(bob.d);
check(b.reviewscout !== 200 && b.tallyback !== 200 && b.split !== 200, `suspended bob is locked out at once (${JSON.stringify(b)})`);
check((await signIn("bob@test.local")).status === 403, "suspended bob can't sign in again");

// 8. ALLOWED_EMAILS people get every app until an admin restricts them
const old = await signIn("old@test.local");
check((await apps(old.d)).split === 200, "old@ (from ALLOWED_EMAILS) gets every app by default");
await admin.d("/api/admin/people", { method: "POST", body: person("old@test.local", "member", ["reviewscout"]) });
const o = await apps(old.d);
check(o.tallyback === 403 && o.split === 403 && o.reviewscout === 200, `admin restricts old@ to Review Scout (${JSON.stringify(o)})`);

// 9. Removing someone from the dashboard
check((await admin.d("/api/admin/people?email=bob%40test.local", { method: "DELETE" })).status === 200, "admin removes bob");
check((await signIn("bob@test.local")).status === 403, "removed bob can't sign in");

// 10. Everything was logged
const log = (await admin.d("/api/admin/people")).json?.log ?? [];
check(log.length >= 6 && log.some((l) => /suspended/.test(l.change)) && log.some((l) => /removed/.test(l.change)), `change log has ${log.length} entries`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
