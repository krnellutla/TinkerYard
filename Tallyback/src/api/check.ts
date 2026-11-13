import { NextResponse } from "next/server";
import { z } from "zod";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { runChecks } from "@tallyback/lib/checks";
import { findBill, saveCheck } from "@tallyback/lib/store";
import { appUser, ownerOf } from "@signin/session";
import type { Extraction, Promise } from "@tallyback/lib/types";

const checkIn = z.object({
  billId: z.string().max(64).default(""),
  deviceId: z.string().max(64).optional().default(""),
  lineIds: z.array(z.string().max(64)).max(500).default([]),
  extraction: z.object({ lines: z.array(z.unknown()) }).passthrough(),
  promise: z
    .object({
      expectedTotal: z.number().nullable(),
      pricesIncludeTax: z.boolean().nullable(),
      paidOn: z.string().nullable(),
      lineExpected: z.record(z.string(), z.number()),
      unrecognised: z.array(z.number().int().nonnegative()),
    })
    .passthrough(),
});

// The server re-runs the checks itself: the browser's numbers are never trusted.
// Checking is code, not AI; it's saved only to a bill the asker owns.
export const POST = jsonRoute(async (req: Request) => {
  const user = await appUser(req, "tallyback");
  if (user instanceof Response) return user;
  const parsed = checkIn.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { billId, deviceId, lineIds } = parsed.data;
  const extraction = parsed.data.extraction as unknown as Extraction;
  const promise = parsed.data.promise as unknown as Promise;
  const result = runChecks(extraction, promise);
  const owner = ownerOf(user, deviceId);
  const save = async () => (owner && (await findBill(billId, owner)) ? saveCheck(billId, owner, lineIds, promise, result) : {});
  const findingIds = await bestEffort("save check", save, {} as Record<string, string>);
  return NextResponse.json({ result, findingIds });
});
