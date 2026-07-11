/**
 * {@link NpmRegistry}: an in-process, spec-compliant npm registry.
 *
 * It is a plain `Bun.serve({ routes })` server plus an in-memory
 * package store. Starting one costs a socket bind and nothing else, so
 * the intended usage is one registry per test (or per `describe`), not
 * a shared singleton:
 *
 * ```ts
 * await using registry = await new NpmRegistry().start();
 * registry.define("left-pad", { "1.3.0": {} });
 * // point bun at `registry.url` and install
 * ```
 *
 * The class deliberately knows nothing about bun's test harness — no
 * `bunfig.toml`, no temp directories, no `expect`. Those conveniences
 * belong to the caller (see `test/harness.ts`). Everything here is the
 * HTTP contract of an npm registry, plus the hooks a test needs to
 * observe and perturb it.
 */

import type { Server } from "bun";
import { AdvisoryStore } from "./audit";
import { UserStore, type AccessRules, type AuthContext, type OtpChallengeOptions } from "./auth";
import { recordFromSpecs, type PackageOptions, type VersionSpec } from "./define";
import { json, npmError, packageNotFound, readJsonObject, requireJsonContentType } from "./errors";
import { FixtureTree } from "./fixtures";
import { RequestObserver, simulateFailures, type Interceptor, type SimulatedFailure } from "./observe";
import { cloneRecord, createRecord, effectiveDistTags, effectiveTime, type PackageRecord } from "./package-store";
import {
  ABBREVIATED_CONTENT_TYPE,
  FULL_CONTENT_TYPE,
  toPackument,
  toVersionManifest,
  wantsAbbreviated,
} from "./packument";
import { handlePublish, handleReplaceVersions } from "./publish";
import type { PublishBody, Version } from "./types";

export interface NpmRegistryOptions {
  /**
   * Directories of on-disk package fixtures (see `fixtures.ts` for the
   * layout). Searched in order; the first tree containing a name wins.
   * In-code definitions and published packages always shadow fixtures.
   */
  fixtures?: string | readonly string[];
  /**
   * Per-package access rules (see {@link AccessRules}). By default
   * everything is world-readable and world-publishable, like a
   * registry with no auth configured.
   */
  access?: AccessRules;
  /**
   * Shapes the 401 an OTP-enabled user receives when a write is
   * missing its `npm-otp` header.
   */
  otpChallenge?: OtpChallengeOptions;
  /**
   * The interface to bind. Left unset by default so `Bun.serve` binds
   * every interface and reports `http://localhost:<port>/` as the URL.
   * (Explicitly binding `"localhost"` picks one of `127.0.0.1`/`::1`,
   * and a client resolving `localhost` to the other cannot connect.)
   */
  hostname?: string;
  /** A fixed port. Defaults to an OS-assigned free port. */
  port?: number;
  /**
   * The `Cache-Control` header on packument responses.
   * registry.npmjs.org sends `public, max-age=300`; bun **does not read
   * this header** — its warm-manifest gate is an on-disk cache entry
   * younger than a hardcoded 300 s (`src/install/npm.rs`), independent
   * of what the registry sent. This option exists so a test can assert
   * bun tolerates what registry.npmjs.org sends, not to drive bun's
   * cache behavior. The conditional path (`ETag`/`If-None-Match` → 304)
   * is always on.
   *
   * Unset by default so that a test's second install is observable in
   * {@link NpmRegistry.requests}.
   */
  cacheControl?: string;
  /**
   * Log every request and its response status to stderr. Also enabled
   * by `BUN_TEST_NPM_REGISTRY_VERBOSE=1` in the environment.
   */
  verbose?: boolean;
}

/** Removes the interceptor it came from; usable with `using`. */
export type Uninstall = (() => void) & Disposable;

/** What Bun's router gives a routed handler. */
type RouteRequest = Request & { readonly params: Record<string, string> };
type RouteHandler = (request: RouteRequest) => Response | Promise<Response>;

