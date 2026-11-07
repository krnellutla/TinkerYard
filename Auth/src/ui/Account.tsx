"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authClient } from "../client";
import { useAccess } from "./access";
import { PasskeyList } from "./Passkeys";
import { SignIn } from "./SignIn";
import { onAskToSignIn, sessionChanged } from "./prompt";

// Right side of the app switcher: "Sign in", or who you are, your passkeys and "Sign out".
export function Account() {
  const { data, isPending, error } = authClient.useSession();
  const { access } = useAccess();
  const [signingIn, setSigningIn] = useState(false);
  const [menu, setMenu] = useState(false);
  const [linkError, setLinkError] = useState<string | undefined>();
  const [reason, setReason] = useState<string | undefined>();

  // An app asked for sign-in before a costly action ("Sign in to check a real bill").
  useEffect(
    () =>
      onAskToSignIn((why) => {
        setReason(why);
        setSigningIn(true);
      }),
    [],
  );

  // A used or expired sign-in link lands here with ?error=…: explain it and offer a new one.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("error");
    if (!code) return;
    url.searchParams.delete("error");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    setLinkError(code);
    setSigningIn(true);
  }, []);

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

  if (isPending) return <span className="ml-auto h-7 w-16" aria-hidden="true" />;
  // Sign-in isn't set up on this server yet (no secret or database): show no button that can't work.
  if (error) return null;

  if (!data)
    return (
      <>
        <button onClick={() => setSigningIn(true)} className="ml-auto rounded-full border border-line bg-card px-3 py-1 font-medium">
          Sign in
        </button>
        {signingIn && (
          <SignIn
            errorCode={linkError}
            reason={reason}
            onClose={() => {
              setSigningIn(false);
              setLinkError(undefined);
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
