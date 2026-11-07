import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { runChecks } from "@tallyback/lib/checks";
import { findBill, saveCheck } from "@tallyback/lib/store";
import { appUser, ownerOf } from "@signin/session";
import type { Extraction, Promise } from "@tallyback/lib/types";


// The server re-runs the checks itself: the browser's numbers are never trusted.
// Checking is code, not AI; it's saved only to a bill the asker owns.
export const POST = jsonRoute(async (req: Request) => {
  const user = await appUser(req, "tallyback");
  if (user instanceof Response) return user;
  const { billId, deviceId, lineIds, extraction, promise } = (await req.json()) as {
    billId: string;
    deviceId: string;
    lineIds: string[];
    extraction: Extraction;
    promise: Promise;
  };
  const result = runChecks(extraction, promise);
  const owner = ownerOf(user, deviceId);
  const save = async () => (owner && (await findBill(billId, owner)) ? saveCheck(billId, owner, lineIds, promise, result) : {});
  const findingIds = await bestEffort("save check", save, {} as Record<string, string>);
  return NextResponse.json({ result, findingIds });
});
