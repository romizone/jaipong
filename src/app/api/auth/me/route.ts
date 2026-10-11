import { readSession } from "@/lib/auth";
import { LIMITS, hasAuth } from "@/lib/config";
import { songsUsedToday } from "@/lib/ratelimit";
import type { Account } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Siapa yang sedang masuk dan berapa jatah lagunya yang sudah terpakai hari ini. */
export async function GET(req: Request) {
  const user = readSession(req);
  const account: Account = {
    configured: hasAuth,
    user: user ? { name: user.name, email: user.email } : null,
    used: user ? Math.min(LIMITS.userDaily, await songsUsedToday(user.sub)) : 0,
    limit: LIMITS.userDaily,
  };
  return Response.json(account);
}
