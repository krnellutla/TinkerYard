import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin · Tinkeryard",
  description: "Who can sign in, their roles, and which apps they can use.",
  robots: { index: false },
};

export { default } from "@signin/ui/Admin";
