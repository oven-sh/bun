/**
 * Users, tokens, and per-package access rules.
 *
 * The npm auth surface this implements:
 *   - `PUT /-/user/org.couchdb.user:<name>` — `npm adduser` / `npm login`.
 *     Returns a bearer token. An existing user with a matching password
 *     logs in; a mismatched password is a 401.
 *   - `Authorization: Bearer <token>` — the token from the above.
 *   - `Authorization: Basic <base64(user:pass)>` — `.npmrc` `_auth`.
 *   - `GET /-/whoami` — the username for the presented credentials.
 *   - the `npm-otp` header — a second factor required for writes by
 *     users that have one configured.
 *
 * Access rules are evaluated per package name with glob patterns, like
 * verdaccio's `packages:` config: the first matching rule decides.
 */

import { forbidden, json, npmError, readJsonObject, unauthorized } from "./errors";
import type { RegistryToken, RegistryUser } from "./types";

/** Who may perform an action on a package. */
export type AccessLevel =
  /** Anyone, including unauthenticated requests. */
  | "all"
  /** Any request that presents valid credentials. */
  | "authenticated";

/**
 * Access configuration, keyed by a glob over package names (`**`,
 * `@scope/*`, …). The first key that matches wins; an unmatched name is
 * readable and publishable by everyone.
 */
export type AccessRules = Record<string, AccessLevel | { access?: AccessLevel; publish?: AccessLevel }>;

/** The result of resolving a request's `Authorization` header. */
export interface AuthContext {
  /** The authenticated user, if the credentials were valid. */
  user?: RegistryUser;
  /**
   * Set when an `Authorization` header was present but did not
   * correspond to a known token or user. Distinguishes "anonymous" from
   * "presented bad credentials", which get different status codes.
   */
  invalid?: string;
}

export interface UserStoreOptions {
  access?: AccessRules;
}

export class UserStore {
  readonly users = new Map<string, RegistryUser>();
  readonly tokens = new Map<string, RegistryToken>();
  readonly #rules: Array<{ glob: Bun.Glob; access: AccessLevel; publish: AccessLevel }>;

