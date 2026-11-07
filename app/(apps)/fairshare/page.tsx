import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fairshare",
  description: "Split shared expenses with friends, see who owes whom, and settle up in the fewest payments.",
  applicationName: "Fairshare",
};

export { default } from "@fairshare/ui/Home";
