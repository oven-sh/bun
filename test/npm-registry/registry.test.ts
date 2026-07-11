import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  NpmRegistry,
  OTP_REQUIRED_MESSAGE,
  buildTarball,
  computeIntegrity,
  readTarball,
  type AbbreviatedPackument,
  type Packument,
} from "npm-registry";

const CORGI = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

async function getJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T; headers: Headers }> {
  const response = await fetch(url, init);
  return { status: response.status, body: (await response.json()) as T, headers: response.headers };
}

describe("packument", () => {
  test("the full document has registry metadata and everything the package declared", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", {
      "1.0.0": { description: "one", scripts: { postinstall: "node x.js" }, main: "index.js" },
      "2.0.0": { dependencies: { "left-pad": "^1.0.0" } },
    });

    const { status, body, headers } = await getJson<Packument>(`${registry.url}pkg`);
    expect(status).toBe(200);
    expect(headers.get("content-type")).toBe("application/json");
    expect(body._id).toBe("pkg");
    expect(body.name).toBe("pkg");
    expect(body["dist-tags"]).toEqual({ latest: "2.0.0" });
    expect(Object.keys(body.versions)).toEqual(["1.0.0", "2.0.0"]);
    expect(body.time["1.0.0"]).toBeString();
    expect(body.time.modified).toBeString();

    const v1 = body.versions["1.0.0"]!;
    expect(v1).toEqual({
      name: "pkg",
      version: "1.0.0",
      _id: "pkg@1.0.0",
      description: "one",
      main: "index.js",
      scripts: { postinstall: "node x.js" },
      dist: {
        tarball: `${registry.url}pkg/-/pkg-1.0.0.tgz`,
        integrity: expect.stringMatching(/^sha512-[A-Za-z0-9+/]+=*$/),
        shasum: expect.stringMatching(/^[0-9a-f]{40}$/),
        fileCount: 1,
        unpackedSize: expect.any(Number),
      },
    });
  });

  test("hasInstallScript is truthiness, not presence: empty scripts run nothing", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("empty-scripts", { "1.0.0": { scripts: { preinstall: "", install: "", postinstall: "" } } });
    registry.define("real-script", { "1.0.0": { scripts: { install: "node x" } } });
    const corgi = async (name: string) =>
      (await getJson<any>(`${registry.url}${name}`, { headers: { accept: CORGI } })).body.versions["1.0.0"];
    expect((await corgi("empty-scripts")).hasInstallScript).toBeUndefined();
    expect((await corgi("real-script")).hasInstallScript).toBe(true);
  });

  test("the abbreviated document strips scripts and derives hasInstallScript", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", {
      "1.0.0": { description: "x", scripts: { postinstall: "node x.js" }, main: "index.js" },
      "2.0.0": { scripts: { test: "true" } },
    });

    const { body, headers } = await getJson<AbbreviatedPackument>(`${registry.url}pkg`, {
      headers: { accept: CORGI },
    });
    expect(headers.get("content-type")).toBe("application/vnd.npm.install-v1+json");
    expect(body).toEqual({
      name: "pkg",
      modified: expect.any(String),
      "dist-tags": { latest: "2.0.0" },
      versions: {
        // `description`, `main`, and `scripts` are gone; `postinstall`
        // surfaces only as the derived boolean.
        "1.0.0": { name: "pkg", version: "1.0.0", hasInstallScript: true, dist: expect.any(Object) },
        // A `test` script is not an install script.
        "2.0.0": { name: "pkg", version: "2.0.0", dist: expect.any(Object) },
      },
    });
  });

  test("bin is normalized the way npm-normalize-package-bin does it", async () => {
    await using registry = await new NpmRegistry().start();
    // npm's only key rejection is `.` / `..` (an empty contained
    // basename); a dot-prefixed name like `.dotcmd` is a legal bin.
    // Targets are path-normalized under the package root.
    registry.define("dotty", {
      "1.0.0": { bin: { ".dotcmd": "./cli.js", ".": "a", "..": "b" }, tarball: { "cli.js": "x" } },
    });
    expect((await registry.packument("dotty"))!.versions["1.0.0"]!.bin).toEqual({ ".dotcmd": "cli.js" });

    // npm treats "\" (and, for keys, ":") as "/" before containing the
    // basename; both outputs below are verified against the reference.
    registry.define("winslash", {
      "1.0.0": { bin: { "tools\\cmd": "bin\\cli.js", "C:alt": "cli.js" } },
    });
    expect((await registry.packument("winslash"))!.versions["1.0.0"]!.bin).toEqual({
      cmd: "bin/cli.js",
      alt: "cli.js",
    });
  });

  test("dist.integrity is the sha512 of the bytes the tarball route serves", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0": { tarball: { "index.js": "module.exports = 7;\n" } } });

    const { body } = await getJson<Packument>(`${registry.url}pkg`);
    const dist = body.versions["1.0.0"]!.dist;
    const served = new Uint8Array(await (await fetch(dist.tarball)).arrayBuffer());
    expect(computeIntegrity(served)).toEqual({ integrity: dist.integrity, shasum: dist.shasum });

    const { files } = await readTarball(served);
    expect(Object.keys(files).sort()).toEqual(["index.js", "package.json"]);
    expect(JSON.parse(Buffer.from(files["package.json"]!).toString())).toEqual({ name: "pkg", version: "1.0.0" });
  });

  test("a defined package has the same integrity in every registry instance", async () => {
    const define = (r: NpmRegistry) => r.define("p", { "1.0.0": { tarball: { "a.js": "1\n" } } });
    await using a = await define(new NpmRegistry()).start();
    await using b = await define(new NpmRegistry()).start();
    const integrity = async (r: NpmRegistry) =>
      (await getJson<Packument>(`${r.url}p`)).body.versions["1.0.0"]!.dist.integrity;
    expect(await integrity(a)).toBe(await integrity(b));
  });

  test("an unknown package is the npm 404 document", async () => {
    await using registry = await new NpmRegistry().start();
    expect(await getJson(`${registry.url}nope`)).toMatchObject({ status: 404, body: { error: "Not found" } });
  });

  test("a conditional request that matches the validators is a 304", async () => {
    await using registry = await new NpmRegistry({ cacheControl: "public, max-age=300" }).start();
    registry.define("pkg", { "1.0.0": {} });

    const first = await fetch(`${registry.url}pkg`);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
    expect(first.headers.get("cache-control")).toBe("public, max-age=300");
    expect(first.headers.get("last-modified")).toBe(new Date("1985-10-26T08:15:00.000Z").toUTCString());
    // The body negotiates on Accept, so Vary must name it.
    expect(first.headers.get("vary")).toBe("accept");

    const revalidated = await fetch(`${registry.url}pkg`, { headers: { "if-none-match": etag } });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("vary")).toBe("accept");
    const lastModified = first.headers.get("last-modified")!;
    // RFC 9110 §13.1.3 compares parsed dates with <=, so a later date
    // than the registry ever emitted is a 304, not just a verbatim echo.
    const later = new Date(Date.parse(lastModified) + 1000).toUTCString();
    expect((await fetch(`${registry.url}pkg`, { headers: { "if-modified-since": later } })).status).toBe(304);
    expect((await fetch(`${registry.url}pkg`, { headers: { "if-modified-since": lastModified } })).status).toBe(304);
    // New registry state invalidates the validator.
    registry.define("pkg", { "1.0.0": {}, "2.0.0": {} });
    expect((await fetch(`${registry.url}pkg`, { headers: { "if-none-match": etag } })).status).toBe(200);
    // The full and abbreviated documents have distinct ETags.
    expect((await fetch(`${registry.url}pkg`, { headers: { accept: CORGI } })).headers.get("etag")).not.toBe(etag);
  });

  test("GET /:name/:version serves one version's manifest, by version or dist-tag", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define(
      "pkg",
      { "1.0.0": {}, "2.0.0-beta.1": {} },
      { distTags: { latest: "1.0.0", next: "2.0.0-beta.1" } },
    );
    expect((await getJson<{ version: string }>(`${registry.url}pkg/1.0.0`)).body.version).toBe("1.0.0");
    expect((await getJson<{ version: string }>(`${registry.url}pkg/next`)).body.version).toBe("2.0.0-beta.1");
    expect((await getJson(`${registry.url}pkg/3.0.0`)).status).toBe(404);
  });

  test("the per-version manifest of a scoped package answers to both URL spellings", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("@s/pkg", { "1.0.0": { description: "scoped" }, "2.0.0": {} });
    // The encoded spelling arrives as two path segments, the first of
    // which the router has already decoded into a name containing `/`.
    const encoded = await getJson<Packument>(`${registry.url}@s%2fpkg/1.0.0`);
    expect(encoded.body).toMatchObject({ name: "@s/pkg", version: "1.0.0", description: "scoped" });
    // The literal spelling is three segments.
    expect((await getJson<Packument>(`${registry.url}@s/pkg/1.0.0`)).body).toEqual(encoded.body);
    expect((await getJson<{ version: string }>(`${registry.url}@s%2fpkg/latest`)).body.version).toBe("2.0.0");
    expect((await getJson(`${registry.url}@s%2fpkg/9.0.0`)).status).toBe(404);
    // The bare-scope two-segment spelling is still the whole packument.
    expect(Object.keys((await getJson<Packument>(`${registry.url}@s/pkg`)).body.versions)).toEqual(["1.0.0", "2.0.0"]);
  });
});

