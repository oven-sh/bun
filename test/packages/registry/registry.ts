import type { BunFile, Server, TLSOptions } from "bun";
import { Advisories } from "./advisories.ts";
import { Auth, type Credentials, type Token, type User } from "./auth.ts";
import {
  RegistryError,
  bodyOf,
  lastModified,
  matchesEntityTag,
  methodNotAllowed,
  notFound,
  readJson,
  resourceNotFound,
  send,
  sendError,
  sendJson,
} from "./http.ts";
import { parsePackageName, type PackageName } from "./names.ts";
import { Packages, type AccessRules, type StoredPackage } from "./packages.ts";
import {
  abbreviatedContentType,
  own,
  renderAbbreviated,
  renderFull,
  renderVersion,
  tarballFilename,
  wantsAbbreviated,
  type RenderContext,
} from "./packument.ts";

export interface RecordedRequest {
  method: string;
  /** Path and query, as the client sent them. */
  path: string;
  headers: Record<string, string>;
  status: number;
}

export interface RegistryOptions {
  /**
   * A directory with one folder per package, `<name>/package.json` (the packument) next to the tarballs. This is
   * the storage layout of verdaccio. The registry reads it and never writes it: what a client publishes stays in
   * memory.
   */
  storage?: string;
  /** Who reads and writes which package, by name pattern. See `AccessRules`. */
  access?: AccessRules;
  /** The address to listen on. The default is the IPv4 loopback. */
  hostname?: string;
  /** The default, 0, takes a free port. */
  port?: number;
  tls?: TLSOptions;
  /**
   * The base of every tarball URL, for example `https://registry.example.com`. The default is the origin the
   * client used, so that the registry also works through a proxy or by another host name.
   */
  publicUrl?: string;
  /** Sent as the `npm-notice` header on the answers to an authenticated client. */
  notice?: string;
  /** Keep every request and the status of its answer in `requests`. */
  recordRequests?: boolean;
  /**
   * Runs before the registry handles a request. A returned Response is the answer. This is how a test makes the
   * registry fail or stall for one URL.
   */
  intercept?: (
    request: Request,
    registry: Registry,
  ) => Response | void | undefined | Promise<Response | void | undefined>;
}

const otpMessage = "You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.";
const packumentCacheControl = "public, max-age=300";
const tarballCacheControl = "public, immutable, max-age=31557600";
const couchUserPrefix = "org.couchdb.user:";

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Takes a package name from the front of a path: `@scope%2fname`, `@scope/name` or `name`. */
function takePackageName(segments: string[]): { name: PackageName; rest: string[] } | null {
  const [first, second] = segments;
  if (first === undefined) return null;
  let name = first;
  let rest = segments.slice(1);
  if (first.startsWith("@") && !first.includes("/")) {
    if (second === undefined) return null;
    name = `${first}/${second}`;
    rest = segments.slice(2);
  }
  const parsed = parsePackageName(name);
  return parsed && { name: parsed, rest };
}

function validDate(value: unknown, fallback: Date): Date {
  const date = typeof value === "string" ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? "unsatisfiable" : { start, end };
}

/**
 * An npm registry. It answers the HTTP API of registry.npmjs.org: the same paths, status codes, headers and bodies.
 *
 * ```ts
 * using registry = new Registry({ storage: "./packages" }).start();
 * const { token } = registry.auth.createToken(registry.auth.addUser("alice", "secret"));
 * await Bun.$`bun publish --registry ${registry.url}`.env({ ...process.env, NPM_CONFIG_TOKEN: token });
 * ```
 */
export class Registry {
  readonly auth = new Auth();
  readonly advisories = new Advisories();
  readonly packages: Packages;
  /** Filled when `recordRequests` is set. */
  readonly requests: RecordedRequest[] = [];
  readonly options: Readonly<RegistryOptions>;
  #server: Server<undefined> | null = null;

  constructor(options: RegistryOptions = {}) {
    this.options = options;
    this.packages = new Packages(options.storage, options.access);
  }

