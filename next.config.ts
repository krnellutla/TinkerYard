import type { NextConfig } from "next";

// One app for tinkeryard.dev: the landing page at /, TallyBack at /tallyback, Review Scout at /reviewscout.
const nextConfig: NextConfig = {
  // This repo is the root, even if a stray package-lock.json sits in a parent folder.
  outputFileTracingRoot: __dirname,
  // The landing page is plain HTML in public/; serve it at the root.
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
  // The apps used to live on their own subdomains; send old links to their new paths
  // once those domains point at this project.
  async redirects() {
    return [
      // SplitBill is now TallyBack's Split tab; ?g=… (an open group) carries over.
      { source: "/splitbill", destination: "/tallyback?tab=split", permanent: false },
      { source: "/:path*", has: [{ type: "host", value: "tallyback.tinkeryard.dev" }], destination: "https://tinkeryard.dev/tallyback", permanent: false },
      { source: "/:path*", has: [{ type: "host", value: "reviewscout.tinkeryard.dev" }], destination: "https://tinkeryard.dev/reviewscout", permanent: false },
    ];
  },
};

export default nextConfig;
