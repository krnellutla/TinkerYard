"use client";

import { authClient } from "../client";

// The session, without the flicker. Better Auth checks the session again whenever the tab comes back
// into view (and when the phone comes back online). While signed out, each of those checks reports
// "pending" again, and a failed one (the network still waking up) reports an error. Screens that
// reacted to that unmounted the sign-in step you were on, so coming back from the mail app looked
// like a reload. Here, "loading" and "not set up" count only until the first check has finished.
// The flag is shared by every screen (module-level), so the top bar and the sign-in wall agree.

let settled = false;
const settle = () => {
  settled = true;
  return true;
};

export function stableSessionState(s: { isPending: boolean; error: unknown }, alreadySettled: boolean) {
  const first = !alreadySettled;
  return { loading: s.isPending && first, configError: !!s.error && first };
}

export function useStableSession() {
  const s = authClient.useSession();
  const state = stableSessionState(s, settled);
  if (!s.isPending && !s.error) settle();
  return { data: s.data, ...state };
}
