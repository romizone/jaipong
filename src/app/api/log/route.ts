import { readSession } from "@/lib/auth";
import { ADMIN_EMAILS, hasSharedStore } from "@/lib/config";
import { readUsage } from "@/lib/usagelog";
import { listUsers } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daftar pengguna dan catatan pemakaian, hanya untuk email yang terdaftar di ADMIN_EMAILS. */
export async function GET(req: Request) {
  const user = readSession(req);
  if (!user) return Response.json({ error: "Masuk dulu." }, { status: 401 });
  if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return Response.json({ error: "Bukan pengelola." }, { status: 403 });
  }

  const limit = Math.min(
    1_000,
    Math.max(1, Number(new URL(req.url).searchParams.get("n")) || 200),
  );
  return Response.json({
    // false berarti data ini hanya dari memori instance yang menjawab.
    persistent: hasSharedStore,
    users: await listUsers(),
    entries: await readUsage(limit),
  });
}