export class NpmRegistry implements AsyncDisposable, Disposable {
  /** Packages defined in code or created by a publish. Shadows fixtures. */
  readonly #packages = new Map<string, PackageRecord>();
  /** Names hidden from every layer, including fixtures. */
  readonly #removed = new Set<string>();
  readonly #fixtures: readonly FixtureTree[];
  #fallback: ((name: string) => Record<Version, VersionSpec> | undefined) | undefined;
  #fallbackOptions: PackageOptions = {};
  /**
   * Names that were materialized into `#packages` from the fallback.
   * A later {@link defineFallback} forgets them, so changing the
   * fallback mid-test actually changes what those names resolve to.
   */
  readonly #fallbackNames = new Set<string>();

  readonly users: UserStore;
  readonly advisories = new AdvisoryStore();
  /**
   * Shapes the 401 an OTP-enabled user gets for a write without a
   * valid `npm-otp` header. Mutable so a test can build the challenge
   * (e.g. an `npm-notice` containing this registry's URL) after
   * {@link start}. See {@link OtpChallengeOptions}.
   */
  otpChallenge: OtpChallengeOptions;
  /** In-flight web-auth sessions: opaque id → the OTP `doneUrl` hands out. */
  readonly #otpSessions = new Map<string, string>();
  readonly #observer = new RequestObserver();
  /**
   * Everything a handler or a test's {@link intercept} threw. {@link stop}
   * rethrows the first; {@link takeHandlerErrors} drains it.
   */
  readonly #handlerErrors: unknown[] = [];
  readonly #options: NpmRegistryOptions;
  readonly #verbose: boolean;
  #server: Server | undefined;

  constructor(options: NpmRegistryOptions = {}) {
    this.#options = options;
    this.#verbose = options.verbose ?? Bun.env.BUN_TEST_NPM_REGISTRY_VERBOSE === "1";
    this.users = new UserStore({ access: options.access });
    this.otpChallenge = { ...options.otpChallenge };
    const dirs =
      options.fixtures === undefined
        ? []
        : typeof options.fixtures === "string"
          ? [options.fixtures]
          : options.fixtures;
    this.#fixtures = dirs.map(dir => FixtureTree.open(dir));
  }

  // ---------------------------------------------------------------- lifecycle