  constructor(options: UserStoreOptions = {}) {
    this.#rules = Object.entries(options.access ?? {}).map(([pattern, rule]) => {
      const normalized = typeof rule === "string" ? { access: rule, publish: rule } : rule;
      return {
        glob: new Bun.Glob(pattern),
        access: normalized.access ?? "all",
        publish: normalized.publish ?? "all",
      };
    });
  }

  /**
   * Registers a user and issues a token, without going through HTTP.
   * Throws on a duplicate name so a test that reuses one fails loudly
   * instead of silently sharing credentials.
   */
  add(user: { name: string; password: string; email?: string; otp?: string | string[] }): string {
    if (this.users.has(user.name)) throw new Error(`user ${JSON.stringify(user.name)} already exists`);
    this.users.set(user.name, {
      name: user.name,
      password: user.password,
      email: user.email ?? `${user.name}@example.com`,
      otp: user.otp === undefined ? undefined : Array.isArray(user.otp) ? user.otp : [user.otp],
    });
    return this.issueToken(user.name);
  }

  issueToken(name: string): string {
    const token = `npm_${crypto.randomUUID().replaceAll("-", "")}`;
    this.tokens.set(token, { token, user: name, created: new Date().toISOString() });
    return token;
  }

  /** Resolves `Authorization` (and nothing else) to a user. */
  resolve(request: Request): AuthContext {
    const header = request.headers.get("authorization");
    if (header === null) return {};

    const space = header.indexOf(" ");
    const scheme = space === -1 ? header : header.slice(0, space);
    const value = space === -1 ? "" : header.slice(space + 1).trim();

    switch (scheme.toLowerCase()) {
      case "bearer": {
        const token = this.tokens.get(value);
        const user = token && this.users.get(token.user);
        return user ? { user } : { invalid: "invalid bearer token" };
      }
      case "basic": {
        let decoded: string;
        try {
          decoded = Buffer.from(value, "base64").toString("utf8");
        } catch {
          return { invalid: "malformed Basic credentials" };
        }
        const colon = decoded.indexOf(":");
        if (colon === -1) return { invalid: "malformed Basic credentials" };
        const user = this.users.get(decoded.slice(0, colon));
        if (user === undefined || user.password !== decoded.slice(colon + 1)) {
          return { invalid: "invalid username or password" };
        }
        return { user };
      }
      default:
        return { invalid: `unsupported authorization scheme ${JSON.stringify(scheme)}` };
    }
  }

  #rule(name: string) {
    for (const rule of this.#rules) if (rule.glob.match(name)) return rule;
    return { access: "all" as const, publish: "all" as const };
  }

  /**
   * Enforces read access to a package. Returns a `Response` to send when
   * the request is not allowed, or `undefined` when it is.
   *
   * An unauthenticated request to a protected package gets a 401 so the
   * client knows credentials would help; a request with bad credentials
   * also gets a 401 (so the client can re-prompt) but with a message
   * that says why.
   */
  authorizeRead(name: string, auth: AuthContext): Response | undefined {
    if (this.#rule(name).access === "all") return undefined;
    if (auth.user !== undefined) return undefined;
    return unauthorized(
      auth.invalid !== undefined
        ? `unauthorized: ${auth.invalid}`
        : `unauthorized: authentication required to access ${name}`,
    );
  }

  /** Enforces write (publish/unpublish/dist-tag) access to a package. */
  authorizeWrite(name: string, auth: AuthContext): Response | undefined {
    if (auth.invalid !== undefined) return unauthorized(`unauthorized: ${auth.invalid}`);
    if (this.#rule(name).publish === "all") return undefined;
    if (auth.user !== undefined) return undefined;
    return unauthorized(`unauthorized: you must be logged in to publish ${name}`);
  }

  /**
   * Enforces the second factor for a write by an OTP-enabled user.
   * Returns the 401 challenge when the `npm-otp` header is missing or
   * not accepted; `undefined` when the write may proceed.
   *
   * The challenge is shaped exactly like registry.npmjs.org's:
   *   - a `www-authenticate: OTP` header, and the one error message npm
   *     clients match verbatim (bun greps the body for "one-time pass"
   *     to detect the challenge, and for the full sentence to report an
   *     *invalid* OTP after it already provided one).
   *   - `authUrl` / `doneUrl` in the body, npm's web-authentication
   *     flow. Clients default to `--auth-type=web`, so without these
   *     they fall back to an interactive stdin prompt; `webAuth` is
   *     therefore what `webSession` provides, unless turned off.
   */
  authorizeOtp(
    request: Request,
    auth: AuthContext,
    options: OtpChallengeOptions = {},
    webSession?: (otp: string) => { authUrl: string; doneUrl: string },
  ): Response | undefined {
    const otp = auth.user?.otp;
    if (otp === undefined) return undefined;
    const presented = request.headers.get("npm-otp");
    if (presented !== null && (options.acceptOtp ?? true) && otp.includes(presented)) return undefined;

    const headers = new Headers();
    if (options.wwwAuthenticate ?? true) headers.set("www-authenticate", "OTP");
    if (options.notice !== undefined) headers.set("npm-notice", options.notice);
    if (options.xLocalCache) headers.set("x-local-cache", "/path/to/cache");
    const web = (options.webAuth ?? true) && webSession !== undefined ? webSession(otp[0]!) : undefined;
    return json({ error: OTP_REQUIRED_MESSAGE, ...web }, { status: 401, headers });
  }

  /**
   * `PUT /-/user/org.couchdb.user:<name>` — `npm adduser`/`npm login`.
   */
  async handleAdduser(request: Request, couchId: string): Promise<Response> {
    const body = await readJsonObject<{ name?: string; password?: string; email?: string }>(request);
    if (body instanceof Response) return body;
    const name = body.name ?? couchId.replace(/^org\.couchdb\.user:/, "");
    if (!name || typeof body.password !== "string" || body.password.length === 0) {
      return npmError(400, "user/password are required");
    }

    const existing = this.users.get(name);
    if (existing === undefined) {
      const token = this.add({ name, password: body.password, email: body.email });
      return json({ ok: `user '${name}' created`, id: `org.couchdb.user:${name}`, token }, { status: 201 });
    }
    if (existing.password !== body.password) {
      return unauthorized("unauthorized: incorrect password");
    }
    return json(
      { ok: `you are authenticated as '${name}'`, id: `org.couchdb.user:${name}`, token: this.issueToken(name) },
      { status: 201 },
    );
  }

  /** `GET /-/whoami` */
  handleWhoami(auth: AuthContext): Response {
    if (auth.user === undefined) {
      return auth.invalid !== undefined
        ? unauthorized(`unauthorized: ${auth.invalid}`)
        : unauthorized("unauthorized: you must be logged in");
    }
    return json({ username: auth.user.name });
  }

  /** `DELETE /-/user/token/:token` — `npm logout`. */
  handleRevokeToken(token: string, auth: AuthContext): Response {
    if (auth.user === undefined) return unauthorized();
    const record = this.tokens.get(token);
    if (record === undefined) return npmError(404, "token not found");
    if (record.user !== auth.user.name) return forbidden("you may only revoke your own tokens");
    this.tokens.delete(token);
    return json({ ok: true });
  }
}

/**
 * registry.npmjs.org's OTP challenge message. The exact wording is part
 * of the protocol: npm clients detect the challenge by grepping the
 * body for "one-time pass", and report an *invalid* code (as opposed to
 * a missing one) by matching this whole sentence on the retry.
 */
export const OTP_REQUIRED_MESSAGE =
  "You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.";

/** Knobs on the 401 an OTP-enabled user gets for a write without one. */
export interface OtpChallengeOptions {
  /**
   * Include `www-authenticate: OTP` on the challenge. Real registries
   * always do; turning it off exercises clients that only look at the
   * error message.
   * @default true
   */
  wwwAuthenticate?: boolean;
  /**
   * Offer npm's web-authentication flow: the 401 body carries an
   * `authUrl` the client shows the user and a `doneUrl` it polls until
   * the registry hands back a one-time password. The registry's
   * `doneUrl` returns the challenged user's `otp` immediately, so a
   * non-interactive `bun publish` completes the whole 2FA round trip.
   *
   * npm clients default to `--auth-type=web`; without this a challenge
   * falls back to an interactive stdin prompt, which hangs a test.
   * @default true
   */
  webAuth?: boolean;
  /**
   * Reject the `npm-otp` header even when it matches the user's code,
   * like a registry would an expired or already-used one. The client
   * sees a second challenge and must report an invalid OTP.
   * @default true
   */
  acceptOtp?: boolean;
  /**
   * An `npm-notice` header to attach, e.g. a "visit <url> to login"
   * message from a registry that prefers web authentication.
   */
  notice?: string;
  /**
   * Attach an `x-local-cache` header, marking the response as having
   * come from the client's own HTTP cache. npm clients ignore
   * `npm-notice` on cached responses.
   */
  xLocalCache?: boolean;
}
