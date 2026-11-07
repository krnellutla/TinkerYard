import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SplitBill",
  description: "Split shared expenses with friends, see who owes whom, and settle up in the fewest payments.",
  applicationName: "SplitBill",
};

export { default } from "@splitbill/ui/Home";
