import type { MetadataRoute } from "next";

// The web app manifest: what a phone needs to install Tinkeryard like an app. Served at
// /manifest.webmanifest and linked from every page. "standalone" opens it full-screen from the
// home screen, with no browser bars; shortcuts appear on a long-press of the icon (Android).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/home",
    name: "Tinkeryard",
    short_name: "Tinkeryard",
    description: "TallyBack (check and split bills) and Review Scout in one app.",
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
      { name: "Check a bill", short_name: "Check a bill", url: "/tallyback", description: "TallyBack: check every line of a bill" },
      { name: "Split with friends", short_name: "Split", url: "/tallyback?tab=split", description: "TallyBack: groups, balances, settle up" },
      { name: "Review Scout", short_name: "Reviews", url: "/reviewscout", description: "What reviewers said" },
    ],
  };
}
