import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TallyBack lab · Read a bill offline",
  description: "Test on-device receipt reading: OCR plus an optional small AI model, all in the browser.",
  robots: { index: false, follow: false },
};

export { default } from "@tallyback/ui/OfflineLab";
