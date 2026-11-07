import { ImageResponse } from "next/og";
import { Flag } from "./flag";

// The yard's icon, drawn in code and served as PNGs: /icon/192 and /icon/512 for the installed app,
// and /icon/maskable for Android, which crops icons to its own shape (circle, squircle…) and needs
// the flag kept inside the middle 80%.
const SIZES = { "192": 192, "512": 512, maskable: 512 } as const;
type Id = keyof typeof SIZES;

export function generateImageMetadata() {
  return (Object.keys(SIZES) as Id[]).map((id) => ({ id, size: { width: SIZES[id], height: SIZES[id] }, contentType: "image/png" }));
}

export default function Icon({ id }: { id: Id }) {
  const size = SIZES[id] ?? 512;
  return new ImageResponse(<Flag size={size} padded={id === "maskable"} />, { width: size, height: size });
}
