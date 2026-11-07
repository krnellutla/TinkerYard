"use client";

import { useEffect, useState } from "react";
import { authClient } from "../client";
import type { AppId, Role, Status } from "../policy";
import { onSessionChanged } from "./prompt";

// What the signed-in person may open, from /api/access. The nav, the app gate and the admin page all
// read it, so it's fetched once per session and shared. The server checks again on every request.
export interface MyAccess {
  email: string;
  role: Role | null;
  status: Status | null;
  apps: AppId[];
  admin: boolean;
}

let cached: { key: string; promise: Promise<MyAccess | null> } | null = null;
const listeners = new Set<() => void>();

function load(key: string) {
  if (cached?.key !== key)
    cached = {
      key,
      promise: fetch("/api/access")
        .then((r) => (r.ok ? (r.json() as Promise<MyAccess>) : null))
        .catch(() => null),
    };
  return cached.promise;
}

// After an admin changes someone's access (possibly their own view of the nav), refetch everywhere.
export function refreshAccess() {
  cached = null;
  listeners.forEach((l) => l());
}

export function useAccess(): { access: MyAccess | null; loading: boolean } {
  const { data } = authClient.useSession();
  const key = data?.user.id ?? "";
  const [state, setState] = useState<{ key: string; access: MyAccess | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    const off = onSessionChanged(refreshAccess);
    return () => {
      listeners.delete(bump);
      off();
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    let live = true;
    load(key).then((access) => live && setState({ key, access }));
    return () => {
      live = false;
    };
  }, [key, tick]);

  if (!key) return { access: null, loading: false };
  return { access: state?.key === key ? state.access : null, loading: state?.key !== key };
}
