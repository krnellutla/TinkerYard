import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Review Scout",
  description: "Type a product, get a cited summary of what YouTube reviewers said, then ask follow-ups.",
  applicationName: "Review Scout",
};

export { default } from "@reviewscout/ui/Home";
