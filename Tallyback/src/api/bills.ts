import { NextResponse } from "next/server";
import { jsonRoute } from "@tallyback/lib/route";
import { listBills } from "@tallyback/lib/store";
import { summarise } from "@tallyback/lib/billView";


export const GET = jsonRoute(async (req: Request) => {
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  if (!deviceId || deviceId === "anon") return NextResponse.json({ bills: [] });
  const bills = (await listBills(deviceId)).map(summarise);
  return NextResponse.json({ bills });
});