describe("dist-tags", () => {
  test("latest defaults to the highest non-prerelease version", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0": {}, "1.2.0": {}, "2.0.0-beta.1": {} });
    expect((await registry.packument("pkg"))!["dist-tags"]).toEqual({ latest: "1.2.0" });
  });

  test("latest falls back to the highest version when every version is a prerelease", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0-a.2": {}, "1.0.0-a.10": {} });
    expect((await registry.packument("pkg"))!["dist-tags"]).toEqual({ latest: "1.0.0-a.10" });
  });

  test("a hyphen in build metadata does not make a version a prerelease", async () => {
    await using registry = await new NpmRegistry().start();
    // SemVer build-metadata identifiers may contain `-`; 2.0.0+build-7
    // is a stable release and must win `latest` over 1.0.0.
    registry.define("pkg", { "1.0.0": {}, "2.0.0+build-7": {} });
    expect((await registry.packument("pkg"))!["dist-tags"]).toEqual({ latest: "2.0.0+build-7" });
  });

  test("explicit dist-tags win and /-/package/:name/dist-tags serves them", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0": {}, "2.0.0": {} }, { distTags: { latest: "1.0.0", next: "2.0.0" } });
    expect((await getJson(`${registry.url}-/package/pkg/dist-tags`)).body).toEqual({ latest: "1.0.0", next: "2.0.0" });
  });

  test("a scoped package's dist-tags answer to both URL spellings", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("@s/pkg", { "1.0.0": {}, "2.0.0": {} }, { distTags: { latest: "1.0.0", next: "2.0.0" } });
    const tags = { latest: "1.0.0", next: "2.0.0" };
    expect((await getJson(`${registry.url}-/package/@s%2fpkg/dist-tags`)).body).toEqual(tags);
    // The literal spelling is one path segment longer.
    expect((await getJson(`${registry.url}-/package/@s/pkg/dist-tags`)).body).toEqual(tags);
  });
});

describe("scoped packages", () => {
  test("the packument answers to both URL spellings and the tarball drops the scope", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("@scope/pkg", { "1.0.0": {} });

    const encoded = await getJson<Packument>(`${registry.url}@scope%2fpkg`);
    const literal = await getJson<Packument>(`${registry.url}@scope/pkg`);
    expect(encoded.status).toBe(200);
    expect(literal.body).toEqual(encoded.body);

    const tarball = encoded.body.versions["1.0.0"]!.dist.tarball;
    expect(tarball).toBe(`${registry.url}@scope/pkg/-/pkg-1.0.0.tgz`);
    const { files } = await readTarball(new Uint8Array(await (await fetch(tarball)).arrayBuffer()));
    expect(JSON.parse(Buffer.from(files["package.json"]!).toString()).name).toBe("@scope/pkg");
  });
});

describe("tarballs", () => {
  // Windows has no execute bit, so only POSIX can observe the mode the
  // tarball carried after a real extraction.
  test.skipIf(isWindows)("bin targets are executable after extraction", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("has-bin", {
      "1.0.0": { bin: { "has-bin": "cli.js" }, tarball: { "cli.js": "console.log(1);\n" } },
    });
    using dir = tempDir("npm-registry-bin", {});
    const url = (await registry.packument("has-bin"))!.versions["1.0.0"]!.dist.tarball;
    await new Bun.Archive(await (await fetch(url)).arrayBuffer()).extract(String(dir));
    expect(statSync(join(String(dir), "package", "cli.js")).mode & 0o111).not.toBe(0);
  });

  test("a version defined with `tarball: null` is listed but its tarball 404s", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0": { tarball: null } });
    const { body } = await getJson<Packument>(`${registry.url}pkg`);
    expect(body.versions["1.0.0"]!.dist).toEqual({ tarball: `${registry.url}pkg/-/pkg-1.0.0.tgz` });
    expect((await fetch(body.versions["1.0.0"]!.dist.tarball)).status).toBe(404);
  });

  test("a `dist` override makes the registry advertise what it does not serve", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("liar", { "1.0.0": { dist: { integrity: "sha512-bm9wZQ==" } } });
    const { body } = await getJson<Packument>(`${registry.url}liar`);
    const dist = body.versions["1.0.0"]!.dist;
    const served = new Uint8Array(await (await fetch(dist.tarball)).arrayBuffer());
    expect(dist.integrity).toBe("sha512-bm9wZQ==");
    expect(computeIntegrity(served).integrity).not.toBe(dist.integrity);
  });

  test("a filename for a version the registry never advertised 404s", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0": {} });
    expect((await fetch(`${registry.url}pkg/-/pkg-9.9.9.tgz`)).status).toBe(404);
    expect((await fetch(`${registry.url}pkg/-/evil.tgz`)).status).toBe(404);
  });

  test("a raw-bytes tarball that is a Buffer subarray serves exactly the view", async () => {
    // `Buffer.prototype.slice` is a view, not a copy; the tarball route
    // must serve the view's window, not its underlying pool.
    await using registry = await new NpmRegistry().start();
    const { bytes } = buildTarball({ "package.json": JSON.stringify({ name: "view", version: "1.0.0" }) });
    const pool = Buffer.alloc(bytes.length + 64, 0xab);
    pool.set(bytes, 32);
    const view = pool.subarray(32, 32 + bytes.length);
    registry.define("view", { "1.0.0": { tarball: view } });

    const dist = (await registry.packument("view"))!.versions["1.0.0"]!.dist;
    const served = new Uint8Array(await (await fetch(dist.tarball)).arrayBuffer());
    expect(served).toEqual(new Uint8Array(bytes));
    expect(computeIntegrity(served).integrity).toBe(dist.integrity);
  });
});

describe("fallback", () => {
  test("serves any name, each with its own correctly-named tarball", async () => {
    await using registry = await new NpmRegistry().start();
    registry.defineFallback({ "0.0.2": {}, "0.0.3": {} });

    for (const name of ["foo", "BaR", "@any/thing"]) {
      const { body } = await getJson<Packument>(`${registry.url}${encodeURIComponent(name)}`);
      expect(body.name).toBe(name);
      expect(body["dist-tags"]).toEqual({ latest: "0.0.3" });
      const served = new Uint8Array(await (await fetch(body.versions["0.0.2"]!.dist.tarball)).arrayBuffer());
      const { files } = await readTarball(served);
      expect(JSON.parse(Buffer.from(files["package.json"]!).toString())).toEqual({ name, version: "0.0.2" });
    }
  });

  test("an explicit definition and `remove` both beat the fallback", async () => {
    await using registry = await new NpmRegistry().start();
    registry.defineFallback({ "0.0.2": {} });
    registry.define("special", { "9.9.9": {} });
    registry.remove("gone");
    expect(Object.keys((await getJson<Packument>(`${registry.url}special`)).body.versions)).toEqual(["9.9.9"]);
    expect((await getJson(`${registry.url}gone`)).status).toBe(404);
    expect((await getJson(`${registry.url}anything-else`)).status).toBe(200);
  });

  test("a function fallback can decline", async () => {
    await using registry = await new NpmRegistry().start();
    registry.defineFallback(name => (name.startsWith("known-") ? { "1.0.0": {} } : undefined));
    expect((await getJson(`${registry.url}known-thing`)).status).toBe(200);
    expect((await getJson(`${registry.url}unknown-thing`)).status).toBe(404);
  });

  test("replacing the fallback forgets the names it materialized, but not defined or published ones", async () => {
    await using registry = await new NpmRegistry().start();
    registry.defineFallback({ "1.0.0": {} });
    registry.define("pinned", { "1.0.0": {} });
    const versions = async (name: string) =>
      Object.keys((await getJson<Packument>(`${registry.url}${name}`)).body.versions);
    // Fault `faulted` in from the first fallback, then change the fallback.
    expect(await versions("faulted")).toEqual(["1.0.0"]);
    registry.defineFallback({ "1.0.0": {}, "2.0.0": {} });
    expect(await versions("faulted")).toEqual(["1.0.0", "2.0.0"]);
    // An explicit definition is never a fallback's to forget.
    expect(await versions("pinned")).toEqual(["1.0.0"]);
  });
});

