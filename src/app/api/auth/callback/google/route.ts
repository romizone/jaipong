import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  STATE_COOKIE,
  callbackUrl,
  cookie,
  createSessionToken,
  publicOrigin,
  readCookie,
} from "@/lib/auth";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, hasAuth } from "@/lib/config";
import { recordLogin } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Akhir masuk dengan Google: tukar kode dengan id_token, periksa isinya,
 * lalu pasang cookie sesi.
 */

type IdClaims = {
  iss?: string;
  aud?: string;
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
};

function back(req: Request, query: string, cookies: string[]): Response {
  const headers = new Headers({ Location: `${publicOrigin(req)}/${query}` });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}

export async function GET(req: Request) {
  const clearState = cookie(STATE_COOKIE, "", 0);
  const failed = () => back(req, "?masuk=gagal", [clearState]);
  if (!hasAuth) return back(req, "?masuk=belum", [clearState]);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(req, STATE_COOKIE);
  // Pengguna menekan "Batal" di Google, atau state-nya tidak cocok.
  if (!code || !state || !expected || state !== expected) return failed();

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl(req),
        grant_type: "authorization_code",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[auth] penukaran kode gagal", res.status);
      return failed();
    }

    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    // id_token diterima langsung dari Google lewat TLS, jadi tanda tangannya
    // tidak perlu diperiksa ulang; isinya tetap dicocokkan satu per satu.
    const claims = JSON.parse(
      Buffer.from(String(idToken ?? "").split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as IdClaims;

    const issuerOk =
      claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
    const verified = claims.email_verified === true || claims.email_verified === "true";
    if (
      !issuerOk ||
      claims.aud !== GOOGLE_CLIENT_ID ||
      typeof claims.exp !== "number" ||
      claims.exp * 1000 <= Date.now() ||
      !claims.sub ||
      !claims.email ||
      !verified
    ) {
      console.error("[auth] id_token ditolak");
      return failed();
    }

    const user = {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      name: (claims.name ?? claims.email).slice(0, 80),
    };
    await recordLogin(user);
    const token = createSessionToken(user);
    return back(req, "", [clearState, cookie(SESSION_COOKIE, token, SESSION_TTL_SEC)]);
  } catch (error) {
    console.error("[auth]", error);
    return failed();
  }
}
