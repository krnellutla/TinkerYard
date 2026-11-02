// Who may sign in: the emails listed in ALLOWED_EMAILS (comma, space or newline separated).
// Pure functions, so they're easy to test.

export const NOT_INVITED = "This yard is invite-only, and that email isn't on the list.";

export function parseAllowList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}

export function isAllowed(email: unknown, list: Set<string>): boolean {
  return typeof email === "string" && list.has(email.trim().toLowerCase());
}
