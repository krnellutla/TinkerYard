"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authClient } from "../client";
import { useAccess } from "./access";
import { PasskeyList } from "./Passkeys";
import { SignIn } from "./SignIn";
import { onAskToSignIn, sessionChanged } from "./prompt";
import { useStableSession } from "./useStableSession";
import { focusSignInWall } from "./wall";

// Right side of the app switcher: "Sign in", or who you are, your passkeys and "Sign out".
export function Account() {
  // Steady through the re-checks that run when the tab comes back into view (see useStableSession):
  // reacting to those used to unmount the sign-in box, losing the code step.
  const { data, loading, configError } = useStableSession();
  const { access } = useAccess();
  const [signingIn, setSigningIn] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reason, setReason] = useState<string | undefined>();

  // Signing in happens in one place: the sign-in wall that every app page shows while signed out
  // (it also keeps your step across a reload). A box of its own opens only where there's no wall.
  const signIn = (why?: string) => {
    if (focusSignInWall()) return;
    setReason(why);
    setSigningIn(true);
  };

  // An app asked for sign-in before a costly action ("Sign in to check a real bill").
  useEffect(() => onAskToSignIn((why) => signIn(why)), []);

  // The open menu closes on a click outside it or on Escape.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  if (loading) return <span className="ml-auto h-7 w-16" aria-hidden="true" />;
  // Sign-in isn't set up on this server yet (no secret or database): show no button that can't work.
  if (configError) return null;

  if (!data)
    return (
      <>
        <button onClick={() => signIn()} className="ml-auto rounded-full border border-line bg-card px-3 py-1 font-medium">
          Sign in
        </button>
        {signingIn && (
          <SignIn
            reason={reason}
            onClose={() => {
              setSigningIn(false);
              setReason(undefined);
            }}
          />
        )}
      </>
    );

  const email = data.user.email;
  return (
    <div ref={menuRef} className="relative ml-auto">
      <button
        onClick={() => setMenu((m) => !m)}
        aria-expanded={menu}
        aria-label={`Account: ${email}`}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-medium uppercase text-white"
      >
        {email[0]}
      </button>
      {menu && (
        <div className="absolute right-0 top-10 z-40 w-72 rounded-2xl border border-line bg-card p-3 text-sm shadow-lg">
          <p className="text-muted">Signed in as</p>
          <p className="truncate font-medium">{email}</p>
          {access?.role && <p className="text-xs text-muted">{access.role === "admin" ? "Admin" : "Member"}</p>}
          {access?.admin && (
            <Link href="/admin" onClick={() => setMenu(false)} className="mt-3 block rounded-xl bg-ink py-2 text-center font-medium text-white">
              Admin dashboard
            </Link>
          )}
          <PasskeyList />
          <button
            onClick={async () => {
              setMenu(false);
              await authClient.signOut();
              sessionChanged();
            }}
            className="mt-3 w-full rounded-xl border border-line py-2 font-medium"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
