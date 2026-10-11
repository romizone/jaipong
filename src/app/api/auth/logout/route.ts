import { SESSION_COOKIE, cookie } from "@/lib/auth";

export const runtime = "nodejs";

/** Keluar: cukup hapus cookie sesinya — server tidak menyimpan sesi apa pun. */
export async function POST() {
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } },
  );
}
