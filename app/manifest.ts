import type { MetadataRoute } from "next";

// The web app manifest: what a phone needs to install Tinkeryard like an app. Served at
// /manifest.webmanifest and linked from every page. "standalone" opens it full-screen from the
// home screen, with no browser bars; shortcuts appear on a long-press of the icon (Android).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/home",
    name: "Tinkeryard",
    short_name: "Tinkeryard",
    description: "TallyBack, Review Scout and SplitBill in one app.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f4ef",
    theme_color: "#f6f4ef",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "SplitBill", short_name: "SplitBill", url: "/splitbill", description: "Split costs with friends" },
      { name: "TallyBack", short_name: "TallyBack", url: "/tallyback", description: "Check a bill" },
      { name: "Review Scout", short_name: "Reviews", url: "/reviewscout", description: "What reviewers said" },
    ],
  };
}