describe("observation", () => {
  test("records every request in order with its headers", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("@s/p", { "1.0.0": {} });
    await fetch(`${registry.url}@s%2fp`, { headers: { accept: CORGI } });
    await fetch((await registry.packument("@s/p"))!.versions["1.0.0"]!.dist.tarball);

    expect(registry.paths).toEqual(["/@s/p", "/@s/p/-/p-1.0.0.tgz"]);
    expect(registry.requestCount).toBe(2);
    expect(registry.requests[0]!.headers.get("accept")).toBe(CORGI);
    registry.clearRequests();
    expect(registry.requestCount).toBe(0);
  });

  test("simulateFailures fails each URL N times, then recovers", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0": {} });
    registry.simulateFailures({ timesPerUrl: 2, status: 503 });

    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await fetch(`${registry.url}pkg`)).status);
    expect(statuses).toEqual([503, 503, 200, 200]);
    // A different URL gets its own budget of failures.
    expect((await fetch(`${registry.url}pkg/-/pkg-1.0.0.tgz`)).status).toBe(503);
  });

  test("simulateFailures forwards extra headers given as a Headers instance", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0": {} });
    // A `Headers` instance has no own enumerable properties, so an
    // object spread would silently drop it.
    registry.simulateFailures({ timesPerUrl: 1, status: 429, headers: new Headers({ "retry-after": "7" }) });

    const first = await fetch(`${registry.url}pkg`);
    expect({
      status: first.status,
      "retry-after": first.headers.get("retry-after"),
      "content-type": first.headers.get("content-type"),
    }).toEqual({ status: 429, "retry-after": "7", "content-type": "application/json" });
    expect((await fetch(`${registry.url}pkg`)).status).toBe(200);
  });

  test("an interceptor can replace any response, and uninstalls cleanly", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("pkg", { "1.0.0": {} });
    const uninstall = registry.intercept(req =>
      new URL(req.url).pathname.endsWith(".tgz") ? new Response("gone", { status: 410 }) : undefined,
    );
    expect((await fetch(`${registry.url}pkg`)).status).toBe(200);
    expect((await fetch(`${registry.url}pkg/-/pkg-1.0.0.tgz`)).status).toBe(410);
    uninstall();
    expect((await fetch(`${registry.url}pkg/-/pkg-1.0.0.tgz`)).status).toBe(200);
  });

  test("an interceptor reading the body does not poison the route handler", async () => {
    // Each interceptor receives a clone, so its read does not consume the
    // stream the handler reads. Without cloning, `readJsonObject` catches
    // `Body already used` and launders it into a 400 "invalid JSON body".
    await using registry = await new NpmRegistry().start();
    registry.advisories.add({ module_name: "x", vulnerable_versions: "*", severity: "low", title: "t" });
    const seen: unknown[] = [];
    registry.intercept(async req => {
      if (req.method === "POST") seen.push(await req.json());
      return undefined;
    });
    registry.intercept(async req => {
      if (req.method === "POST") seen.push(await req.json());
      return undefined;
    });
    const { status, body } = await getJson(`${registry.url}-/npm/v1/security/advisories/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: ["1.0.0"] }),
    });
    expect({ status, hasResult: "x" in (body as object), seen }).toEqual({
      status: 200,
      hasResult: true,
      seen: [{ x: ["1.0.0"] }, { x: ["1.0.0"] }],
    });
  });
});

describe("auth", () => {
  const PROTECTED = { access: { "@secret/*": "authenticated" } } as const;

  test("an access rule 401s anonymous reads and admits a bearer token", async () => {
    await using registry = await new NpmRegistry(PROTECTED).start();
    registry.define("@secret/pkg", { "1.0.0": {} }).define("open", { "1.0.0": {} });
    const token = registry.addUser({ name: "alice", password: "pw" });

    expect((await getJson(`${registry.url}open`)).status).toBe(200);
    expect(await getJson(`${registry.url}@secret%2fpkg`)).toMatchObject({
      status: 401,
      body: { error: expect.stringContaining("unauthorized") },
    });
    const authed = await getJson(`${registry.url}@secret%2fpkg`, { headers: { authorization: `Bearer ${token}` } });
    expect(authed.status).toBe(200);
    // The tarball is behind the same rule.
    expect((await fetch(`${registry.url}@secret/pkg/-/pkg-1.0.0.tgz`)).status).toBe(401);
  });

  test("Basic credentials work and a bad token is rejected, not treated as anonymous", async () => {
    await using registry = await new NpmRegistry(PROTECTED).start();
    registry.define("@secret/pkg", { "1.0.0": {} });
    registry.addUser({ name: "alice", password: "pw" });

    const basic = Buffer.from("alice:pw").toString("base64");
    expect((await fetch(`${registry.url}@secret%2fpkg`, { headers: { authorization: `Basic ${basic}` } })).status).toBe(
      200,
    );
    expect(await getJson(`${registry.url}@secret%2fpkg`, { headers: { authorization: "Bearer bogus" } })).toMatchObject(
      { status: 401, body: { error: "unauthorized: invalid bearer token" } },
    );
  });

  test("PUT /-/user/org.couchdb.user:<name> creates a user and logs one in", async () => {
    await using registry = await new NpmRegistry().start();
    const login = (password: string) =>
      getJson<{ token?: string; error?: string }>(`${registry.url}-/user/org.couchdb.user:carol`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "carol", password, email: "c@example.com" }),
      });

    const created = await login("pw");
    expect(created.status).toBe(201);
    expect(created.body.token).toStartWith("npm_");

    const whoami = await getJson(`${registry.url}-/whoami`, {
      headers: { authorization: `Bearer ${created.body.token}` },
    });
    expect(whoami.body).toEqual({ username: "carol" });

    expect((await login("pw")).status).toBe(201);
    expect(await login("wrong")).toMatchObject({ status: 401, body: { error: "unauthorized: incorrect password" } });
  });

  test("/-/whoami without credentials is a 401", async () => {
    await using registry = await new NpmRegistry().start();
    expect((await fetch(`${registry.url}-/whoami`)).status).toBe(401);
  });
});

describe("publish", () => {
  /** A minimal but real `npm publish` PUT body for `name@version`. */
  function publishBody(name: string, version: string, files: Record<string, string> = {}) {
    const manifest = { name, version, description: "published" };
    const { bytes } = buildTarball({ "package.json": JSON.stringify(manifest), ...files });
    const basename = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
    return {
      _id: name,
      name,
      "dist-tags": { latest: version },
      versions: { [version]: { ...manifest, dist: { integrity: computeIntegrity(bytes).integrity } } },
      _attachments: {
        [`${basename}-${version}.tgz`]: {
          content_type: "application/octet-stream",
          data: Buffer.from(bytes).toBase64(),
          length: bytes.length,
        },
      },
    };
  }

  function put(registry: NpmRegistry, name: string, body: unknown, headers: Record<string, string> = {}) {
    return getJson<{ ok?: unknown; error?: string }>(`${registry.url}${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  test("a published version is immediately installable and round-trips its files", async () => {
    await using registry = await new NpmRegistry().start();
    const { status } = await put(registry, "fresh", publishBody("fresh", "1.0.0", { "lib.js": "42\n" }));
    expect(status).toBe(201);

    const packument = (await registry.packument("fresh"))!;
    expect(packument["dist-tags"]).toEqual({ latest: "1.0.0" });
    expect(packument.versions["1.0.0"]).toMatchObject({ description: "published" });
    const served = new Uint8Array(await (await fetch(packument.versions["1.0.0"]!.dist.tarball)).arrayBuffer());
    expect(computeIntegrity(served).integrity).toBe(packument.versions["1.0.0"]!.dist.integrity);
    expect(Object.keys((await readTarball(served)).files).sort()).toEqual(["lib.js", "package.json"]);
  });

  test("publishing over an existing version is a 403 with npm's message", async () => {
    await using registry = await new NpmRegistry().start();
    expect((await put(registry, "dup", publishBody("dup", "1.0.0"))).status).toBe(201);
    expect(await put(registry, "dup", publishBody("dup", "1.0.0"))).toEqual({
      status: 403,
      body: { error: "You cannot publish over the previously published versions: 1.0.0." },
      headers: expect.anything(),
    });
    // A fixture-less failure must not have created a second version.
    expect(Object.keys((await registry.packument("dup"))!.versions)).toEqual(["1.0.0"]);
  });

  test("publishing a new version of a fixture-backed package never mutates the shared fixture", async () => {
    using fixtures = tempDir("npm-registry-publish-fixture", {
      "base/1.0.0/package.json": JSON.stringify({ name: "base", version: "1.0.0" }),
    });
    await using a = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    await using b = await new NpmRegistry({ fixtures: String(fixtures) }).start();

    expect((await put(a, "base", publishBody("base", "2.0.0"))).status).toBe(201);
    expect(Object.keys((await a.packument("base"))!.versions)).toEqual(["1.0.0", "2.0.0"]);
    expect(Object.keys((await b.packument("base"))!.versions)).toEqual(["1.0.0"]);
  });

  test("an attachment whose bytes do not match the declared integrity is rejected", async () => {
    await using registry = await new NpmRegistry().start();
    const body = publishBody("tamper", "1.0.0");
    (body.versions["1.0.0"]!.dist as { integrity: string }).integrity = "sha512-bm90IHJlYWxseQ==";
    expect(await put(registry, "tamper", body)).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining("integrity mismatch") },
    });
    expect(await registry.packument("tamper")).toBeUndefined();
  });

  test("a declared integrity in any W3C SRI form that proves the bytes is accepted", async () => {
    // `dist.integrity` is SRI §3.3 (whitespace-separated list, optional
    // padding), so the gate must parse it like ssri.checkData would,
    // not compare by spelling. Covers sha384, sha512 without padding,
    // and a multi-hash string with a leading wrong token.
    await using registry = await new NpmRegistry().start();
    const make = (name: string, integrity: string) => {
      const body = publishBody(name, "1.0.0");
      (body.versions["1.0.0"]!.dist as { integrity: string }).integrity = integrity;
      return body;
    };
    const attached = (body: ReturnType<typeof publishBody>) =>
      Buffer.from(Object.values(body._attachments)[0]!.data, "base64");
    const b64 = (h: Bun.CryptoHasher) => Buffer.from(h.digest()).toString("base64");

    const b1 = make("sri-384", `sha384-${b64(new Bun.SHA384().update(attached(make("sri-384", ""))))}`);
    expect((await put(registry, "sri-384", b1)).status).toBe(201);

    const b2 = make("sri-nopad", computeIntegrity(attached(make("sri-nopad", ""))).integrity.replace(/=+$/, ""));
    expect((await put(registry, "sri-nopad", b2)).status).toBe(201);

    const correct = computeIntegrity(attached(make("sri-multi", ""))).integrity;
    const b3 = make("sri-multi", `sha512-WRONG== ${correct}`);
    expect((await put(registry, "sri-multi", b3)).status).toBe(201);

    // Only the strongest recognized algorithm counts (SRI §3.3.4,
    // `ssri.pickAlgorithm`): a correct sha256 cannot cover a wrong sha512.
    const sha256 = `sha256-${b64(new Bun.SHA256().update(attached(make("sri-bad", ""))))}`;
    const b4 = make("sri-bad", `${sha256} sha512-WRONG==`);
    expect((await put(registry, "sri-bad", b4)).status).toBe(400);
    expect(await registry.packument("sri-bad")).toBeUndefined();

    // The registry serves its own sha512 regardless of what the client sent.
    for (const n of ["sri-384", "sri-nopad", "sri-multi"]) {
      expect((await registry.packument(n))!.versions["1.0.0"]!.dist.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    }
  });

  test("a metadata-only PUT on a name the registry has never seen is a 404", async () => {
    // The shape `npm deprecate` sends: no _attachments, just a mutated
    // packument. On an unknown name that is a 404, like the sibling
    // write handlers; it must not commit a fresh empty record.
    await using registry = await new NpmRegistry().start();
    const body = { name: "never", versions: { "1.0.0": { name: "never", version: "1.0.0", deprecated: "x" } } };
    expect((await put(registry, "never", body)).status).toBe(404);
    expect(await registry.packument("never")).toBeUndefined();
    // Once the package exists the same body is a 201 that applies.
    registry.define("never", { "1.0.0": {} });
    expect((await put(registry, "never", body)).status).toBe(201);
    expect((await registry.packument("never"))!.versions["1.0.0"]!.deprecated).toBe("x");
  });

  test("scoped publish, with access rules and a bearer token", async () => {
    await using registry = await new NpmRegistry({ access: { "@secret/*": "authenticated" } }).start();
    const token = registry.addUser({ name: "alice", password: "pw" });
    const body = publishBody("@secret/pkg", "1.0.0");
    expect((await put(registry, "@secret/pkg", body)).status).toBe(401);
    expect((await put(registry, "@secret/pkg", body, { authorization: `Bearer ${token}` })).status).toBe(201);
  });

  test("a scoped publish answers to both URL spellings", async () => {
    await using registry = await new NpmRegistry().start();
    const publishTo = (url: string, name: string) =>
      fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(publishBody(name, "1.0.0")),
      });
    expect((await publishTo(`${registry.url}@s%2fenc`, "@s/enc")).status).toBe(201);
    // The literal spelling is two path segments.
    expect((await publishTo(`${registry.url}@s/lit`, "@s/lit")).status).toBe(201);
    expect(Object.keys((await registry.packument("@s/lit"))!.versions)).toEqual(["1.0.0"]);
  });

  test("publish is 415 unless Content-Type is exactly application/json", async () => {
    // verdaccio's media() middleware is a raw `!==` on the header; two
    // comments in src/runtime/cli/publish_command.rs cite it. This gate
    // is what keeps them enforced.
    await using registry = await new NpmRegistry().start();
    const body = JSON.stringify(publishBody("p", "1.0.0"));
    const send = (headers: Record<string, string>) =>
      getJson<{ error?: string }>(`${registry.url}p`, { method: "PUT", headers, body });
    const expected = { status: 415, body: { error: expect.stringContaining("application/json") } };
    expect(await send({ "content-type": "text/plain" })).toMatchObject(expected);
    expect(await send({ "content-type": "application/json; charset=utf-8" })).toMatchObject(expected);
    expect(await send({})).toMatchObject(expected);
    expect((await send({ "content-type": "application/json" })).status).toBe(201);
    // Not enforced where npm doesn't: adduser and the bulk advisories.
    const adduser = await getJson(`${registry.url}-/user/org.couchdb.user:u`, {
      method: "PUT",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name: "u", password: "p" }),
    });
    expect(adduser.status).toBe(201);
  });

  test("a deprecate (a PUT with no attachments) updates the stored version", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("old", { "1.0.0": {}, "2.0.0": {} });
    const packument = (await registry.packument("old"))!;
    packument.versions["1.0.0"]!.deprecated = "use 2.x";
    expect((await put(registry, "old", { ...packument, _attachments: undefined })).status).toBe(201);

    const after = (await registry.packument("old"))!;
    expect(after.versions["1.0.0"]!.deprecated).toBe("use 2.x");
    expect(after.versions["2.0.0"]!.deprecated).toBeUndefined();
  });

  test("unpublishing a scoped package answers to both URL spellings", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("@s/a", { "1.0.0": {} }).define("@s/b", { "1.0.0": {} });

    expect((await fetch(`${registry.url}@s%2fa/-rev/1-x`, { method: "DELETE" })).status).toBe(200);
    expect((await getJson(`${registry.url}@s%2fa`)).status).toBe(404);
    // The literal spelling is one path segment longer.
    expect((await fetch(`${registry.url}@s/b/-rev/1-x`, { method: "DELETE" })).status).toBe(200);
    expect((await getJson(`${registry.url}@s%2fb`)).status).toBe(404);
  });
});

