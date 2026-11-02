// Whose data a request may read: a signed-in user, or a guest identified by their device.
// A guest only ever sees device rows that no account has claimed yet. Pure, so it's easy to test.
export interface Owner {
  userId: string | null;
  deviceId: string;
}

export function ownerOf(user: { id: string } | null, deviceId: unknown): Owner | null {
  const device = typeof deviceId === "string" && deviceId && deviceId !== "anon" ? deviceId.slice(0, 64) : "";
  if (user) return { userId: user.id, deviceId: device };
  return device ? { userId: null, deviceId: device } : null;
}
