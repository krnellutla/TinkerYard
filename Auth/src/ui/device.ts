// Does *this* device have a passkey for the yard? The server only knows the account's passkeys, not
// which device each one lives on, so the browser keeps a small marker in localStorage:
//   set   when a passkey is created here, used to sign in here, or the browser says one already exists here
//   clear when signing in with a passkey fails here, or the account has no passkeys left
// Passkeys that sync (iCloud Keychain, Google Password Manager) may still work on a device without the
// marker; the sign-in screen keeps "Use a passkey instead" for that.

const KEY = "ty-passkey-device";

export function deviceHasPasskey(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markDevicePasskey(has: boolean) {
  try {
    if (has) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {}
}

// After signing in: offer a passkey unless this device already has one. "first" when the account has
// none at all, "this-device" when it has passkeys on other devices only. Pure, so it's easy to test.
export function passkeyOffer(s: { supported: boolean; deviceHas: boolean; dismissed: boolean; accountPasskeys: number | null }): "none" | "first" | "this-device" {
  if (!s.supported || s.dismissed || s.deviceHas || s.accountPasskeys == null) return "none";
  return s.accountPasskeys === 0 ? "first" : "this-device";
}