describe("otp", () => {
  /** A PUT to `/p` by `token`, optionally carrying an `npm-otp` header. */
  const attempt = (registry: NpmRegistry, token: string, extra: Record<string, string> = {}) =>
    fetch(`${registry.url}p`, {
      method: "PUT",
      headers: { "content-type": "application/json", "authorization": `Bearer ${token}`, ...extra },
      body: JSON.stringify({ name: "p", "dist-tags": { latest: "1.0.0" }, versions: {} }),
    });

  test("a write by a 2FA user without npm-otp gets npm's OTP challenge, and succeeds with it", async () => {
    await using registry = await new NpmRegistry().start();
    // `attempt` sends a metadata-only PUT, which updates an existing
    // package; the OTP gate fires before the body is parsed either way.
    registry.define("p", { "1.0.0": {} });
    const token = registry.addUser({ name: "two-fa", password: "pw", otp: "123456" });

    const challenged = await attempt(registry, token);
    expect(challenged.status).toBe(401);
    expect(challenged.headers.get("www-authenticate")).toBe("OTP");
    const body = (await challenged.json()) as { error: string; authUrl: string; doneUrl: string };
    // The exact message is part of npm's protocol: clients match it
    // verbatim to distinguish "missing OTP" from "invalid OTP".
    expect(body.error).toBe(OTP_REQUIRED_MESSAGE);

    expect((await attempt(registry, token, { "npm-otp": "000000" })).status).toBe(401);
    expect((await attempt(registry, token, { "npm-otp": "123456" })).status).toBe(201);
  });

  test("the challenge carries the web-auth flow, and its doneUrl hands back a valid OTP", async () => {
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "web", password: "pw", otp: "424242" });

    const { authUrl, doneUrl } = (await (await attempt(registry, token)).json()) as Record<string, string>;
    expect(authUrl).toStartWith(`${registry.url}-/auth/web/`);
    expect(doneUrl).toStartWith(`${registry.url}-/auth/done/`);
    expect(await (await fetch(doneUrl)).json()).toEqual({ token: "424242" });
    expect((await fetch(`${registry.url}-/auth/done/nope`)).status).toBe(404);
    // The client is expected to show authUrl to a human, never fetch it.
    expect(registry.paths).not.toContain(new URL(authUrl).pathname);
  });

  test("otpChallenge is mutable and shapes the 401 for the web-auth and cached-response edge cases", async () => {
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "u", password: "pw", otp: "1" });
    registry.otpChallenge = {
      wwwAuthenticate: false,
      webAuth: false,
      notice: `visit ${registry.url}auth to login`,
      xLocalCache: true,
    };
    const response = await attempt(registry, token);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("npm-notice")).toBe(`visit ${registry.url}auth to login`);
    expect(response.headers.get("x-local-cache")).not.toBeNull();
    expect((await response.json()) as object).toEqual({ error: OTP_REQUIRED_MESSAGE });
  });

  test("acceptOtp: false re-challenges even a correct code, like an expired one", async () => {
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "expired", password: "pw", otp: "7" });
    registry.otpChallenge = { acceptOtp: false };
    const response = await attempt(registry, token, { "npm-otp": "7" });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toBe(OTP_REQUIRED_MESSAGE);
  });

  test("the challenge covers every destructive write, not just publish", async () => {
    // registry.npmjs.org 401-challenges the second factor on every
    // write to a 2FA-protected package (publish, unpublish, deprecate);
    // the library's own authorizeOtp docstring says it "enforces the
    // second factor for a write". The -rev routes are writes.
    await using registry = await new NpmRegistry().start();
    registry.define("p", { "1.0.0": {}, "2.0.0": {} });
    const token = registry.addUser({ name: "two-fa", password: "pw", otp: "123456" });
    const headers = (otp?: string) => ({
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      ...(otp !== undefined ? { "npm-otp": otp } : {}),
    });

    const versions = async () => Object.keys((await registry.packument("p"))?.versions ?? {}).sort();

    // DELETE /:name/-rev/:rev — unpublish the whole package.
    const unpublish = await fetch(`${registry.url}p/-rev/1-x`, { method: "DELETE", headers: headers() });
    expect(unpublish.status).toBe(401);
    expect(unpublish.headers.get("www-authenticate")).toBe("OTP");
    expect(await versions()).toEqual(["1.0.0", "2.0.0"]);

    // PUT /:name/-rev/:rev — drop one version (npm unpublish pkg@v).
    const body = JSON.stringify({ name: "p", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } });
    const drop = await fetch(`${registry.url}p/-rev/1-x`, { method: "PUT", headers: headers(), body });
    expect(drop.status).toBe(401);
    expect(drop.headers.get("www-authenticate")).toBe("OTP");
    expect(await versions()).toEqual(["1.0.0", "2.0.0"]);

    // Both succeed with the OTP: the state change happens now, not above.
    expect((await fetch(`${registry.url}p/-rev/1-x`, { method: "PUT", headers: headers("123456"), body })).status).toBe(
      201,
    );
    expect(await versions()).toEqual(["1.0.0"]);
    expect((await fetch(`${registry.url}p/-rev/1-x`, { method: "DELETE", headers: headers("123456") })).status).toBe(
      200,
    );
    expect(await versions()).toEqual([]);
  });
});

