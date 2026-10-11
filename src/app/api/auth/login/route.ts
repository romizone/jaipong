import { STATE_COOKIE, callbackUrl, cookie, newState, publicOrigin } from "@/lib/auth";
import { GOOGLE_CLIENT_ID, hasAuth } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Awal masuk dengan Google: arahkan pengguna ke halaman persetujuan Google. */
export async function GET(req: Request) {
  if (!hasAuth) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${publicOrigin(req)}/?masuk=belum` },
    });
  }

  // State acak disimpan di cookie dan dicocokkan saat Google mengarahkan
  // balik — tanpanya situs lain bisa memasukkan pengguna ke akun orang lain.
  const state = newState();
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": cookie(STATE_COOKIE, state, 600),
    },
  });
}
