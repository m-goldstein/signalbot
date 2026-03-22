const SESSION_COOKIE = "signalbot_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;

export const AUTH_COOKIE_NAME = SESSION_COOKIE;

type SessionPayload = {
  u: string;
  exp: number;
};

type AuthConfig = {
  username: string;
  password: string;
  sessionSecret: string;
};

function readAuthConfig(): AuthConfig | null {
  const username = process.env.AUTH_USERNAME?.trim();
  const password = process.env.AUTH_PASSWORD;
  const sessionSecret = process.env.AUTH_SESSION_SECRET?.trim();

  if (!username || !password || !sessionSecret) {
    return null;
  }

  return {
    username,
    password,
    sessionSecret,
  };
}

function getAuthConfig(): AuthConfig {
  const config = readAuthConfig();

  if (!config) {
    throw new Error("Authentication is not configured. Set AUTH_USERNAME, AUTH_PASSWORD, and AUTH_SESSION_SECRET.");
  }

  return config;
}

export function isAuthConfigured() {
  return readAuthConfig() !== null;
}

function toBase64Url(value: ArrayBuffer | string) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sign(value: string) {
  const { sessionSecret } = getAuthConfig();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
}

async function verify(value: string, signature: string) {
  const expected = toBase64Url(await sign(value));
  return expected === signature;
}

export function isValidCredential(username: string, password: string) {
  const config = readAuthConfig();
  return config ? username === config.username && password === config.password : false;
}

export async function createSessionToken(username: string) {
  const payload: SessionPayload = {
    u: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const encodedSignature = toBase64Url(await sign(encodedPayload));
  return `${encodedPayload}.${encodedSignature}`;
}

export async function verifySessionToken(token: string | undefined | null) {
  if (!isAuthConfigured()) {
    return null;
  }

  if (!token) {
    return null;
  }

  const [encodedPayload, encodedSignature] = token.split(".");

  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  if (!(await verify(encodedPayload, encodedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionPayload;

    if (!payload?.u || typeof payload.exp !== "number") {
      return null;
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  };
}
