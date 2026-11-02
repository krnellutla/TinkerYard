import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Review Scout",
  description: "Type a product, get a cited summary of what YouTube reviewers said, then ask follow-ups.",
};

export default function ReviewScoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
