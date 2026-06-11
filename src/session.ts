import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import type { AppEnv, Session } from "./types";

export const sessionCookieName = "zunoser_invite_session";

const sessionMaxAgeSeconds = 15 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function readSession(c: Context<AppEnv>): Promise<Session | null> {
  const cookie = getCookie(c, sessionCookieName);
  if (!cookie || !c.env.SESSION_SECRET) {
    return null;
  }

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = await hmac(payload, c.env.SESSION_SECRET);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  try {
    const session = JSON.parse(decoder.decode(base64UrlDecode(payload))) as Session;
    if (Date.now() - session.createdAt > sessionMaxAgeSeconds * 1000) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export async function writeSession(c: Context<AppEnv>, session: Session): Promise<void> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(session)));
  const signature = await hmac(payload, c.env.SESSION_SECRET);

  setCookie(c, sessionCookieName, `${payload}.${signature}`, {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: sessionMaxAgeSeconds,
  });
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}
