import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AUTH_SECRET, hasAuth } from "@/lib/config";

/**
 * Sesi masuk dengan Google, tanpa pustaka tambahan dan tanpa basis data.
 *
 * Setelah Google memastikan siapa penggunanya, identitasnya disimpan di
 * cookie yang ditandatangani HMAC dengan AUTH_SECRET. Server tidak menyimpan
 * sesi apa pun: cookie yang tanda tangannya cocok dan belum kedaluwarsa
 * itulah sesinya. Berkas ini hanya dipakai di sisi server.
 */

export type SessionUser = {
  /** Id akun Google — tetap sama walau emailnya berganti. Kunci kuota. */
  sub: string;
  email: string;
  name: string;
};

export const SESSION_COOKIE = "jaipong_sesi";
export const STATE_COOKIE = "jaipong_state";
export const SESSION_TTL_SEC = 30 * 86_400;

function mac(data: string): string {
  return createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
}

export function readCookie(req: Request, name: string): string {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

/**
 * HttpOnly supaya skrip halaman tidak bisa membacanya; SameSite=Lax supaya
 * situs lain tidak bisa menumpang sesi lewat POST lintas situs, tapi cookie
 * tetap ikut saat Google mengarahkan pengguna kembali ke sini.
 */
export function cookie(name: string, value: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

export function createSessionToken(user: SessionUser): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const body = Buffer.from(JSON.stringify({ ...user, exp })).toString("base64url");
  return `${body}.${mac(body)}`;
}

/** Pengguna yang sedang masuk, atau null. */
export function readSession(req: Request): SessionUser | null {
  if (!hasAuth) return null;
  const token = readCookie(req, SESSION_COOKIE);
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      sub?: unknown;
      email?: unknown;
      name?: unknown;
      exp?: unknown;
    };
    if (typeof data.sub !== "string" || !data.sub) return null;
    if (typeof data.email !== "string" || !data.email) return null;
    if (typeof data.exp !== "number" || data.exp * 1000 <= Date.now()) return null;
    return {
      sub: data.sub,
      email: data.email,
      name: typeof data.name === "string" && data.name ? data.name : data.email,
    };
  } catch {
    return null;
  }
}

/**
 * Alamat publik situs seperti yang dilihat browser. Di belakang proxy,
 * req.url bisa berisi alamat internal; header x-forwarded-* yang benar.
 * Dipakai untuk redirect_uri — nilai karangan klien tidak berguna baginya,
 * karena Google hanya menerima alamat yang sudah didaftarkan.
 */
export function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function callbackUrl(req: Request): string {
  return `${publicOrigin(req)}/api/auth/callback/google`;
}