  /** Binds the server. Idempotent. */
  async start(): Promise<this> {
    this.#server ??= Bun.serve({
      hostname: this.#options.hostname,
      port: this.#options.port ?? 0,
      // Generous: a debug build of bun extracting a large dependency
      // tree can legitimately go quiet on a kept-alive connection.
      idleTimeout: 60,
      routes: this.#routes(),
      fetch: request => this.#handle(request as RouteRequest, this.#unrouted),
      error: error => {
        // Print it where it happened, and keep it: `stop()` rethrows, so a
        // failed `expect()` in an interceptor fails its test rather than
        // becoming a 500 the install under test may well tolerate.
        console.error("[npm-registry] handler threw:", error);
        this.#handlerErrors.push(error);
        return npmError(500, `registry handler threw: ${error?.message ?? error}`);
      },
    });
    return this;
  }

  /**
   * Drains what handlers threw, oldest first — how a test says "the throw
   * is what I was testing". Anything left rethrows from {@link stop}.
   */
  takeHandlerErrors(): unknown[] {
    return this.#handlerErrors.splice(0);
  }

  /**
   * Stops the server, closing in-flight connections, then rethrows the
   * first thing a handler threw (a `SuppressedError` under `await using`
   * if the body threw too). See {@link takeHandlerErrors}.
   */
  stop(): void {
    this.#server?.stop(true);
    this.#server = undefined;
    if (this.#handlerErrors.length > 0) throw this.#handlerErrors.splice(0)[0];
  }

  [Symbol.dispose](): void {
    this.stop();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.stop();
  }

  /** `http://<hostname>:<port>/`. Throws before {@link start}. */
  get url(): string {
    return this.#listening.url.href;
  }

  get port(): number {
    return this.#listening.port!;
  }

  get #listening(): Server {
    if (this.#server === undefined) throw new Error("NpmRegistry is not started; call start() first");
    return this.#server;
  }

  // ----------------------------------------------------------------- packages

  /**
   * Defines (or redefines) a package from in-code version specs. See
   * {@link VersionSpec}. Returns `this` for chaining.
   */
  define(name: string, versions: Record<Version, VersionSpec>, options?: PackageOptions): this {
    this.#removed.delete(name);
    this.#fallbackNames.delete(name);
    this.#packages.set(name, recordFromSpecs(name, versions, options));
    return this;
  }

  /**
   * Makes every package name the registry does not otherwise know
   * about resolve to these versions, each name getting its own
   * correctly-named tarball and package.json. A function form receives
   * the requested name and may return `undefined` to fall through to a
   * 404.
   *
   * This is what lets a test install `foo`, `bar`, and `baz` without
   * defining each one: the registry behaves like one that has
   * everything.
   *
   * Calling it again replaces the fallback and forgets every name it
   * materialized, so the next request for one sees the new versions.
   * Names from `define` or a publish are never affected.
   */
  defineFallback(
    versions: Record<Version, VersionSpec> | ((name: string) => Record<Version, VersionSpec> | undefined),
    options?: PackageOptions,
  ): this {
    for (const name of this.#fallbackNames) this.#packages.delete(name);
    this.#fallbackNames.clear();
    this.#fallback = typeof versions === "function" ? versions : () => versions;
    this.#fallbackOptions = options ?? {};
    return this;
  }

  /**
   * Makes a name 404, even if a fixture or the fallback knows it.
   * `define` brings it back.
   */
  remove(name: string): void {
    this.#packages.delete(name);
    this.#removed.add(name);
    this.#fallbackNames.delete(name);
  }

  /** Every package name the registry can resolve without the fallback. */
  get names(): string[] {
    const names = new Set(this.#packages.keys());
    for (const tree of this.#fixtures) for (const name of tree.names()) names.add(name);
    for (const name of this.#removed) names.delete(name);
    return [...names].sort();
  }

  /**
   * The full packument the registry would serve for `name`, or
   * `undefined`. For asserting on registry state after a publish.
   */
  async packument(name: string) {
    const record = this.#resolve(name);
    return record && toPackument(record, { registryUrl: this.url });
  }

  /**
   * Resolves a name to a record: in-code / published packages first,
   * then fixtures, then the fallback (whose record is materialized and
   * cached so its tarballs are only built once per name).
   */
  #resolve(name: string): PackageRecord | undefined {
    if (this.#removed.has(name)) return undefined;
    const owned = this.#packages.get(name);
    if (owned !== undefined) return owned;
    for (const tree of this.#fixtures) {
      const record = tree.get(name);
      if (record !== undefined) return record;
    }
    const versions = this.#fallback?.(name);
    if (versions !== undefined) {
      const record = recordFromSpecs(name, versions, this.#fallbackOptions);
      this.#packages.set(name, record);
      this.#fallbackNames.add(name);
      return record;
    }
    return undefined;
  }

  /**
   * Runs a write against a private copy of the record and commits it
   * only if the write succeeded, so a rejected publish can never leave
   * a half-created package behind (and the first publish of a name
   * cannot bring it into existence by failing). Fixture records are
   * shared process-wide; cloning is also what keeps them immutable.
   */
  async #write(name: string, mutate: (record: PackageRecord) => Response | Promise<Response>): Promise<Response> {
    const existing = this.#resolve(name);
    const working = existing !== undefined ? cloneRecord(existing) : createRecord(name);
    // Prime from the pre-mutation record so the write path sees the values the
    // client observed: `touchRecord`'s clamp needs `modified` (an unpublish
    // deletes versions first, so deriving it there would use the shrunk set),
    // `publishVersions` only sets `created` for a truly fresh name, and a
    // version's implicit time derives from its semver index, so publishing a
    // lower version would otherwise shift every later one's.
    const observed = effectiveTime(working);
    for (const key of Object.keys(observed)) {
      if (key === "created" && existing === undefined) continue;
      working.time[key] ??= observed[key];
    }
    const response = await mutate(working);
    if (response.ok) {
      this.#removed.delete(name);
      this.#fallbackNames.delete(name);
      this.#packages.set(name, working);
    }
    return response;
  }

  // -------------------------------------------------------------------- users

  /**
   * Creates a user and returns a bearer token for it, without an HTTP
   * round trip. `otp` makes writes by this user require a matching
   * `npm-otp` header.
   */
  addUser(user: { name: string; password: string; email?: string; otp?: string | string[] }): string {
    return this.users.add(user);
  }

  // -------------------------------------------------------------- observation

  /** Every request received so far, in arrival order. */
  get requests() {
    return this.#observer.requests;
  }

  /** The request URLs in arrival order. */
  get urls(): string[] {
    return this.#observer.urls;
  }

  /** The request paths (percent-decoded) in arrival order. */
  get paths(): string[] {
    return this.#observer.paths;
  }

  /** How many requests the registry has received. */
  get requestCount(): number {
    return this.#observer.count;
  }

  /** Forget recorded requests. Interceptors are untouched. */
  clearRequests(): void {
    this.#observer.clear();
  }

  /**
   * Installs an interceptor that may replace the response for any
   * request. Interceptors run in registration order before routing;
   * return `undefined` to fall through.
   *
   * Returns the uninstaller, which is also `Disposable` so a test on a
   * registry shared across a file can scope it with `using`.
   */
  intercept(interceptor: Interceptor): Uninstall {
    const uninstall = this.#observer.intercept(interceptor);
    return Object.assign(uninstall, { [Symbol.dispose]: uninstall });
  }

  /**
   * Fails the first N requests to each distinct URL with the given
   * status, then behaves normally. See {@link SimulatedFailure}.
   * Returns a disposable uninstaller, like {@link intercept}.
   */
  simulateFailures(options: SimulatedFailure): Uninstall {
    return this.intercept(simulateFailures(options));
  }

  // ------------------------------------------------------------------ routing

  #routes() {
    // Every route funnels through #handle so that request recording,
    // interception, and verbose logging are uniform.
    const h = (handler: RouteHandler) => (request: RouteRequest) => this.#handle(request, handler);

    // Registry endpoints live under `/-/`; everything else is a
    // package name. Static path segments always outrank parameters in
    // Bun's router, so `/-/whoami` coexists with `/:name/:version`. A
    // scoped name arrives as one URL-encoded segment (`/@scope%2fname`),
    // which the router decodes into `params.name` for us.
    return {
      "/-/ping": { GET: h(() => json({})) },
      "/-/whoami": { GET: h(req => this.users.handleWhoami(this.#auth(req))) },
      "/-/user/:couchId": { PUT: h(req => this.users.handleAdduser(req, req.params.couchId!)) },
      "/-/user/token/:token": {
        DELETE: h(req => this.users.handleRevokeToken(req.params.token!, this.#auth(req))),
      },
      "/-/npm/v1/security/advisories/bulk": { POST: h(req => this.#bulkAdvisories(req)) },
      // The scoped name arrives either as one `%2f`-encoded segment
      // (`/-/package/@scope%2fname/dist-tags`) or spelled with a
      // literal slash, which is one path segment longer.
      "/-/package/:name/dist-tags": { GET: h(req => this.#distTags(req, req.params.name!)) },
      "/-/package/:scope/:name/dist-tags": { GET: h(req => this.#scopedDistTags(req)) },
      // npm's web-authentication flow for a 2FA challenge. `authUrl` is
      // for a human; a client must never fetch it (tests assert that by
      // checking `registry.paths`). `doneUrl` is polled until it hands
      // back a one-time password.
      "/-/auth/web/:session": { GET: h(() => new Response("log in here", { status: 200 })) },
      "/-/auth/done/:session": { GET: h(req => this.#otpDone(req)) },

      "/:name": {
        GET: h(req => this.#servePackument(req, req.params.name!)),
        PUT: h(req => this.#publish(req, req.params.name!)),
      },
      "/:name/:versionOrTag": {
        GET: h(req => this.#versionOrScopedPackument(req)),
        // A publish to a scoped name with the slash spelled literally.
        PUT: h(req => this.#scopedPublish(req)),
      },
      "/:scope/:name/:versionOrTag": { GET: h(req => this.#scopedVersionManifest(req)) },
      "/:name/-/:file": { GET: h(req => this.#tarball(req)) },
      "/:scope/:name/-/:file": { GET: h(req => this.#tarball(req)) },
      "/:name/-rev/:rev": {
        PUT: h(req => this.#replaceVersions(req, req.params.name!)),
        DELETE: h(req => this.#unpublishAll(req, req.params.name!)),
      },
      "/:scope/:name/-rev/:rev": {
        PUT: h(req => this.#scopedRev(req, (r, name) => this.#replaceVersions(r, name))),
        DELETE: h(req => this.#scopedRev(req, (r, name) => this.#unpublishAll(r, name))),
      },
      "/:name/-/:file/-rev/:rev": { DELETE: h(req => this.#removeTarball(req)) },
      "/:scope/:name/-/:file/-rev/:rev": { DELETE: h(req => this.#removeTarball(req)) },
    };
  }

  /**
   * The per-request spine: record, give interceptors first refusal,
   * then run the route's handler.
   */
  async #handle(request: RouteRequest, handler: RouteHandler): Promise<Response> {
    const observed = this.#observer.record(request);
    const intercepted = await this.#observer.runInterceptors(request, observed);
    const response = intercepted ?? (await handler(request));
    if (this.#verbose) {
      console.error(`[npm-registry] ${request.method} ${observed.path} -> ${response.status}`);
    }
    return response;
  }

  /** Anything no route matched. */
  #unrouted = (request: Request): Response =>
    json({ error: "Not found", path: new URL(request.url).pathname }, { status: 404 });

  #auth(request: Request): AuthContext {
    return this.users.resolve(request);
  }

  // ----------------------------------------------------------------- handlers

  /**
   * `GET /:a/:b` is ambiguous. When the first segment is a *bare*
   * scope (`/@scope/name`, the slash spelled literally), it is the
   * unencoded scoped-packument spelling npm also accepts. Everything
   * else is the per-version manifest endpoint — including
   * `/@scope%2fname/1.0.0`, whose first segment the router has already
   * percent-decoded into a full scoped name containing a `/`.
   */
  async #versionOrScopedPackument(req: RouteRequest): Promise<Response> {
    const { name, versionOrTag } = req.params as { name: string; versionOrTag: string };
    if (name.startsWith("@") && !name.includes("/")) {
      return this.#servePackument(req, `${name}/${versionOrTag}`);
    }
    return this.#serveVersionManifest(req, name, versionOrTag);
  }

  /** `GET /@scope/name/:versionOrTag`, the slash spelled literally. */
  async #scopedVersionManifest(req: RouteRequest): Promise<Response> {
    const { scope, name, versionOrTag } = req.params as { scope: string; name: string; versionOrTag: string };
    if (!scope.startsWith("@")) return this.#unrouted(req);
    return this.#serveVersionManifest(req, `${scope}/${name}`, versionOrTag);
  }

  /**
   * `GET /:name/:versionOrTag` — the single-version document: the full
   * manifest for an exact version or for whatever a dist-tag points at.
   */
  async #serveVersionManifest(req: Request, name: string, versionOrTag: string): Promise<Response> {
    const denied = this.users.authorizeRead(name, this.#auth(req));
    if (denied !== undefined) return denied;
    const record = this.#resolve(name);
    if (record === undefined) return packageNotFound(name);
    const manifest = await toVersionManifest(record, versionOrTag, { registryUrl: this.url });
    if (manifest === undefined) return npmError(404, `version not found: ${name}@${versionOrTag}`);
    return json(manifest, { headers: { "content-type": FULL_CONTENT_TYPE } });
  }

  async #servePackument(req: Request, name: string): Promise<Response> {
    const denied = this.users.authorizeRead(name, this.#auth(req));
    if (denied !== undefined) return denied;
    const record = this.#resolve(name);
    if (record === undefined) return packageNotFound(name);

    const ctx = { registryUrl: this.url };
    const abbreviated = wantsAbbreviated(req.headers.get("accept"));
    const packument = abbreviated ? await toPackument(record, ctx, true) : await toPackument(record, ctx);
    const body = JSON.stringify(packument);

    // Validators. The document is a pure function of the record, so its
    // hash is an honest strong ETag; `modified` is the publish clock.
    // `Vary` names the one request header the body is a function of.
    const headers = new Headers({
      "content-type": abbreviated ? ABBREVIATED_CONTENT_TYPE : FULL_CONTENT_TYPE,
      "etag": `"${Bun.hash(body).toString(16)}"`,
      "last-modified": new Date(effectiveTime(record).modified!).toUTCString(),
      "vary": "accept",
    });
    if (this.#options.cacheControl !== undefined) headers.set("cache-control", this.#options.cacheControl);

    // `If-None-Match` takes precedence over `If-Modified-Since` (RFC
    // 9110 §13.1.3); npm clients send back whichever they stored.
    const inm = req.headers.get("if-none-match");
    const ims = Date.parse(req.headers.get("if-modified-since") ?? "");
    const notModified =
      inm !== null
        ? inm.split(",").some(tag => tag.trim().replace(/^W\//, "") === headers.get("etag"))
        : !Number.isNaN(ims) && Date.parse(headers.get("last-modified")!) <= ims;
    if (notModified) return new Response(null, { status: 304, headers });
    return new Response(body, { headers });
  }

  /**
   * `GET /:name/-/:file`, and the four-segment form scoped packages
   * use (`/@scope/name/-/name-1.0.0.tgz`). The filename carries the
   * version; the path's package name is authoritative for lookup and
   * access control.
   */
  async #tarball(req: RouteRequest): Promise<Response> {
    const { scope, name: bare, file } = req.params as { scope?: string; name: string; file: string };
    if (scope !== undefined && !scope.startsWith("@")) return this.#unrouted(req);
    const name = scope !== undefined ? `${scope}/${bare}` : bare;
    const denied = this.users.authorizeRead(name, this.#auth(req));
    if (denied !== undefined) return denied;

    const record = this.#resolve(name);
    const version = versionFromTarballName(name, file);
    const stored = version !== undefined ? record?.versions.get(version) : undefined;
    if (record === undefined || stored?.tarball === undefined) {
      return npmError(404, `no tarball for ${name} named ${JSON.stringify(file)}`);
    }
    const { bytes } = await stored.tarball();
    // `bytes` may be a `Buffer` subarray (a view), whose `.slice()` is
    // also a view, so `.buffer` would be the whole underlying pool;
    // `Response` serves exactly a view's window when handed one.
    return new Response(bytes, {
      headers: { "content-type": "application/octet-stream", "content-length": String(bytes.length) },
    });
  }

  /**
   * `PUT /@scope/name`, the slash spelled literally: two path segments,
   * so it lands on the `/:name/:versionOrTag` route. Only a bare scope
   * in the first segment means a scoped name; anything else has no PUT.
   */
  async #scopedPublish(req: RouteRequest): Promise<Response> {
    const { name, versionOrTag } = req.params as { name: string; versionOrTag: string };
    if (!name.startsWith("@") || name.includes("/")) return this.#unrouted(req);
    return this.#publish(req, `${name}/${versionOrTag}`);
  }

  /**
   * Guards every destructive write (publish, unpublish, deprecate):
   * first the access rule, then the second factor for a 2FA-enabled
   * user. Shared so the write handlers cannot drift apart.
   */
  #denyWrite(req: RouteRequest, name: string): Response | undefined {
    const auth = this.#auth(req);
    return (
      this.users.authorizeWrite(name, auth) ??
      this.users.authorizeOtp(req, auth, this.otpChallenge, otp => this.#newOtpSession(otp))
    );
  }

  async #publish(req: RouteRequest, name: string): Promise<Response> {
    const unsupported = requireJsonContentType(req);
    if (unsupported !== undefined) return unsupported;
    const denied = this.#denyWrite(req, name);
    if (denied !== undefined) return denied;

    const body = await readJsonObject<PublishBody>(req);
    if (body instanceof Response) return body;
    return this.#write(name, record => handlePublish(record, body));
  }

  /** Opens a web-auth session whose `doneUrl` will hand back `otp`. */
  #newOtpSession(otp: string): { authUrl: string; doneUrl: string } {
    const session = crypto.randomUUID();
    this.#otpSessions.set(session, otp);
    return { authUrl: `${this.url}-/auth/web/${session}`, doneUrl: `${this.url}-/auth/done/${session}` };
  }

  /** `GET /-/auth/done/:session` — the web-auth poll endpoint. */
  #otpDone(req: RouteRequest): Response {
    const otp = this.#otpSessions.get(req.params.session!);
    return otp === undefined ? npmError(404, "unknown or expired login session") : json({ token: otp });
  }

  async #replaceVersions(req: RouteRequest, name: string): Promise<Response> {
    const unsupported = requireJsonContentType(req);
    if (unsupported !== undefined) return unsupported;
    const denied = this.#denyWrite(req, name);
    if (denied !== undefined) return denied;
    if (this.#resolve(name) === undefined) return packageNotFound(name);
    const body = await readJsonObject<PublishBody>(req);
    if (body instanceof Response) return body;
    return this.#write(name, record => handleReplaceVersions(record, body));
  }

  /**
   * `PUT|DELETE /@scope/name/-rev/:rev`, the slash spelled literally —
   * the same spelling the version-manifest and dist-tags routes accept.
   */
  async #scopedRev(
    req: RouteRequest,
    handle: (req: RouteRequest, name: string) => Promise<Response>,
  ): Promise<Response> {
    const { scope, name } = req.params as { scope: string; name: string };
    if (!scope.startsWith("@")) return this.#unrouted(req);
    return handle(req, `${scope}/${name}`);
  }

  async #unpublishAll(req: RouteRequest, name: string): Promise<Response> {
    const denied = this.#denyWrite(req, name);
    if (denied !== undefined) return denied;
    if (this.#resolve(name) === undefined) return packageNotFound(name);
    this.remove(name);
    return json({ ok: true });
  }

  /**
   * `DELETE /:name/-/:file/-rev/:rev`: the last step of an unpublish.
   * The version was already removed by the (OTP-gated) `-rev` PUT;
   * this is the client asking the registry to delete the now-orphaned
   * object, so there is nothing left to authorize beyond the write
   * rule itself.
   */
  async #removeTarball(req: RouteRequest): Promise<Response> {
    const { scope, name: bare } = req.params as { scope?: string; name: string };
    if (scope !== undefined && !scope.startsWith("@")) return this.#unrouted(req);
    const name = scope !== undefined ? `${scope}/${bare}` : bare;
    return this.users.authorizeWrite(name, this.#auth(req)) ?? json({ ok: true });
  }

  async #bulkAdvisories(req: Request): Promise<Response> {
    const body = await readJsonObject<Record<string, string[]>>(req);
    if (body instanceof Response) return body;
    return this.advisories.handleBulk(body);
  }

  async #distTags(req: RouteRequest, name: string): Promise<Response> {
    const denied = this.users.authorizeRead(name, this.#auth(req));
    if (denied !== undefined) return denied;
    const record = this.#resolve(name);
    return record === undefined ? packageNotFound(name) : json(effectiveDistTags(record));
  }

  /** `GET /-/package/@scope/name/dist-tags`, the slash spelled literally. */
  async #scopedDistTags(req: RouteRequest): Promise<Response> {
    const { scope, name } = req.params as { scope: string; name: string };
    if (!scope.startsWith("@")) return this.#unrouted(req);
    return this.#distTags(req, `${scope}/${name}`);
  }
}

/**
 * Recovers the version from a tarball filename. The registry only ever
 * advertises `<basename>-<version>.tgz`, so the version is whatever
 * follows the basename. `undefined` for a filename the registry would
 * never have produced.
 */
function versionFromTarballName(name: string, file: string): string | undefined {
  const basename = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  const prefix = `${basename}-`;
  if (!file.startsWith(prefix) || !file.endsWith(".tgz")) return undefined;
  return file.slice(prefix.length, -".tgz".length);
}
