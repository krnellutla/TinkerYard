// While signed out, every app page shows the sign-in wall, so it's the one place to sign in.
// The top bar's "Sign in" button takes you to it rather than opening a second sign-in box.

export const WALL_ID = "signin-wall";

export function focusSignInWall(): boolean {
  const wall = typeof document === "undefined" ? null : document.getElementById(WALL_ID);
  if (!wall) return false;
  wall.scrollIntoView({ behavior: "smooth", block: "center" });
  wall.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  return true;
}

// A used or expired sign-in link lands with ?error=…: read it once and tidy the address bar.
export function takeLinkError(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  const code = url.searchParams.get("error");
  if (!code) return undefined;
  url.searchParams.delete("error");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return code;
}
