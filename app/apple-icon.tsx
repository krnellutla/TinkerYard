import { ImageResponse } from "next/og";
import { Flag } from "./flag";

// The home-screen icon on iPhone and iPad ("Add to Home Screen"). iOS rounds the corners itself.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<Flag size={180} />, size);
}
