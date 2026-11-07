import { NextResponse } from "next/server";
import { bestEffort, jsonRoute } from "@tallyback/lib/route";
import { claimDevice, listBills } from "@tallyback/lib/store";
import { appUser, ownerOf } from "@signin/session";
import { summarise } from "@tallyback/lib/billView";


export const GET = jsonRoute(async (req: Request) => {
  const user = await appUser(req, "tallyback");
  if (user instanceof Response) return user;
  const owner = ownerOf(user, new URL(req.url).searchParams.get("deviceId"));
  if (!owner) return NextResponse.json({ bills: [] });
  await bestEffort("claim device", () => claimDevice(owner), undefined);
  const bills = (await listBills(owner)).map(summarise);
  return NextResponse.json({ bills });
});
