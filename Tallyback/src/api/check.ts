import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { runChecks } from "@tallyback/lib/checks";
import { saveCheck } from "@tallyback/lib/store";
import type { Extraction, Promise } from "@tallyback/lib/types";


// The server re-runs the checks itself: the browser's numbers are never trusted.
export const POST = jsonRoute(async (req: Request) => {
  const { billId, deviceId, lineIds, extraction, promise } = (await req.json()) as {
    billId: string;
    deviceId: string;
    lineIds: string[];
    extraction: Extraction;
    promise: Promise;
  };
  const result = runChecks(extraction, promise);
  const findingIds = await bestEffort("save check", () => saveCheck(billId, deviceId, lineIds, promise, result), {} as Record<string, string>);
  return NextResponse.json({ result, findingIds });
});
