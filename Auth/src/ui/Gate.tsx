"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "../client";
import { APPS, appLabel, appOfPath } from "../policy";
import { useAccess } from "./access";
import { PasskeyPrompt } from "./Passkeys";
import { SignInPanel } from "./SignIn";

// Every page under app/(apps) sits behind this wall: sign in first, then you see an app only if the
// policy lets you (policy.ts), and /admin only if you're an admin. The API routes check the same
// rules on every request, so this is the friendly half of the lock.
export function RequireSignIn({ children }: { children: React.ReactNode }) {
  // (A used or expired sign-in link lands with ?error=…; the account menu explains that one.)
  const { data, isPending, error } = authClient.useSession();
  const { access, loading } = useAccess();
  const path = usePathname();

  if (isPending || (data && loading)) return <p className="mx-auto max-w-xl px-4 pt-8 text-muted">Loading…</p>;

  if (error)
    return (
      <Wall title="Sign in to the yard">
        <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">Sign-in isn&apos;t set up on this server yet, so the apps are closed. Check the Auth settings in the README.</p>
      </Wall>
    );

  if (!data)
    return (
      <Wall title="Sign in to the yard" intro="TallyBack and Review Scout use one account. No passwords: a passkey on your device, or a code by email.">
        <SignInPanel />
        <p className="mt-4 text-center text-xs text-muted">Invite-only for now: your email must be on the list.</p>
      </Wall>
    );

  // Signed in, but suspended or removed since.
  if (!access || access.status !== "active")
    return (
      <Wall title={access?.status === "suspended" ? "Your access is paused" : "You're not on the list any more"}>
        <p className="text-sm text-muted">An admin has {access?.status === "suspended" ? "suspended" : "removed"} access for {data.user.email}. Ask them if you think that&apos;s a mistake.</p>
        <button onClick={() => authClient.signOut()} className="mt-4 h-11 w-full rounded-xl border border-line bg-paper font-medium">
          Sign out
        </button>
      </Wall>
    );

  const app = appOfPath(path);
  const allowed = path.startsWith("/admin") ? access.admin : !app || access.apps.includes(app);
  if (!allowed) {
    const mine = APPS.filter((a) => access.apps.includes(a.id));
    return (
      <Wall title={app ? `You don't have access to ${appLabel(app)}` : "Admins only"}>
        <p className="text-sm text-muted">{app ? "Ask an admin to add it to your account." : "The admin dashboard is for admins. Ask one if you need a change."}</p>
        {mine.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">Your apps</p>
            {mine.map((a) => (
              <Link key={a.id} href={a.href} className="block rounded-xl border border-line bg-paper px-3 py-2.5 font-medium">
                {a.label} →
              </Link>
            ))}
          </div>
        )}
      </Wall>
    );
  }

  return (
    <>
      {children}
      <PasskeyPrompt />
    </>
  );
}

function Wall({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-sm px-4 pb-16 pt-10">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{title}</h1>
      {intro && <p className="mt-2 text-muted">{intro}</p>}
      <div className="mt-6 rounded-2xl border border-line bg-card p-5">{children}</div>
    </main>
  );
}