describe("fixtures", () => {
  test("a directory fixture is packed, hashed, and served like any other package", async () => {
    using fixtures = tempDir("npm-registry-fixture-dir", {
      "thing/1.0.0/package.json": JSON.stringify({ name: "thing", version: "1.0.0", bin: { thing: "cli.js" } }),
      "thing/1.0.0/cli.js": "console.log('v1');\n",
      "thing/2.0.0/package.json": JSON.stringify({ name: "thing", version: "2.0.0" }),
      "@scope/deep/1.0.0/package.json": JSON.stringify({ name: "@scope/deep", version: "1.0.0" }),
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();

    expect(registry.names).toEqual(["@scope/deep", "thing"]);
    const packument = (await registry.packument("thing"))!;
    expect(Object.keys(packument.versions)).toEqual(["1.0.0", "2.0.0"]);
    expect(packument["dist-tags"]).toEqual({ latest: "2.0.0" });

    const { files } = await readTarball(
      new Uint8Array(await (await fetch(packument.versions["1.0.0"]!.dist.tarball)).arrayBuffer()),
    );
    expect(Object.keys(files).sort()).toEqual(["cli.js", "package.json"]);
  });

  test("a prebuilt .tgz fixture's manifest and integrity come from the tarball itself", async () => {
    const manifest = { name: "pre", version: "3.2.1", dependencies: { thing: "^1.0.0" } };
    const { bytes } = buildTarball({ "package.json": JSON.stringify(manifest) });
    using fixtures = tempDir("npm-registry-fixture-tgz", { "pre/pre-3.2.1.tgz": bytes });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();

    const version = (await registry.packument("pre"))!.versions["3.2.1"]!;
    expect(version).toMatchObject({ name: "pre", version: "3.2.1", dependencies: { thing: "^1.0.0" } });
    expect(version.dist.integrity).toBe(computeIntegrity(bytes).integrity);
    expect(new Uint8Array(await (await fetch(version.dist.tarball)).arrayBuffer())).toEqual(bytes);
  });

  test("_registry.json supplies the metadata a package.json cannot", async () => {
    using fixtures = tempDir("npm-registry-fixture-meta", {
      "tagged/1.0.0/package.json": JSON.stringify({ name: "tagged", version: "1.0.0" }),
      "tagged/2.0.0/package.json": JSON.stringify({ name: "tagged", version: "2.0.0" }),
      "tagged/_registry.json": JSON.stringify({ "dist-tags": { latest: "1.0.0", next: "2.0.0" }, description: "d" }),
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    const packument = (await registry.packument("tagged"))!;
    expect(packument["dist-tags"]).toEqual({ latest: "1.0.0", next: "2.0.0" });
    expect(packument.description).toBe("d");
  });

  test("_registry.json can mark a file executable that no `bin` points at", async () => {
    // `binModeMap` only marks a package's own bin targets; the on-disk 0755 bit
    // is unreadable on Windows. A bin target owned by another package needs this.
    using fixtures = tempDir("npm-registry-fixture-exec", {
      "tgt/1.0.0/package.json": JSON.stringify({ name: "tgt", version: "1.0.0" }),
      "tgt/1.0.0/cmd": "#!/usr/bin/env node\n",
      "tgt/_registry.json": JSON.stringify({ executable: { "1.0.0": ["cmd"] } }),
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    const packument = (await registry.packument("tgt"))!;
    const tgz = new Uint8Array(await (await fetch((packument as any).versions["1.0.0"].dist.tarball)).arrayBuffer());
    const tar = Bun.gunzipSync(tgz);
    const modes: Record<string, string> = {};
    for (let off = 0; off + 512 <= tar.length && tar[off]; ) {
      const name = Buffer.from(tar.subarray(off, off + 100))
        .toString()
        .replace(/\0.*/, "");
      const size =
        parseInt(
          Buffer.from(tar.subarray(off + 124, off + 136))
            .toString()
            .replace(/[\0 ]/g, ""),
          8,
        ) || 0;
      modes[name] = Buffer.from(tar.subarray(off + 100, off + 106)).toString();
      off += 512 + Math.ceil(size / 512) * 512;
    }
    expect(modes).toEqual({ "package/cmd": "000755", "package/package.json": "000644" });
    // `_registry.json`'s `executable` must not leak into the packument.
    expect((packument as any).executable).toBeUndefined();
  });

  test("a version whose tarball bytes are not an archive still serves a packument", async () => {
    await using registry = await new NpmRegistry().start();
    registry.define("corrupt", { "1.0.0": { tarball: new TextEncoder().encode("not a tarball") } });
    const { status, body } = await getJson<any>(`${registry.url}corrupt`);
    expect({ status, integrity: typeof body.versions["1.0.0"].dist.integrity }).toEqual({
      status: 200,
      integrity: "string",
    });
  });

  test("_registry.json rejects an executable version that is not a directory fixture", async () => {
    using fixtures = tempDir("npm-registry-exec-tgz", {
      "tgt/1.0.0/package.json": JSON.stringify({ name: "tgt", version: "1.0.0" }),
      "tgt/_registry.json": JSON.stringify({ executable: { "9.9.9": ["cmd"] } }),
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    expect(await getJson(`${registry.url}tgt`)).toMatchObject({
      status: 500,
      body: { error: expect.stringContaining("is not a directory fixture") },
    });
    expect(registry.takeHandlerErrors()).toHaveLength(1);
  });

  test("_registry.json rejects an executable path that does not exist", async () => {
    using fixtures = tempDir("npm-registry-fixture-exec-missing", {
      "tgt/1.0.0/package.json": JSON.stringify({ name: "tgt", version: "1.0.0" }),
      "tgt/_registry.json": JSON.stringify({ executable: { "1.0.0": ["nope"] } }),
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    expect(await getJson(`${registry.url}tgt`)).toMatchObject({
      status: 500,
      body: { error: expect.stringContaining("marks a missing file executable") },
    });
    expect(registry.takeHandlerErrors()).toHaveLength(1);
  });

  test("a version directory may omit the package.json's semver build metadata", async () => {
    // semver §10: build metadata is not part of a version's identity, and
    // a registry keys the packument without it. `1.0.0+123` lives in `1.0.0/`.
    using fixtures = tempDir("npm-registry-fixture-build-meta", {
      "meta/1.0.0/package.json": JSON.stringify({ name: "meta", version: "1.0.0+123" }),
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    const { status, body } = await getJson<any>(`${registry.url}meta`);
    expect({ status, versions: Object.keys(body.versions), tags: body["dist-tags"] }).toEqual({
      status: 200,
      versions: ["1.0.0"],
      tags: { latest: "1.0.0" },
    });
  });

  test("a fixture whose location and package.json disagree fails loudly", async () => {
    using fixtures = tempDir("npm-registry-fixture-bad", {
      "liar/1.0.0/package.json": JSON.stringify({ name: "liar", version: "9.9.9" }),
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    expect(await getJson(`${registry.url}liar`)).toMatchObject({ status: 500, body: { error: expect.any(String) } });
    expect(registry.takeHandlerErrors()).toHaveLength(1);
  });

  test("a version defined by both a .tgz and a directory fails loudly", async () => {
    // `readdirSync` order is filesystem-defined, so this must be
    // rejected no matter which of the two forms is enumerated first.
    using fixtures = tempDir("npm-registry-fixture-dup", {
      "twice/1.0.0/package.json": JSON.stringify({ name: "twice", version: "1.0.0" }),
      "twice/twice-1.0.0.tgz": buildTarball({ "package.json": JSON.stringify({ name: "twice", version: "1.0.0" }) })
        .bytes,
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    expect(await getJson(`${registry.url}twice`)).toMatchObject({
      status: 500,
      body: { error: expect.stringContaining("version 1.0.0 is defined by both a .tgz and a directory") },
    });
    expect(registry.takeHandlerErrors()).toHaveLength(1);
  });

  // Windows checks a committed symlink out as a regular file
  // (`core.symlinks=false`), so there the entry *is* a pure function of
  // committed bytes and the test cannot be staged.
  test.skipIf(isWindows)("a symlink in a directory fixture fails loudly instead of being skipped", async () => {
    using fixtures = tempDir("npm-registry-fixture-symlink", {
      "linked/1.0.0/package.json": JSON.stringify({ name: "linked", version: "1.0.0" }),
      "linked/1.0.0/real.js": "module.exports = 1;\n",
    });
    symlinkSync("real.js", join(String(fixtures), "linked", "1.0.0", "alias.js"));
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    // Before the guard this request succeeded and the packed tarball
    // simply omitted `alias.js`, which is exactly the per-platform
    // divergence the loud failure exists to prevent.
    expect(await getJson(`${registry.url}linked`)).toMatchObject({
      status: 500,
      body: { error: expect.stringContaining("only regular files and directories") },
    });
    expect(registry.takeHandlerErrors()).toHaveLength(1);
  });
});

describe("conditional requests after a metadata write", () => {
  test("a fresh publish's Last-Modified is its version's time, and time.created is set", async () => {
    // A publish whose wall-clock version time advances on its own takes that
    // time, not the monotonicity floor, so `Last-Modified` is not pushed into
    // the future (RFC 9110 8.8.2.1). `time.created` is set at first publish.
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "u", password: "p" });
    const tgz = Buffer.from(buildTarball({ "package.json": '{"name":"fresh","version":"1.0.0"}' }).bytes).toString(
      "base64",
    );
    const res = await fetch(`${registry.url}fresh`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        _id: "fresh",
        name: "fresh",
        versions: { "1.0.0": { name: "fresh", version: "1.0.0" } },
        _attachments: {
          "fresh-1.0.0.tgz": { content_type: "application/octet-stream", data: tgz, length: tgz.length },
        },
      }),
    });
    expect(res.status).toBe(201);

    const time = ((await (await fetch(`${registry.url}fresh`)).json()) as { time: Record<string, string> }).time;
    // `modified` is the version's wall-clock time, not `version + step`; a
    // second publish does not move `created`.
    expect({ created: time.created, modified: time.modified }).toEqual({
      created: time["1.0.0"],
      modified: time["1.0.0"],
    });

    const tgz2 = Buffer.from(buildTarball({ "package.json": '{"name":"fresh","version":"2.0.0"}' }).bytes).toString(
      "base64",
    );
    await fetch(`${registry.url}fresh`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        _id: "fresh",
        name: "fresh",
        versions: { "2.0.0": { name: "fresh", version: "2.0.0" } },
        _attachments: {
          "fresh-2.0.0.tgz": { content_type: "application/octet-stream", data: tgz2, length: tgz2.length },
        },
      }),
    });
    const time2 = ((await (await fetch(`${registry.url}fresh`)).json()) as { time: Record<string, string> }).time;
    expect(time2.created).toBe(time["1.0.0"]);
  });

  test("publishing a lower version does not shift existing versions' implicit publish times", async () => {
    // A version without an explicit time derives it from its semver index,
    // so inserting 0.5.0 would otherwise move 1.0.0 from EPOCH to EPOCH+1.
    // `#write` primes every version's time from the pre-mutation record.
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "u", password: "p" });
    registry.define("shift", { "1.0.0": {}, "2.0.0": {} });
    const readTime = async () =>
      ((await (await fetch(`${registry.url}shift`)).json()) as { time: Record<string, string> }).time;
    const before = await readTime();
    const tgz = Buffer.from(buildTarball({ "package.json": '{"name":"shift","version":"0.5.0"}' }).bytes).toString(
      "base64",
    );
    const res = await fetch(`${registry.url}shift`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        _id: "shift",
        name: "shift",
        versions: { "0.5.0": { name: "shift", version: "0.5.0" } },
        _attachments: {
          "shift-0.5.0.tgz": { content_type: "application/octet-stream", data: tgz, length: tgz.length },
        },
      }),
    });
    expect(res.status).toBe(201);
    const after = await readTime();
    // `0.5.0` proves the write landed; a rejected PUT would leave the record
    // unmutated and satisfy the unchanged-form assertion vacuously.
    expect({ "0.5.0": typeof after["0.5.0"], "1.0.0": after["1.0.0"], "2.0.0": after["2.0.0"] }).toEqual({
      "0.5.0": "string",
      "1.0.0": before["1.0.0"],
      "2.0.0": before["2.0.0"],
    });
  });

  test("publishing to a define()'d record keeps time.created at the value the client observed", async () => {
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "u", password: "p" });
    registry.define("prior", { "1.0.0": {} });
    const readTime = async () =>
      ((await (await fetch(`${registry.url}prior`)).json()) as { time: Record<string, string> }).time;
    const before = await readTime();
    const tgz = Buffer.from(buildTarball({ "package.json": '{"name":"prior","version":"2.0.0"}' }).bytes).toString(
      "base64",
    );
    const res = await fetch(`${registry.url}prior`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        _id: "prior",
        name: "prior",
        versions: { "2.0.0": { name: "prior", version: "2.0.0" } },
        _attachments: {
          "prior-2.0.0.tgz": { content_type: "application/octet-stream", data: tgz, length: tgz.length },
        },
      }),
    });
    expect(res.status).toBe(201);
    const after = await readTime();
    expect({ createdBefore: before.created, createdAfter: after.created, "2.0.0": typeof after["2.0.0"] }).toEqual({
      createdBefore: "1985-10-26T08:15:00.000Z",
      createdAfter: "1985-10-26T08:15:00.000Z",
      "2.0.0": "string",
    });
  });

  test("deprecate advances last-modified, so If-Modified-Since does not 304 a changed document", async () => {
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "u", password: "p" });
    registry.define("dep", { "1.0.0": {}, "2.0.0": {} });
    const head = async () => {
      const r = await fetch(`${registry.url}dep`);
      return { lastModified: r.headers.get("last-modified")!, etag: r.headers.get("etag")! };
    };
    const before = await head();

    const res = await fetch(`${registry.url}dep`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        _id: "dep",
        name: "dep",
        versions: {
          "1.0.0": { name: "dep", version: "1.0.0", deprecated: "old" },
          "2.0.0": { name: "dep", version: "2.0.0" },
        },
      }),
    });
    expect(res.status).toBe(201);

    const after = await head();
    expect({ lastModifiedMoved: after.lastModified !== before.lastModified, etagMoved: after.etag !== before.etag }) //
      .toEqual({ lastModifiedMoved: true, etagMoved: true });

    const stale = await fetch(`${registry.url}dep`, { headers: { "if-modified-since": before.lastModified } });
    expect(stale.status).toBe(200);
  });

  test("last-modified never goes backwards when a publish follows a metadata write", async () => {
    // A publish stamps a wall-clock version time, so it can land *before* the
    // step a preceding deprecate added.
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "u", password: "p" });
    registry.define("mono", { "1.0.0": {} });
    const modified = async () => Date.parse((await fetch(`${registry.url}mono`)).headers.get("last-modified")!);
    const put = (body: unknown) =>
      fetch(`${registry.url}mono`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    const first = await modified();
    await put({
      _id: "mono",
      name: "mono",
      versions: { "1.0.0": { name: "mono", version: "1.0.0", deprecated: "x" } },
    });
    const afterDeprecate = await modified();

    const tgz = Buffer.from(buildTarball({ "package.json": '{"name":"mono","version":"2.0.0"}' }).bytes).toString(
      "base64",
    );
    const res = await put({
      _id: "mono",
      name: "mono",
      versions: { "2.0.0": { name: "mono", version: "2.0.0" } },
      _attachments: { "mono-2.0.0.tgz": { content_type: "application/octet-stream", data: tgz, length: tgz.length } },
    });
    expect(res.status).toBe(201);
    const afterPublish = await modified();

    expect({ deprecateAdvanced: afterDeprecate > first, publishAdvanced: afterPublish > afterDeprecate }) //
      .toEqual({ deprecateAdvanced: true, publishAdvanced: true });
  });

  test("a publish landing within a step of a prior metadata write still advances last-modified", async () => {
    // All three writes happen within one VERSION_TIME_STEP, so the second
    // publish's wall-clock version time is earlier than the deprecate's step.
    // The clamp must step past the previous value, not merely hold it, or
    // `If-Modified-Since` answers 304 for a body that gained a version.
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "u", password: "p" });
    const lm = async () => (await fetch(`${registry.url}near`)).headers.get("last-modified")!;
    const put = (body: unknown) =>
      fetch(`${registry.url}near`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    const tgz = (v: string) =>
      Buffer.from(buildTarball({ "package.json": JSON.stringify({ name: "near", version: v }) }).bytes).toString(
        "base64",
      );

    await put({
      _id: "near",
      name: "near",
      versions: { "1.0.0": { name: "near", version: "1.0.0" } },
      _attachments: { "near-1.0.0.tgz": { content_type: "application/octet-stream", data: tgz("1.0.0"), length: 1 } },
    });
    await put({
      _id: "near",
      name: "near",
      versions: { "1.0.0": { name: "near", version: "1.0.0", deprecated: "x" } },
    });
    const afterDeprecate = await lm();
    await put({
      _id: "near",
      name: "near",
      versions: { "2.0.0": { name: "near", version: "2.0.0" } },
      _attachments: { "near-2.0.0.tgz": { content_type: "application/octet-stream", data: tgz("2.0.0"), length: 1 } },
    });
    const afterPublish = await lm();

    const stale = await fetch(`${registry.url}near`, { headers: { "if-modified-since": afterDeprecate } });
    expect({ advanced: Date.parse(afterPublish) > Date.parse(afterDeprecate), staleStatus: stale.status }) //
      .toEqual({ advanced: true, staleStatus: 200 });
  });

  test("the first unpublish on a defined record advances last-modified, not derives it from survivors", async () => {
    // `record.time.modified` is unset on a define()'d record until the first
    // write. The clamp must see the value the client observed (primed from the
    // pre-mutation record), not recompute it from the already-shrunk set.
    await using registry = await new NpmRegistry().start();
    const token = registry.addUser({ name: "u", password: "p" });
    registry.define("shrink", { "1.0.0": {}, "2.0.0": {}, "3.0.0": {} });
    const lm = async () => (await fetch(`${registry.url}shrink`)).headers.get("last-modified")!;
    const before = await lm();
    const rev = ((await (await fetch(`${registry.url}shrink`)).json()) as { _rev: string })._rev;

    const res = await fetch(`${registry.url}shrink/-rev/${rev}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        _id: "shrink",
        name: "shrink",
        _rev: rev,
        versions: { "1.0.0": { name: "shrink", version: "1.0.0" } },
      }),
    });
    expect(res.status).toBe(201);
    const after = await lm();

    const stale = await fetch(`${registry.url}shrink`, { headers: { "if-modified-since": before } });
    expect({ advanced: Date.parse(after) > Date.parse(before), staleStatus: stale.status }) //
      .toEqual({ advanced: true, staleStatus: 200 });
  });

  test("an unparseable explicit per-version time falls back to the deterministic slot", async () => {
    // The sibling of `modified`: per-version keys reach `.toISOString()` on the
    // read path, so `Date.parse("whenever") = NaN` would throw `RangeError:
    // Invalid Date` and 500 every packument request.
    await using registry = await new NpmRegistry().start();
    registry.define("badver", { "1.0.0": {}, "2.0.0": {} }, { time: { "1.0.0": "whenever" } });
    const { status, body } = await getJson<{ time: Record<string, string> }>(`${registry.url}badver`);
    expect({ status, time: body.time }).toEqual({
      status: 200,
      time: {
        "1.0.0": "1985-10-26T08:15:00.000Z",
        "2.0.0": "1985-10-26T08:16:00.000Z",
        "created": "1985-10-26T08:15:00.000Z",
        "modified": "1985-10-26T08:16:00.000Z",
      },
    });
  });

  test("an unparseable explicit time.modified does not throw the write path", async () => {
    using fixtures = tempDir("npm-registry-bad-time", {
      "t/1.0.0/package.json": JSON.stringify({ name: "t", version: "1.0.0" }),
      "t/_registry.json": JSON.stringify({ time: { modified: "whenever" } }),
    });
    await using registry = await new NpmRegistry({ fixtures: String(fixtures) }).start();
    const token = registry.addUser({ name: "u", password: "p" });
    const res = await fetch(`${registry.url}t`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        _id: "t",
        name: "t",
        versions: { "1.0.0": { name: "t", version: "1.0.0", deprecated: "x" } },
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe("audit", () => {
  test("the bulk endpoint returns only advisories whose range matches a requested version", async () => {
    await using registry = await new NpmRegistry().start();
    registry.advisories.add({
      module_name: "lodash",
      vulnerable_versions: "<4.17.21",
      severity: "high",
      title: "Prototype Pollution",
    });

    const audit = (body: unknown) =>
      getJson(`${registry.url}-/npm/v1/security/advisories/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // Literals, not `add()`'s return value: the generated `id` and `url` are
    // the only things `add()` contributes, and `bun audit --ignore` reads the url.
    expect((await audit({ lodash: ["4.17.20"], express: ["4.0.0"] })).body).toEqual({
      lodash: [
        {
          id: 1_000_000,
          url: "https://github.com/advisories/GHSA-1000000",
          vulnerable_versions: "<4.17.21",
          severity: "high",
          title: "Prototype Pollution",
        },
      ],
    });
    expect((await audit({ lodash: ["4.17.21"] })).body).toEqual({});
  });

  test("an explicit `url: undefined` falls back to the generated url, it does not erase it", async () => {
    await using registry = await new NpmRegistry().start();
    const advisory = registry.advisories.add({
      module_name: "lodash",
      vulnerable_versions: "<4.17.21",
      severity: "high",
      title: "Prototype Pollution",
      url: undefined,
    });
    expect(advisory.url).toBe("https://github.com/advisories/GHSA-1000000");
  });

  test("a Content-Encoding: gzip body is decoded (what `bun audit` sends)", async () => {
    await using registry = await new NpmRegistry().start();
    registry.advisories.add({
      module_name: "lodash",
      vulnerable_versions: "<4.17.21",
      severity: "high",
      title: "Prototype Pollution",
    });
    const { status, body } = await getJson(`${registry.url}-/npm/v1/security/advisories/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: Bun.gzipSync(Buffer.from(JSON.stringify({ lodash: ["4.17.20"] }))),
    });
    expect({ status, body }).toEqual({
      status: 200,
      body: {
        lodash: [
          {
            id: 1_000_000,
            url: "https://github.com/advisories/GHSA-1000000",
            vulnerable_versions: "<4.17.21",
            severity: "high",
            title: "Prototype Pollution",
          },
        ],
      },
    });
  });
});

describe("handler errors", () => {
  // Tests put `expect()` calls inside `intercept()` to assert on the wire
  // (bun's `accept`, `npm-auth-type`, ...). A 500 alone would let a bun
  // regression pass: the install often tolerates it.
  //
  // `stop()` throws here by design, so these cannot use `await using`; the
  // `finally` drains first so the cleanup `stop()` is quiet.
  async function withRegistry(body: (registry: NpmRegistry) => Promise<void>) {
    const registry = await new NpmRegistry().start();
    try {
      await body(registry);
    } finally {
      registry.takeHandlerErrors();
      registry.stop();
    }
  }

  test("a throw inside an interceptor surfaces from stop(), not just as a 500", async () => {
    await withRegistry(async registry => {
      registry.intercept(() => {
        throw new Error("wire contract violated");
      });
      expect(await getJson(`${registry.url}whatever`)).toMatchObject({ status: 500 });
      expect(() => registry.stop()).toThrow("wire contract violated");
    });
  });

  test("takeHandlerErrors drains, so a test that expects the throw can stop() cleanly", async () => {
    await withRegistry(async registry => {
      registry.intercept(() => {
        throw new Error("expected");
      });
      await getJson(`${registry.url}whatever`);
      expect(registry.takeHandlerErrors()).toMatchObject([{ message: "expected" }]);
      expect(() => registry.stop()).not.toThrow();
    });
  });
});

describe("routing", () => {
  test("an unknown path gets the registry's JSON 404, not bun's HTML one", async () => {
    await using registry = await new NpmRegistry().start();
    expect(await getJson(`${registry.url}-/npm/v1/definitely/not/a/thing`)).toMatchObject({
      status: 404,
      body: { error: "Not found" },
    });
  });

  test("/-/ping", async () => {
    await using registry = await new NpmRegistry().start();
    expect(await getJson(`${registry.url}-/ping`)).toMatchObject({ status: 200, body: {} });
  });

  test("a tarball route whose first segment is not a scope is unrouted", async () => {
    // The four-segment tarball routes exist only for the literal-slash
    // spelling of a scoped name; any other first segment has no such
    // path and must 404 as unrouted, like every other scoped-sibling
    // handler in the table.
    await using registry = await new NpmRegistry().start();
    registry.defineFallback({ "1.0.0": {} });
    expect(await getJson(`${registry.url}notascope/pkg/-/pkg-1.0.0.tgz`)).toMatchObject({
      status: 404,
      body: { error: "Not found" },
    });
    expect(await getJson(`${registry.url}notascope/pkg/-/x.tgz/-rev/1`, { method: "DELETE" })).toMatchObject({
      status: 404,
      body: { error: "Not found" },
    });
    // The guard short-circuits before #resolve, so the fallback must
    // not have been materialized for the bogus name.
    expect(registry.names).not.toContain("notascope/pkg");
  });

  test("a non-object JSON body is a 400 on every handler that dereferences one", async () => {
    // `null` is valid JSON; every handler immediately dereferences a
    // property of the parsed body, and the server's own error hook says
    // "a throw inside a handler is a bug in the registry".
    await using registry = await new NpmRegistry().start();
    registry.define("p", { "1.0.0": {} });
    const send = (path: string, method: string, body: unknown) =>
      getJson<{ error: string }>(`${registry.url}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const expected = { status: 400, body: { error: "request body must be a JSON object" } };
    for (const body of [null, [], 7, "x"]) {
      expect(await send("p", "PUT", body)).toMatchObject(expected);
      expect(await send("p/-rev/1-x", "PUT", body)).toMatchObject(expected);
      expect(await send("-/npm/v1/security/advisories/bulk", "POST", body)).toMatchObject(expected);
      expect(await send("-/user/org.couchdb.user:u", "PUT", body)).toMatchObject(expected);
    }
    // And an unparseable body is still the existing 400.
    const invalid = await getJson(`${registry.url}p`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(invalid).toMatchObject({ status: 400, body: { error: "invalid JSON body" } });
  });
});
