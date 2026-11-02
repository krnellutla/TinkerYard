import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { claimDevice, listBills } from "@tallyback/lib/store";
import { ownerOf, signedInUser } from "@signin/session";
import { summarise } from "@tallyback/lib/billView";


export const GET = jsonRoute(async (req: Request) => {
  const owner = ownerOf(await signedInUser(req), new URL(req.url).searchParams.get("deviceId"));
  if (!owner) return NextResponse.json({ bills: [] });
  await bestEffort("claim device", () => claimDevice(owner), undefined);
  const bills = (await listBills(owner)).map(summarise);
  return NextResponse.json({ bills });
});
