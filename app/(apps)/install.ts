"use client";

import { useEffect, useState } from "react";

// "Install the app": Chrome and Edge (Android, desktop) fire beforeinstallprompt when the yard can be
// installed; we keep that event so a button can show the browser's install dialog later. iPhone Safari
// has no such event: there, people use Share → Add to Home Screen, so we show those steps instead.
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Registered as soon as this file loads (from the tab bar, on every app page), because the event
// fires once, early, and is gone if nobody is listening.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);

const isIosSafari = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
};

export function useInstall() {
  const [, bump] = useState(0);
  const [env, setEnv] = useState({ standalone: false, ios: false });
  useEffect(() => {
    setEnv({ standalone: isStandalone(), ios: isIosSafari() });
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    installed: env.standalone,
    canPrompt: !!deferred && !env.standalone,
    iosSteps: env.ios && !env.standalone,
    async prompt() {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      notify();
    },
  };
}
