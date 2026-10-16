import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { RegistryError } from "./http.ts";

/**
 * Two-factor modes of the registry.
 * - `auth-only`: a one-time password is needed to log in and to create a token.
 * - `auth-and-writes`: it is also needed for each publish, unpublish, deprecate, and change of `latest`.
 */
export type TwoFactorMode = "auth-only" | "auth-and-writes";

export interface UserOptions {
  email?: string;
  fullname?: string;
  tfa?: TwoFactorMode;
  /**
   * The one-time passwords this user can present. A real authenticator derives them from the time. A test needs
   * to know them in advance. Each code works any number of times.
   */
  otp?: string[];
}

export interface User {
  name: string;
  email: string;
  fullname: string;
  passwordHash: Buffer;
  tfa: TwoFactorMode | null;
  otp: string[];
  created: Date;
  updated: Date;
}

export interface TokenOptions {
  readonly?: boolean;
  /** An automation token passes the two-factor check on a write. */
  automation?: boolean;
  cidr_whitelist?: string[] | null;
}

export interface Token {
  token: string;
  /** Hex sha512 of `token`. The registry shows this, never the token, after creation. */
  key: string;
  user: string;
  readonly: boolean;
  automation: boolean;
  cidr_whitelist: string[] | null;
  created: Date;
  updated: Date;
}

export type Credentials =
  /** No `Authorization` header. */
  | { kind: "none" }
  /** A header that names no user of this registry: an unknown token, a wrong password, a scheme it does not know. */
  | { kind: "invalid" }
  | { kind: "user"; user: User; via: "basic" | "bearer"; token: Token | null };

/** The state of a login or a one-time password that the user completes in a browser. */
export interface WebSession {
  id: string;
  kind: "login" | "otp";
  /** The user that asked for the one-time password. A login session has none before it is approved. */
  user: string | null;
  /** The value that the `doneUrl` hands to the client. Null while the user has not approved. */
  result: string | null;
  polls: number;
}

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** `npm_` and 36 characters, the form of a token of registry.npmjs.org. */
function generateToken(): string {
  let token = "npm_";
  // 248 is the largest multiple of 62 below 256. A byte above it would favor the first characters.
  for (const byte of randomBytes(96)) {
    if (byte >= 248) continue;
    token += alphabet[byte % 62];
    if (token.length === 40) return token;
  }
  return generateToken();
}

function hashPassword(password: string): Buffer {
  return new Bun.CryptoHasher("sha256").update(password).digest();
}

export class Auth {
  readonly users = new Map<string, User>();
  readonly tokens = new Map<string, Token>();
  readonly sessions = new Map<string, WebSession>();

  addUser(name: string, password: string, options: UserOptions = {}): User {
    if (this.users.has(name)) throw new RegistryError(409, `user ${name} already exists`);
    if (!/^[a-z0-9][a-z0-9._~-]*$/i.test(name) || name.length > 214) {
      throw new RegistryError(400, "Name may not contain non-url-safe chars");
    }
    if (typeof password !== "string" || password.length === 0) {
      throw new RegistryError(400, "A password is required");
    }
    const now = new Date();
    const user: User = {
      name,
      email: options.email ?? `${name}@example.com`,
      fullname: options.fullname ?? "",
      passwordHash: hashPassword(password),
      tfa: options.tfa ?? null,
      otp: options.otp ?? [],
      created: now,
      updated: now,
    };
    this.users.set(name, user);
    return user;
  }

  verifyPassword(user: User, password: string): boolean {
    return timingSafeEqual(user.passwordHash, hashPassword(password));
  }

  setPassword(user: User, password: string) {
    user.passwordHash = hashPassword(password);
    user.updated = new Date();
  }

  createToken(user: string | User, options: TokenOptions = {}): Token {
    const name = typeof user === "string" ? user : user.name;
    if (!this.users.has(name)) throw new RegistryError(404, `user ${name} does not exist`);
    const token = generateToken();
    const now = new Date();
    const entry: Token = {
      token,
      key: new Bun.CryptoHasher("sha512").update(token).digest("hex"),
      user: name,
      readonly: options.readonly ?? false,
      automation: options.automation ?? false,
      cidr_whitelist: options.cidr_whitelist ?? null,
      created: now,
      updated: now,
    };
    this.tokens.set(token, entry);
    return entry;
  }

  /** Removes a token by its value or by its key. Returns false when there is no such token. */
  revokeToken(tokenOrKey: string, owner?: string): boolean {
    for (const [value, entry] of this.tokens) {
      if (value !== tokenOrKey && entry.key !== tokenOrKey) continue;
      if (owner !== undefined && entry.user !== owner) continue;
      this.tokens.delete(value);
      return true;
    }
    return false;
  }

  tokensOf(user: string): Token[] {
    return [...this.tokens.values()].filter(token => token.user === user);
  }

  /** Reads the `Authorization` header. The registry accepts `Bearer <token>` and `Basic <base64 of user:password>`. */
  credentials(request: Request): Credentials {
    const header = request.headers.get("authorization");
    if (header === null || header.trim().length === 0) return { kind: "none" };
    const space = header.indexOf(" ");
    if (space === -1) return { kind: "invalid" };
    const scheme = header.slice(0, space).toLowerCase();
    const value = header.slice(space + 1).trim();

    if (scheme === "bearer") {
      const token = this.tokens.get(value);
      const user = token && this.users.get(token.user);
      return user ? { kind: "user", user, via: "bearer", token } : { kind: "invalid" };
    }

    if (scheme === "basic") {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon === -1) return { kind: "invalid" };
      const user = this.users.get(decoded.slice(0, colon));
      if (!user || !this.verifyPassword(user, decoded.slice(colon + 1))) return { kind: "invalid" };
      return { kind: "user", user, via: "basic", token: null };
    }

    return { kind: "invalid" };
  }

  isValidOtp(user: User, otp: string | null): boolean {
    if (otp === null) return false;
    if (user.otp.includes(otp)) return true;
    // The result of a web session that this user approved counts as a one-time password, once.
    for (const [id, session] of this.sessions) {
      if (session.kind === "otp" && session.user === user.name && session.result === otp) {
        this.sessions.delete(id);
        return true;
      }
    }
    return false;
  }

  openSession(kind: WebSession["kind"], user: string | null): WebSession {
    const session: WebSession = { id: randomUUID(), kind, user, result: null, polls: 0 };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Does what the user does in the browser. A login session gets a new token of `user`. A one-time password
   * session gets a code that is good for one write.
   */
  approveSession(id: string, user?: string): WebSession {
    const session = this.sessions.get(id);
    if (!session) throw new RegistryError(404, `no web session ${id}`);
    if (session.kind === "login") {
      if (user === undefined) throw new RegistryError(400, "a login session needs the user that logs in");
      session.user = user;
      session.result = this.createToken(user).token;
    } else {
      session.result = randomUUID();
    }
    return session;
  }
}
