/**
 * Firebase authentication and the token cache.
 *
 * Settle Up signs in with Google Identity Toolkit and talks to the database
 * with the resulting ID token. Unlike some services, Firebase has **no device
 * limit** — a refresh token renews forever and logging in again costs nothing.
 * So this caches the token only to avoid a needless round-trip, not to protect
 * a scarce resource, and an expired token renews itself with no human involved.
 */

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type SettleUpEnv, SettleUpError } from "../core/types.js";
import { FIREBASE, request } from "./http.js";

const IDENTITY = "https://identitytoolkit.googleapis.com/v1";
const SECURETOKEN = "https://securetoken.googleapis.com/v1";

export interface AuthOptions {
  env: SettleUpEnv;
  email?: string;
  password?: string;
  /** Use this ID token verbatim; renew from cache only if it has expired. */
  token?: string;
  /** Ignore any cached token and sign in fresh. */
  force?: boolean;
  /** Fail instead of signing in when there is no usable cached token. */
  noLogin?: boolean;
}

/** A live session: the ID token to send, and the user id it belongs to. */
export interface Session {
  idToken: string;
  uid: string;
}

function cacheDir(): string {
  const base =
    process.env.SETTLEUP_CONFIG_DIR ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "settleup-kit");
}

function cachePath(env: SettleUpEnv, email: string): string {
  const who = createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 12);
  return join(cacheDir(), `${env}-${who}.json`);
}

interface Cached {
  idToken: string;
  refreshToken: string;
  uid: string;
  email: string;
}

function readCache(path: string): Cached | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Cached;
  } catch {
    return null;
  }
}

function writeCache(path: string, value: Cached): void {
  mkdirSync(dirname(path), { recursive: true });
  // The ID token and refresh token together are equivalent to the password, so
  // keep the file owner-only. `mode` applies on creation, so chmod after every
  // write repairs a file that was copied in world-readable.
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** A JWT's claims, or undefined when it is not a readable JWT. */
function claimsOf(jwt: string): { exp?: number; user_id?: string; sub?: string } | undefined {
  try {
    const body = jwt.split(".")[1];
    if (!body) return undefined;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** True when the token is absent, unparseable, or within a minute of expiry. */
function expired(jwt: string | undefined): boolean {
  if (!jwt) return true;
  const claims = claimsOf(jwt);
  if (!claims?.exp) return true;
  return claims.exp - 60 < Date.now() / 1000;
}

function uidOf(jwt: string): string | undefined {
  const claims = claimsOf(jwt);
  return claims?.user_id ?? claims?.sub;
}

interface SignInResponse {
  idToken: string;
  refreshToken: string;
  localId: string;
}

/** Email/password sign-in. No captcha; returns a 1-hour ID token and a refresh token. */
async function signIn(env: SettleUpEnv, email: string, password: string): Promise<Cached> {
  const res = await request<SignInResponse>(
    `${IDENTITY}/accounts:signInWithPassword?key=${FIREBASE[env].apiKey}`,
    { method: "POST", body: { email, password, returnSecureToken: true } },
  );
  return toCached(email, res.idToken, res.refreshToken, res.localId);
}

interface RefreshResponse {
  id_token: string;
  refresh_token: string;
  user_id: string;
}

/** Renew an ID token from its refresh token. Costs nothing and never expires. */
async function refresh(env: SettleUpEnv, refreshToken: string, email: string): Promise<Cached> {
  const res = await request<RefreshResponse>(`${SECURETOKEN}/token?key=${FIREBASE[env].apiKey}`, {
    method: "POST",
    form: { grant_type: "refresh_token", refresh_token: refreshToken },
  });
  return toCached(email, res.id_token, res.refresh_token, res.user_id);
}

// Expiry is not stored: it is already a claim inside the token, and a second
// copy on disk is one that can disagree with it.
function toCached(email: string, idToken: string, refreshToken: string, uid: string): Cached {
  return { idToken, refreshToken, uid, email };
}

function fromEnv(options: AuthOptions): AuthOptions {
  return {
    ...options,
    email: options.email ?? process.env.SETTLEUP_EMAIL,
    password: options.password ?? process.env.SETTLEUP_PASSWORD,
    token: options.token ?? process.env.SETTLEUP_ID_TOKEN,
  };
}

/** Renewals in flight, so concurrent callers share one round-trip. */
const renewals = new Map<string, Promise<Session>>();

/**
 * Get a usable session, renewing it without human involvement.
 *
 * The order is by cost: a supplied token if fresh, the cached token if fresh,
 * a refresh (free), then a login. Because there is no device limit, none of
 * these steps is dangerous — the ordering is only to avoid needless requests.
 */
export async function authenticate(options: AuthOptions): Promise<Session> {
  const opts = fromEnv(options);

  // A supplied token is honoured while it lasts; its uid comes from the JWT.
  if (opts.token && !expired(opts.token)) {
    const uid = uidOf(opts.token);
    if (!uid) {
      throw new SettleUpError("SETTLEUP_ID_TOKEN is not a readable Firebase ID token");
    }
    return { idToken: opts.token, uid };
  }

  if (!opts.email) {
    throw new SettleUpError(
      "No credentials. Set SETTLEUP_EMAIL and SETTLEUP_PASSWORD, or pass\n" +
        "SETTLEUP_ID_TOKEN to use a token directly.",
    );
  }

  const path = cachePath(opts.env, opts.email);
  const inFlight = renewals.get(path);
  if (inFlight) return inFlight;

  const renewal = renew(opts, path).finally(() => renewals.delete(path));
  renewals.set(path, renewal);
  return renewal;
}

async function renew(opts: AuthOptions, path: string): Promise<Session> {
  const cached = opts.force ? null : readCache(path);

  if (cached && !expired(cached.idToken)) {
    return { idToken: cached.idToken, uid: cached.uid };
  }

  const email = opts.email as string;

  if (cached?.refreshToken && !opts.force) {
    try {
      const next = await refresh(opts.env, cached.refreshToken, email);
      writeCache(path, next);
      return { idToken: next.idToken, uid: next.uid };
    } catch {
      // A refresh token can be revoked; fall through to a login rather than fail.
    }
  }

  if (opts.noLogin) {
    throw new SettleUpError(
      `No usable cached token for ${email} and signing in is disabled. Run \`settleup login\`.`,
    );
  }

  if (!opts.password) {
    throw new SettleUpError("SETTLEUP_PASSWORD is required to sign in.");
  }

  const session = await signIn(opts.env, email, opts.password);
  writeCache(path, session);
  return { idToken: session.idToken, uid: session.uid };
}

/** Where a token for this account is cached. Useful in errors and docs. */
export function tokenLocation(env: SettleUpEnv, email: string): string {
  return cachePath(env, email);
}