  /** Opens the port. A second call does nothing. */
  start(): this {
    this.#server ??= Bun.serve({
      hostname: this.options.hostname ?? "127.0.0.1",
      port: this.options.port ?? 0,
      tls: this.options.tls,
      // The default of 128 MB is the size of the JSON body. A tarball in it is base64.
      maxRequestBodySize: 512 * 1024 * 1024,
      // A client under load can leave a connection alone for longer than the default of 10 seconds, and then use
      // it again at the moment the server closes it.
      idleTimeout: 0,
      development: false,
      fetch: request => this.fetch(request),
    });
    return this;
  }

  /** Closes the port and every open connection. Users, tokens and packages stay, so `start` can follow. */
  stop() {
    this.#server?.stop(true);
    this.#server = null;
  }

  [Symbol.dispose]() {
    this.stop();
  }

  get listening(): boolean {
    return this.#server !== null;
  }

  get port(): number {
    const port = this.#server?.port;
    if (port === undefined) throw new Error("The registry has no port before start()");
    return port;
  }

  /** `http://localhost:<port>/`, the value for `registry=` in an `.npmrc` or a `bunfig.toml`. */
  get url(): string {
    return `${this.options.tls ? "https" : "http"}://localhost:${this.port}/`;
  }

  /** Answers one request. `start` passes every request of the port to it. */
  async fetch(request: Request): Promise<Response> {
    let response: Response;
    try {
      const intercepted = await this.options.intercept?.(request, this);
      response = intercepted instanceof Response ? intercepted : await this.#route(request, new URL(request.url));
    } catch (error) {
      if (error instanceof RegistryError) {
        response = sendError(request, error);
      } else {
        console.error(`[registry] ${request.method} ${request.url} failed:`, error);
        response = sendJson(request, { error: "Internal Server Error" }, { status: 500 });
      }
    }
    if (this.options.recordRequests) {
      const url = new URL(request.url);
      this.requests.push({
        method: request.method,
        path: url.pathname + url.search,
        headers: Object.fromEntries(request.headers),
        status: response.status,
      });
    }
    return response;
  }

  #route(request: Request, url: URL): Promise<Response> | Response {
    const segments: string[] = [];
    for (const raw of url.pathname.split("/")) {
      if (raw.length === 0) continue;
      const segment = decodeSegment(raw);
      if (segment === null) throw notFound();
      segments.push(segment);
    }
    if (segments.length === 0) {
      allow(request, "GET", "HEAD");
      return sendJson(request, {}, { headers: { "cache-control": tarballCacheControl } });
    }
    if (segments[0] === "-") return this.#service(request, url, segments.slice(1));
    return this.#package(request, url, segments);
  }

  #base(url: URL): string {
    return (this.options.publicUrl ?? url.origin).replace(/\/+$/, "");
  }

  #context(url: URL, stored: StoredPackage): RenderContext {
    return {
      name: stored.name.name,
      basename: stored.name.basename,
      base: this.#base(url),
      modified: stored.modified,
    };
  }

  // Credentials

  #noticed(credentials: Credentials, headers: Record<string, string> = {}): Record<string, string> {
    if (this.options.notice !== undefined && credentials.kind === "user") headers["npm-notice"] = this.options.notice;
    return headers;
  }

  /** The user of a request that only a logged in client can make. */
  #user(request: Request, message = "Unauthorized"): Extract<Credentials, { kind: "user" }> {
    const credentials = this.auth.credentials(request);
    if (credentials.kind === "user") return credentials;
    // The registry tells a client without credentials what is missing. It tells a client with wrong ones nothing.
    throw new RegistryError(401, message, credentials.kind === "invalid" ? { body: {} } : {});
  }

  /** The user of a request that changes something. It needs a token that can write, and a one-time password. */
  #writer(request: Request, url: URL, message = "You must be logged in to publish packages."): User {
    const { user, token } = this.#user(request, message);
    if (token?.readonly) {
      throw new RegistryError(403, "This token is read-only. Use a token that can publish.");
    }
    if (user.tfa === "auth-and-writes" && !token?.automation) this.#otp(request, url, user);
    return user;
  }

  #otp(request: Request, url: URL, user: User) {
    if (this.auth.isValidOtp(user, request.headers.get("npm-otp"))) return;
    const body: Record<string, string> = { error: otpMessage };
    if (request.headers.get("npm-auth-type") === "web") {
      // The client opens `authUrl` in a browser and waits at `doneUrl` for the code.
      const session = this.auth.openSession("otp", user.name);
      body.authUrl = `${this.#base(url)}/-/v1/auth/cli/${session.id}`;
      body.doneUrl = `${this.#base(url)}/-/v1/done?authId=${session.id}`;
    }
    throw new RegistryError(401, otpMessage, { body, headers: { "www-authenticate": "OTP" } });
  }

  // Packages

  async #package(request: Request, url: URL, segments: string[]): Promise<Response> {
    const taken = takePackageName(segments);
    if (taken === null) throw notFound();
    const { name, rest } = taken;

    if (rest.length === 0) {
      if (request.method === "PUT") return this.#write(request, url, name);
      allow(request, "GET", "HEAD", "PUT");
      const credentials = this.auth.credentials(request);
      return this.#packument(request, url, await this.packages.read(name.name, credentials));
    }

    if (rest[0] === "-rev" && rest.length === 2) {
      allow(request, "PUT", "DELETE");
      const user = this.#writer(request, url);
      const result =
        request.method === "PUT"
          ? await this.packages.replace(name, rest[1], await readJson(request), user)
          : await this.packages.unpublish(name, rest[1], user);
      return sendJson(request, result);
    }

    if (rest[0] === "-") {
      if (rest.length === 2) {
        allow(request, "GET", "HEAD");
        const stored = await this.packages.read(name.name, this.auth.credentials(request));
        return this.#tarball(request, stored, rest[1]);
      }
      if (rest.length === 4 && rest[2] === "-rev") {
        allow(request, "DELETE");
        const user = this.#writer(request, url);
        return sendJson(request, await this.packages.removeTarball(name, rest[1], rest[3], user));
      }
      throw resourceNotFound(url.pathname);
    }

    if (rest.length === 1) {
      allow(request, "GET", "HEAD");
      const stored = await this.packages.read(name.name, this.auth.credentials(request));
      const wanted = rest[0];
      const { versions, "dist-tags": tags } = stored.document;
      const version = own(versions, wanted) ?? own(versions, own(tags, wanted) ?? "");
      if (version === undefined) {
        throw new RegistryError(404, `version not found: ${wanted}`, { body: `version not found: ${wanted}` });
      }
      return sendJson(request, renderVersion(this.#context(url, stored), version), {
        headers: { "cache-control": packumentCacheControl, "vary": "accept-encoding, accept" },
      });
    }

    throw resourceNotFound(url.pathname);
  }

  #packument(request: Request, url: URL, stored: StoredPackage): Response {
    const abbreviated = wantsAbbreviated(request.headers.get("accept"));
    const context = this.#context(url, stored);
    const key = `${abbreviated ? "abbreviated" : "full"} ${context.base}`;
    let body = stored.rendered.get(key);
    if (body === undefined) {
      body = bodyOf(abbreviated ? renderAbbreviated(context, stored.document) : renderFull(context, stored.document));
      stored.rendered.set(key, body);
    }
    return send(request, body, {
      conditional: true,
      headers: {
        "content-type": abbreviated ? abbreviatedContentType : "application/json",
        "cache-control": packumentCacheControl,
        "last-modified": lastModified(validDate(stored.document.time?.modified, stored.modified)),
        "vary": "accept-encoding, accept",
      },
    });
  }

  async #tarball(request: Request, stored: StoredPackage, filename: string): Promise<Response> {
    const tarball = stored.tarballs.get(filename);
    if (tarball === undefined) throw notFound();
    if ("exists" in tarball && !(await (tarball as BunFile).exists())) throw notFound();

    const md5 = await this.packages.tarballHash(stored, filename, tarball);
    const version = Object.values(stored.document.versions).find(
      candidate => tarballFilename(candidate, stored.name.basename) === filename,
    );
    const published = validDate(version && stored.document.time?.[version.version], stored.modified);
    const headers = new Headers({
      "etag": `"${md5}"`,
      "last-modified": lastModified(published),
      "cache-control": tarballCacheControl,
    });

    if (matchesEntityTag(request.headers.get("if-none-match"), md5)) {
      headers.set("cache-control", packumentCacheControl);
      return new Response(null, { status: 304, headers });
    }

    const range = parseRange(request.headers.get("range"), tarball.size);
    if (range === "unsatisfiable") {
      headers.set("content-range", `bytes */${tarball.size}`);
      headers.delete("cache-control");
      return sendJson(
        request,
        { error: "Requested Range Not Satisfiable" },
        { status: 416, headers: toObject(headers) },
      );
    }

    headers.set("content-type", "application/octet-stream");
    headers.set("accept-ranges", "bytes");
    // The bytes, not the file: a file body makes Bun.serve add a Content-Disposition header that the registry does
    // not send.
    let body = await tarball.bytes();
    if (range !== null) {
      headers.set("content-range", `bytes ${range.start}-${range.end}/${tarball.size}`);
      body = body.subarray(range.start, range.end + 1);
    }
    if (request.method === "HEAD") {
      headers.set("content-length", String(body.byteLength));
      return new Response(null, { status: range === null ? 200 : 206, headers });
    }
    return new Response(body, { status: range === null ? 200 : 206, headers });
  }

  async #write(request: Request, url: URL, name: PackageName): Promise<Response> {
    const credentials = this.#user(request, "You must be logged in to publish packages.");
    const body = await readJson(request);
    const attachments = isObject(body) && isObject(body._attachments) ? Object.keys(body._attachments) : [];
    const starsOnly = isObject(body) && isObject(body.users) && body.versions === undefined;

    // Everyone who is logged in can star a package. Each other change needs the right to publish.
    const user = starsOnly ? credentials.user : this.#writer(request, url);
    const result =
      attachments.length > 0
        ? await this.packages.publish(name, body, user)
        : await this.packages.change(name, body, user);
    return sendJson(request, result, { headers: this.#noticed(credentials) });
  }

  // Services under /-/

  async #service(request: Request, url: URL, segments: string[]): Promise<Response> {
    const path = segments.join("/");

    switch (path) {
      case "ping": {
        allow(request, "GET", "HEAD");
        return sendJson(request, {});
      }
      case "whoami": {
        allow(request, "GET", "HEAD");
        const credentials = this.#user(request);
        return sendJson(request, { username: credentials.user.name }, { headers: this.#noticed(credentials) });
      }
      case "v1/login": {
        allow(request, "POST");
        await readJson(request);
        const session = this.auth.openSession("login", null);
        const base = this.#base(url);
        return sendJson(request, {
          loginUrl: `${base}/-/v1/login/cli/${session.id}`,
          doneUrl: `${base}/-/v1/done?sessionId=${session.id}`,
        });
      }
      case "v1/done": {
        allow(request, "GET");
        return this.#done(request, url);
      }
      case "v1/search": {
        allow(request, "GET", "HEAD");
        return this.#search(request, url);
      }
      case "npm/v1/user": {
        allow(request, "GET", "HEAD", "POST");
        return this.#profile(request, url);
      }
      case "npm/v1/tokens": {
        allow(request, "GET", "HEAD", "POST");
        return this.#tokens(request, url);
      }
      case "npm/v1/keys": {
        allow(request, "GET", "HEAD");
        // This registry does not sign what it stores, so it has no keys to publish.
        return sendJson(request, { keys: [] });
      }
      case "npm/v1/security/advisories/bulk": {
        allow(request, "POST");
        const body = await readJson(request);
        if (!isObject(body)) throw new RegistryError(400, "Bad Request: the body must be a JSON object");
        return sendJson(request, this.advisories.lookup(body));
      }
    }

    if (segments[0] === "user" && segments[1]?.startsWith(couchUserPrefix)) {
      const name = segments[1].slice(couchUserPrefix.length);
      const revised = segments.length === 4 && segments[2] === "-rev";
      if (segments.length === 2 || revised) {
        if (request.method === "PUT") return this.#login(request, url, name);
        if (!revised) {
          allow(request, "GET", "HEAD", "PUT");
          return this.#couchUser(request, name);
        }
      }
    }

    if (path.startsWith("user/token/") && segments.length === 3) {
      allow(request, "DELETE");
      const credentials = this.#user(request);
      if (!this.auth.revokeToken(segments[2], credentials.user.name)) throw notFound();
      return sendJson(request, { ok: true });
    }

    if (path.startsWith("npm/v1/tokens/token/") && segments.length === 5) {
      allow(request, "DELETE");
      const credentials = this.#user(request);
      if (!this.auth.revokeToken(segments[4], credentials.user.name)) throw notFound();
      return new Response(null, { status: 204 });
    }

    if ((path.startsWith("v1/login/cli/") || path.startsWith("v1/auth/cli/")) && segments.length === 4) {
      allow(request, "GET", "POST");
      // The page that the user opens in a browser. A request with the credentials of a user approves.
      const credentials = this.#user(request);
      const session = this.auth.sessions.get(segments[3]);
      if (session === undefined || (session.user !== null && session.user !== credentials.user.name)) throw notFound();
      this.auth.approveSession(session.id, credentials.user.name);
      return sendJson(request, { ok: true });
    }

    if (segments[0] === "package") {
      const taken = takePackageName(segments.slice(1));
      if (taken !== null) return this.#packageService(request, url, taken.name, taken.rest);
    }

    throw resourceNotFound(url.pathname);
  }

  async #packageService(request: Request, url: URL, name: PackageName, rest: string[]): Promise<Response> {
    const credentials = this.auth.credentials(request);
    const read = async () => {
      const stored = await this.packages.get(name.name);
      if (stored === null || !this.packages.canRead(stored, credentials)) {
        throw new RegistryError(404, "Not Found", { body: "Not Found" });
      }
      return stored;
    };

    if (rest[0] === "dist-tags" && rest.length === 1) {
      allow(request, "GET", "HEAD");
      return sendJson(request, (await read()).document["dist-tags"]);
    }
    if (rest[0] === "dist-tags" && rest.length === 2) {
      allow(request, "PUT", "POST", "DELETE");
      // Only a change of `latest` counts as a write that needs a one-time password.
      const user = rest[1] === "latest" ? this.#writer(request, url) : this.#writerWithoutOtp(request);
      if (request.method === "DELETE") await this.packages.removeTag(name, rest[1], user);
      else await this.packages.setTag(name, rest[1], await readJson(request), user);
      return sendJson(request, { ok: "dist-tags updated" });
    }
    if (rest[0] === "collaborators" && rest.length === 1) {
      allow(request, "GET", "HEAD");
      const maintainers = (await read()).document.maintainers ?? [];
      return sendJson(request, Object.fromEntries(maintainers.map(maintainer => [maintainer.name, "write"])));
    }
    if (rest[0] === "visibility" && rest.length === 1) {
      allow(request, "GET", "HEAD");
      return sendJson(request, { public: (await read()).access === "public" });
    }
    if (rest[0] === "access" && rest.length === 1) {
      allow(request, "POST");
      const user = this.#writer(request, url);
      const body = await readJson(request);
      await this.packages.setAccess(name, isObject(body) ? body.access : undefined, user);
      return sendJson(request, {});
    }
    throw resourceNotFound(url.pathname);
  }

  #writerWithoutOtp(request: Request): User {
    const { user, token } = this.#user(request);
    if (token?.readonly) throw new RegistryError(403, "This token is read-only. Use a token that can publish.");
    return user;
  }

  /** `npm adduser` and `npm login` with `--auth-type=legacy`. */
  async #login(request: Request, url: URL, name: string): Promise<Response> {
    const body = await readJson(request);
    if (!isObject(body) || typeof body.name !== "string" || typeof body.password !== "string") {
      throw new RegistryError(400, "Bad Request: name and password are required", { body: { ok: false } });
    }
    if (body.name !== name) {
      throw new RegistryError(400, "Bad Request: the name of the body is not the name of the URL");
    }

    let user = this.auth.users.get(name);
    if (user === undefined) {
      // `npm login` sends no email. A user that does not exist cannot log in.
      if (typeof body.email !== "string") {
        throw new RegistryError(400, `There is no user with the username "${name}".`);
      }
      user = this.auth.addUser(name, body.password, { email: body.email });
    } else {
      if (!this.auth.verifyPassword(user, body.password)) {
        throw new RegistryError(401, "Unauthorized", { body: { ok: false } });
      }
      if (user.tfa !== null) this.#otp(request, url, user);
    }

    const { token } = this.auth.createToken(user);
    return sendJson(
      request,
      { ok: true, id: `${couchUserPrefix}${name}`, rev: "_we_dont_use_revs_any_more", token },
      { status: 201, headers: { "cache-control": "no-cache, no-store" } },
    );
  }

  #couchUser(request: Request, name: string): Response {
    let credentials: Extract<Credentials, { kind: "user" }>;
    try {
      credentials = this.#user(request);
    } catch {
      throw new RegistryError(401, "Unauthorized", { body: { ok: false } });
    }
    const user = this.auth.users.get(name);
    if (user === undefined || user.name !== credentials.user.name) throw notFound();
    return sendJson(request, {
      _id: `${couchUserPrefix}${user.name}`,
      name: user.name,
      email: user.email,
      type: "user",
      roles: [],
      date: user.created.toISOString(),
    });
  }

  /** Where a client waits for the user to finish in the browser. */
  #done(request: Request, url: URL): Response {
    const id = url.searchParams.get("sessionId") ?? url.searchParams.get("authId");
    const session = id === null ? undefined : this.auth.sessions.get(id);
    if (session === undefined) throw notFound();
    session.polls++;
    if (session.result === null) {
      return sendJson(request, {}, { status: 202, headers: { "retry-after": "1" } });
    }
    // A login token is handed out once. A one-time password stays until a write uses it.
    if (session.kind === "login") this.auth.sessions.delete(session.id);
    return sendJson(request, { token: session.result });
  }

  async #profile(request: Request, url: URL): Promise<Response> {
    const credentials = this.#user(request);
    const user = credentials.user;
    if (request.method === "POST") {
      const body = await readJson(request);
      if (!isObject(body)) throw new RegistryError(400, "Bad Request: the body must be a JSON object");
      if (credentials.token?.readonly) throw new RegistryError(403, "This token is read-only.");
      if (isObject(body.password)) {
        const { old, new: next } = body.password;
        if (typeof old !== "string" || typeof next !== "string" || !this.auth.verifyPassword(user, old)) {
          throw new RegistryError(401, "The old password is not correct");
        }
        if (user.tfa !== null) this.#otp(request, url, user);
        this.auth.setPassword(user, next);
      }
      if (typeof body.email === "string") user.email = body.email;
      if (typeof body.fullname === "string") user.fullname = body.fullname;
      user.updated = new Date();
    }
    return sendJson(
      request,
      {
        tfa: user.tfa === null ? false : { pending: false, mode: user.tfa },
        name: user.name,
        email: user.email,
        email_verified: true,
        created: user.created.toISOString(),
        updated: user.updated.toISOString(),
        cidr_whitelist: null,
        fullname: user.fullname,
      },
      { headers: this.#noticed(credentials) },
    );
  }

  async #tokens(request: Request, url: URL): Promise<Response> {
    const credentials = this.#user(request);
    const user = credentials.user;
    const describe = (token: Token, value: string) => ({
      token: value,
      key: token.key,
      cidr_whitelist: token.cidr_whitelist,
      readonly: token.readonly,
      automation: token.automation,
      created: token.created.toISOString(),
      updated: token.updated.toISOString(),
    });

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!isObject(body) || typeof body.password !== "string" || !this.auth.verifyPassword(user, body.password)) {
        throw new RegistryError(401, "The password is not correct");
      }
      if (credentials.token?.readonly) throw new RegistryError(403, "This token is read-only.");
      if (user.tfa !== null) this.#otp(request, url, user);
      const cidr = Array.isArray(body.cidr_whitelist) ? body.cidr_whitelist.filter(x => typeof x === "string") : null;
      const token = this.auth.createToken(user, {
        readonly: body.readonly === true,
        automation: body.automation === true,
        cidr_whitelist: cidr,
      });
      return sendJson(request, describe(token, token.token));
    }

    const all = this.auth.tokensOf(user.name);
    const perPage = clamp(Number(url.searchParams.get("perPage") ?? 10), 1, 9999);
    const page = Number(url.searchParams.get("page") ?? 0);
    if (!Number.isInteger(page) || page < 0 || (page > 0 && page * perPage >= all.length)) {
      throw new RegistryError(400, "Bad Request: no such page");
    }
    const urls: Record<string, string> = {};
    if ((page + 1) * perPage < all.length) {
      urls.next = `${this.#base(url)}/-/npm/v1/tokens?page=${page + 1}&perPage=${perPage}`;
    }
    return sendJson(request, {
      objects: all
        .slice(page * perPage, (page + 1) * perPage)
        .map(token => describe(token, `${token.token.slice(0, 6)}...${token.token.slice(-4)}`)),
      total: all.length,
      urls,
    });
  }

  async #search(request: Request, url: URL): Promise<Response> {
    const credentials = this.auth.credentials(request);
    const words = (url.searchParams.get("text") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const size = clamp(Number(url.searchParams.get("size") ?? 20), 0, 250);
    const from = Math.max(0, Number(url.searchParams.get("from") ?? 0) || 0);

    const objects: { searchScore: number; package: Record<string, unknown> }[] = [];
    for (const name of await this.packages.names()) {
      const stored = await this.packages.get(name);
      if (stored === null || !this.packages.canRead(stored, credentials)) continue;
      const document = stored.document;
      const latest = own(document.versions, document["dist-tags"].latest ?? "");
      if (latest === undefined) continue;
      const keywords = Array.isArray(latest.keywords) ? latest.keywords.filter(word => typeof word === "string") : [];
      const description = typeof latest.description === "string" ? latest.description : undefined;

      let searchScore = 0;
      for (const word of words) {
        const qualifier = word.match(/^(scope|keywords|maintainer|author):(.*)$/);
        if (qualifier) {
          const [, kind, value] = qualifier;
          const author = isObject(latest.author) ? latest.author.name : latest.author;
          const hit =
            kind === "scope"
              ? stored.name.scope === value.replace(/^@/, "")
              : kind === "keywords"
                ? value.split(",").some(keyword => keywords.includes(keyword))
                : kind === "maintainer"
                  ? (document.maintainers ?? []).some(maintainer => maintainer.name === value)
                  : typeof author === "string" && author.toLowerCase().includes(value);
          searchScore = hit ? Math.max(searchScore, 1) : -Infinity;
        } else if (name === word) searchScore += 1000;
        else if (name.includes(word)) searchScore += 100;
        else if (keywords.some(keyword => keyword.toLowerCase() === word)) searchScore += 10;
        else if (description?.toLowerCase().includes(word)) searchScore += 1;
        else searchScore = -Infinity;
      }
      if (words.length > 0 && !(searchScore > 0)) continue;

      const maintainers = (document.maintainers ?? []).map(({ name, email }) => ({ username: name, email }));
      objects.push({
        searchScore,
        package: {
          name,
          ...(stored.name.scope === null ? { scope: "unscoped" } : { scope: stored.name.scope }),
          version: latest.version,
          description,
          keywords,
          date: document.time?.[latest.version] ?? stored.modified.toISOString(),
          links: { npm: `${this.#base(url)}/${name}` },
          publisher: maintainers[0],
          maintainers,
        },
      });
    }
    objects.sort(
      (a, b) => b.searchScore - a.searchScore || String(a.package.name).localeCompare(String(b.package.name)),
    );
    return sendJson(
      request,
      {
        objects: objects.slice(from, from + size).map(({ searchScore, package: found }) => ({
          package: found,
          score: { final: 1, detail: { quality: 1, popularity: 1, maintenance: 1 } },
          searchScore,
        })),
        total: objects.length,
        time: new Date().toISOString(),
      },
      { headers: { "cache-control": "max-age=300", "vary": "accept-encoding, accept" } },
    );
  }
}

function allow(request: Request, ...methods: string[]) {
  if (!methods.includes(request.method)) throw methodNotAllowed(request.method, methods);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.trunc(value))) : minimum;
}

function toObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers);
}
