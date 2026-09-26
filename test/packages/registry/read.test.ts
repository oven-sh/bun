import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abbreviatedAccept, md5, request, sha1, sha512, storage } from "./fixtures.ts";
import { Registry } from "./index.ts";

let fixtures: Awaited<ReturnType<typeof storage>>;
let registry: Registry;
let origin: string;

beforeAll(async () => {
  fixtures = await storage([
    {
      manifests: [
        { name: "plain", version: "1.0.0" },
        { name: "plain", version: "1.1.0", dependencies: { "@scope/scoped": "^1.0.0" } },
        { name: "plain", version: "2.0.0-beta.1" },
      ],
      tags: { latest: "1.1.0", beta: "2.0.0-beta.1" },
    },
    { manifests: [{ name: "@scope/scoped", version: "1.0.0" }] },
    {
      manifests: [
        {
          name: "everything",
          version: "1.0.0",
          description: "not in the abbreviated form",
          main: "index.js",
          scripts: { postinstall: "node build.js", test: "bun test" },
          dependencies: { a: "1" },
          devDependencies: { b: "2" },
          optionalDependencies: { c: "3" },
          peerDependencies: { d: "4" },
          peerDependenciesMeta: { d: { optional: true } },
          bundledDependencies: ["a"],
          bin: { everything: "cli.js" },
          directories: { bin: "bin" },
          engines: { bun: ">=1" },
          funding: "https://example.com/fund",
          os: ["linux"],
          cpu: ["x64"],
          libc: ["glibc"],
          deprecated: "use something else",
          _hasShrinkwrap: false,
        },
        { name: "everything", version: "1.0.1", scripts: { test: "bun test" }, _hasShrinkwrap: true },
        { name: "everything", version: "1.0.2", scripts: { install: "" } },
      ],
    },
    { manifests: [{ name: "@private/hidden", version: "1.0.0" }] },
    { manifests: [{ name: "untimed", version: "1.0.0" }], time: false },
    { manifests: [{ name: "gone", version: "1.0.0" }], withoutTarball: ["1.0.0"] },
  ]);
  registry = new Registry({ storage: fixtures.path, access: { "@private/*": { read: "authenticated" } } }).start();
  origin = registry.url.slice(0, -1);
});

afterAll(() => {
  registry.stop();
  fixtures.directory[Symbol.dispose]();
});

describe("packument", () => {
  test("abbreviated form", async () => {
    const reply = await request(`${origin}/plain`, { headers: { accept: abbreviatedAccept } });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({
      name: "plain",
      "dist-tags": { latest: "1.1.0", beta: "2.0.0-beta.1" },
      versions: {
        "1.0.0": {
          name: "plain",
          version: "1.0.0",
          dist: {
            integrity: sha512(fixtures.tarballs.get("plain@1.0.0")!),
            shasum: sha1(fixtures.tarballs.get("plain@1.0.0")!),
            tarball: `${origin}/plain/-/plain-1.0.0.tgz`,
          },
        },
        "1.1.0": {
          name: "plain",
          version: "1.1.0",
          dependencies: { "@scope/scoped": "^1.0.0" },
          dist: {
            integrity: sha512(fixtures.tarballs.get("plain@1.1.0")!),
            shasum: sha1(fixtures.tarballs.get("plain@1.1.0")!),
            tarball: `${origin}/plain/-/plain-1.1.0.tgz`,
          },
        },
        "2.0.0-beta.1": {
          name: "plain",
          version: "2.0.0-beta.1",
          dist: {
            integrity: sha512(fixtures.tarballs.get("plain@2.0.0-beta.1")!),
            shasum: sha1(fixtures.tarballs.get("plain@2.0.0-beta.1")!),
            tarball: `${origin}/plain/-/plain-2.0.0-beta.1.tgz`,
          },
        },
      },
      modified: "2024-03-02T10:20:30.400Z",
    });
    expect(reply.headers).toEqual({
      "content-type": "application/vnd.npm.install-v1+json",
      "content-length": String(Buffer.byteLength(reply.text)),
      "cache-control": "public, max-age=300",
      // One second is the resolution. The header is never older than `modified`.
      "last-modified": "Sat, 02 Mar 2024 10:20:31 GMT",
      etag: `"${md5(reply.text)}"`,
      vary: "accept-encoding, accept",
    });
    // The registry sends compact JSON with the keys in this order.
    expect(reply.text.startsWith(`{"name":"plain","dist-tags":{`)).toBe(true);
  });

  test("full form", async () => {
    const reply = await request(`${origin}/plain`, { headers: { accept: "application/json" } });
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("application/json");
    expect(Object.keys(reply.json).sort()).toEqual(["_id", "_rev", "dist-tags", "name", "time", "versions"]);
    expect(reply.json.time).toEqual({
      created: "2024-01-01T00:00:00.000Z",
      modified: "2024-03-02T10:20:30.400Z",
      "1.0.0": "2024-01-01T00:00:00.000Z",
      "1.1.0": "2024-01-02T00:00:00.000Z",
      "2.0.0-beta.1": "2024-01-03T00:00:00.000Z",
    });
    expect(reply.json.versions["1.0.0"]).toEqual({
      name: "plain",
      version: "1.0.0",
      _id: "plain@1.0.0",
      dist: {
        integrity: sha512(fixtures.tarballs.get("plain@1.0.0")!),
        shasum: sha1(fixtures.tarballs.get("plain@1.0.0")!),
        tarball: `${origin}/plain/-/plain-1.0.0.tgz`,
      },
    });
  });

  test("the abbreviated version object is an allow list", async () => {
    const reply = await request(`${origin}/everything`, { headers: { accept: abbreviatedAccept } });
    const { dist, ...version } = reply.json.versions["1.0.0"];
    expect(version).toEqual({
      name: "everything",
      version: "1.0.0",
      deprecated: "use something else",
      dependencies: { a: "1" },
      optionalDependencies: { c: "3" },
      devDependencies: { b: "2" },
      bundleDependencies: ["a"],
      peerDependencies: { d: "4" },
      peerDependenciesMeta: { d: { optional: true } },
      bin: { everything: "cli.js" },
      directories: { bin: "bin" },
      engines: { bun: ">=1" },
      funding: "https://example.com/fund",
      cpu: ["x64"],
      os: ["linux"],
      hasInstallScript: true,
    });
    const { dist: _, ...second } = reply.json.versions["1.0.1"];
    expect(second).toEqual({ name: "everything", version: "1.0.1", _hasShrinkwrap: true });
    // An install script that is empty does not count.
    expect(reply.json.versions["1.0.2"]).not.toHaveProperty("hasInstallScript");
  });

  test.each([
    ["application/vnd.npm.install-v1+json", true],
    [abbreviatedAccept, true],
    ["application/json, application/vnd.npm.install-v1+json", true],
    // The registry looks for the media type. It does not weigh q.
    ["application/json; q=1.0, application/vnd.npm.install-v1+json; q=0.1", true],
    ["application/vnd.npm.install-v1+json; charset=utf-8", true],
    ["APPLICATION/VND.NPM.INSTALL-V1+JSON", false],
    ["application/vnd.npm.install-v2+json", false],
    ["application/json, */*", false],
    ["application/*", false],
    ["*/*", false],
    ["text/html", false],
  ])("Accept: %s", async (accept, abbreviated) => {
    const reply = await request(`${origin}/plain`, { headers: { accept } });
    expect(reply.headers["content-type"]).toBe(
      abbreviated ? "application/vnd.npm.install-v1+json" : "application/json",
    );
    expect("time" in reply.json).toBe(!abbreviated);
  });

  test.each(["/@scope%2fscoped", "/@scope%2Fscoped", "/@scope/scoped", "/%40scope%2fscoped", "/@scope/scoped/"])(
    "a scoped name as %s",
    async path => {
      const reply = await request(origin + path, { headers: { accept: abbreviatedAccept } });
      expect(reply.status).toBe(200);
      expect(reply.json.name).toBe("@scope/scoped");
      expect(reply.json.versions["1.0.0"].dist.tarball).toBe(`${origin}/@scope/scoped/-/scoped-1.0.0.tgz`);
    },
  );

  test("the tarball URL follows the host of the request", async () => {
    const byAddress = `http://127.0.0.1:${registry.port}`;
    const reply = await request(`${byAddress}/plain`, { headers: { accept: abbreviatedAccept } });
    expect(reply.json.versions["1.0.0"].dist.tarball).toBe(`${byAddress}/plain/-/plain-1.0.0.tgz`);
  });

  test("publicUrl fixes the tarball URL", async () => {
    using fixed = new Registry({ storage: fixtures.path, publicUrl: "https://registry.example.com/" }).start();
    const reply = await request(`${fixed.url}plain`);
    expect(reply.json.versions["1.0.0"].dist.tarball).toBe("https://registry.example.com/plain/-/plain-1.0.0.tgz");
  });

  test("a packument without time gets modified from the file", async () => {
    const reply = await request(`${origin}/untimed`, { headers: { accept: abbreviatedAccept } });
    expect(new Date(reply.json.modified).toISOString()).toBe(reply.json.modified);
    const full = await request(`${origin}/untimed`);
    expect(full.json).not.toHaveProperty("time");
  });

  test.each([
    ["/nothing-here", "an unknown name"],
    ["/@scope%2fnothing-here", "an unknown scoped name"],
    // These two are the directory of "plain" to a file system that ignores case, or a period at the end.
    ["/Plain", "another case"],
    ["/plain.", "a period at the end"],
    ["/.hidden", "a name that starts with a period"],
    ["/has%20space", "a name that is not URL-safe"],
    ["/..%2f..%2fetc%2fpasswd", "a path that leaves the storage"],
    ["/@scope", "a scope without a name"],
    ["/%E0%A4%A", "a malformed escape"],
  ])("404 for %s (%s)", async path => {
    const reply = await request(origin + path, { headers: { accept: abbreviatedAccept } });
    expect({ status: reply.status, body: reply.text, type: reply.headers["content-type"] }).toEqual({
      status: 404,
      body: `{"error":"Not found"}`,
      type: "application/json",
    });
  });

  test("HEAD", async () => {
    const get = await request(`${origin}/plain`);
    const head = await request(`${origin}/plain`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.text).toBe("");
    expect(head.headers).toEqual(get.headers);
  });

  test("other methods", async () => {
    const reply = await request(`${origin}/plain`, { method: "POST", body: "{}" });
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe("GET, HEAD, PUT");
    expect(reply.json).toEqual({ code: "MethodNotAllowedError", message: "POST is not allowed" });
  });
});

describe("conditional requests and encodings", () => {
  test("If-None-Match", async () => {
    const first = await request(`${origin}/plain`, { headers: { accept: abbreviatedAccept } });
    const etag = first.headers.etag;
    for (const validator of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const reply = await request(`${origin}/plain`, {
        headers: { accept: abbreviatedAccept, "if-none-match": validator },
      });
      expect(reply.status).toBe(304);
      expect(reply.text).toBe("");
      expect(reply.headers).toMatchObject({
        "cache-control": "public, max-age=300",
        "last-modified": "Sat, 02 Mar 2024 10:20:31 GMT",
        etag,
      });
    }

    // What the registry itself answers, without the HTTP server between. A 304 has the validators and nothing
    // that describes a body. The test above cannot be this exact: the server can add headers of its own.
    const direct = await registry.fetch(
      new Request(`${origin}/plain`, { headers: { accept: abbreviatedAccept, "if-none-match": etag } }),
    );
    expect(direct.status).toBe(304);
    expect(Object.fromEntries(direct.headers)).toEqual({
      "cache-control": "public, max-age=300",
      "last-modified": "Sat, 02 Mar 2024 10:20:31 GMT",
      etag,
    });
    const changed = await request(`${origin}/plain`, {
      headers: { accept: abbreviatedAccept, "if-none-match": `"0123456789abcdef0123456789abcdef"` },
    });
    expect(changed.status).toBe(200);
    expect(changed.text).toBe(first.text);
  });

  test("the two forms have different entity tags", async () => {
    const abbreviated = await request(`${origin}/plain`, { headers: { accept: abbreviatedAccept } });
    const reply = await request(`${origin}/plain`, { headers: { "if-none-match": abbreviated.headers.etag } });
    expect(reply.status).toBe(200);
  });

  test("If-Modified-Since has no effect", async () => {
    const reply = await request(`${origin}/plain`, {
      headers: { accept: abbreviatedAccept, "if-modified-since": "Sat, 02 Mar 2024 10:20:31 GMT" },
    });
    expect(reply.status).toBe(200);
  });

  test.each([
    ["gzip, deflate, br, zstd", "br"],
    ["br", "br"],
    ["gzip", "gzip"],
    ["gzip, deflate", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["zstd", "identity"],
    ["deflate", "identity"],
    ["identity", "identity"],
  ])("Accept-Encoding: %s", async (accepted, used) => {
    const plain = await request(`${origin}/plain`, { headers: { accept: abbreviatedAccept } });
    const reply = await request(`${origin}/plain`, {
      headers: { accept: abbreviatedAccept, "accept-encoding": accepted },
    });
    expect(reply.headers["content-encoding"] ?? "identity").toBe(used);
    expect(reply.text).toBe(plain.text);
    // An encoded answer is a different representation, so its entity tag is weak.
    expect(reply.headers.etag).toBe(used === "identity" ? plain.headers.etag : `W/${plain.headers.etag}`);
  });

  test("a short body is not encoded", async () => {
    const reply = await request(`${origin}/nothing-here`, { headers: { "accept-encoding": "gzip, br" } });
    expect(reply.headers).toEqual({ "content-type": "application/json", "content-length": "21" });
  });
});

describe("version", () => {
  test.each([
    ["/plain/1.0.0", "1.0.0"],
    ["/plain/latest", "1.1.0"],
    ["/plain/beta", "2.0.0-beta.1"],
    ["/@scope%2fscoped/latest", "1.0.0"],
    ["/@scope/scoped/1.0.0", "1.0.0"],
  ])("%s", async (path, version) => {
    // The answer is the full version object, whatever the Accept header asks for.
    const reply = await request(origin + path, { headers: { accept: abbreviatedAccept } });
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("application/json");
    expect(reply.headers).not.toHaveProperty("etag");
    expect(reply.json.version).toBe(version);
    expect(reply.json._id).toBe(`${reply.json.name}@${version}`);
    expect(reply.json.dist.tarball).toStartWith(`${origin}/${reply.json.name}/-/`);
  });

  test.each(["9.9.9", "^1.0.0", "v1.0.0", "nope", "constructor", "__proto__"])("%s is not there", async wanted => {
    const reply = await request(`${origin}/plain/${encodeURIComponent(wanted)}`);
    expect(reply.status).toBe(404);
    // The body is a JSON string, not an object.
    expect(reply.text).toBe(JSON.stringify(`version not found: ${wanted}`));
  });
});

describe("tarball", () => {
  test("GET", async () => {
    const tarball = fixtures.tarballs.get("plain@1.0.0")!;
    const reply = await request(`${origin}/plain/-/plain-1.0.0.tgz`, { headers: { "accept-encoding": "gzip, br" } });
    expect(reply.status).toBe(200);
    expect(Buffer.from(reply.bytes).equals(tarball)).toBe(true);
    expect(reply.headers).toEqual({
      "content-type": "application/octet-stream",
      "content-length": String(tarball.byteLength),
      "accept-ranges": "bytes",
      "cache-control": "public, immutable, max-age=31557600",
      etag: `"${md5(tarball)}"`,
      "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
    });
  });

  test.each(["/@scope/scoped/-/scoped-1.0.0.tgz", "/@scope%2fscoped/-/scoped-1.0.0.tgz"])("%s", async path => {
    const reply = await request(origin + path);
    expect(reply.status).toBe(200);
    expect(sha512(reply.bytes)).toBe(sha512(fixtures.tarballs.get("@scope/scoped@1.0.0")!));
  });

  test("the scope is not part of the file name", async () => {
    const reply = await request(`${origin}/@scope/scoped/-/@scope/scoped-1.0.0.tgz`);
    expect(reply.status).toBe(404);
    expect(reply.json).toEqual({
      code: "ResourceNotFound",
      message: "/@scope/scoped/-/@scope/scoped-1.0.0.tgz does not exist",
    });
  });

  test.each([
    "/plain/-/plain-9.9.9.tgz",
    "/plain/-/other-1.0.0.tgz",
    "/plain/-/package.json",
    "/plain/-/..%2f..%2fplain%2fpackage.json",
    "/gone/-/gone-1.0.0.tgz",
    "/nothing-here/-/nothing-here-1.0.0.tgz",
  ])("404 for %s", async path => {
    const reply = await request(origin + path);
    expect({ status: reply.status, body: reply.text }).toEqual({ status: 404, body: `{"error":"Not found"}` });
  });

  test("HEAD and If-None-Match", async () => {
    const tarball = fixtures.tarballs.get("plain@1.0.0")!;
    const head = await request(`${origin}/plain/-/plain-1.0.0.tgz`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.text).toBe("");
    expect(head.headers["content-length"]).toBe(String(tarball.byteLength));

    const unchanged = await request(`${origin}/plain/-/plain-1.0.0.tgz`, {
      headers: { "if-none-match": head.headers.etag },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.text).toBe("");
    expect(unchanged.headers).toMatchObject({
      "cache-control": "public, max-age=300",
      etag: head.headers.etag,
      "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
    });

    const direct = await registry.fetch(
      new Request(`${origin}/plain/-/plain-1.0.0.tgz`, { headers: { "if-none-match": head.headers.etag } }),
    );
    expect(direct.status).toBe(304);
    expect(Object.fromEntries(direct.headers)).toEqual({
      "cache-control": "public, max-age=300",
      etag: head.headers.etag,
      "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
    });
  });

  test("Range", async () => {
    const tarball = fixtures.tarballs.get("plain@1.0.0")!;
    const size = tarball.byteLength;
    for (const [range, start, end] of [
      ["bytes=0-9", 0, 9],
      ["bytes=10-", 10, size - 1],
      ["bytes=-10", size - 10, size - 1],
      [`bytes=5-${size + 100}`, 5, size - 1],
    ] as const) {
      const reply = await request(`${origin}/plain/-/plain-1.0.0.tgz`, { headers: { range } });
      expect(reply.status).toBe(206);
      expect(reply.headers["content-range"]).toBe(`bytes ${start}-${end}/${size}`);
      expect(Buffer.from(reply.bytes).equals(tarball.subarray(start, end + 1))).toBe(true);
    }
    const past = await request(`${origin}/plain/-/plain-1.0.0.tgz`, { headers: { range: `bytes=${size}-` } });
    expect(past.status).toBe(416);
    expect(past.headers["content-range"]).toBe(`bytes */${size}`);
  });
});

describe("restricted packages", () => {
  test("look like they are not there", async () => {
    for (const path of ["/@private%2fhidden", "/@private/hidden/1.0.0", "/@private/hidden/-/hidden-1.0.0.tgz"]) {
      const unknown: Record<string, string>[] = [
        {},
        { authorization: "Bearer npm_notATokenOfThisRegistry000000000000" },
      ];
      for (const headers of unknown) {
        const reply = await request(origin + path, { headers });
        expect({ path, status: reply.status, body: reply.text }).toEqual({
          path,
          status: 404,
          body: `{"error":"Not found"}`,
        });
      }
    }
    const tags = await request(`${origin}/-/package/@private%2fhidden/dist-tags`);
    expect({ status: tags.status, body: tags.text }).toEqual({ status: 404, body: `"Not Found"` });
  });

  test("a user reads them with a token or with a password", async () => {
    using own = new Registry({ storage: fixtures.path, access: { "@private/*": { read: "authenticated" } } }).start();
    const { token } = own.auth.createToken(own.auth.addUser("reader", "secret"));
    for (const authorization of [`Bearer ${token}`, `Basic ${btoa("reader:secret")}`]) {
      const packument = await request(`${own.url}@private%2fhidden`, { headers: { authorization } });
      expect(packument.status).toBe(200);
      const tarball = await request(packument.json.versions["1.0.0"].dist.tarball, { headers: { authorization } });
      expect(sha512(tarball.bytes)).toBe(packument.json.versions["1.0.0"].dist.integrity);
    }
    const wrong = await request(`${own.url}@private%2fhidden`, {
      headers: { authorization: `Basic ${btoa("reader:wrong")}` },
    });
    expect(wrong.status).toBe(404);
  });

  test("credentials that are wrong do not block a public package", async () => {
    for (const authorization of ["Bearer nope", "Basic bm9wZTpub3Bl", "Digest x", "garbage"]) {
      const reply = await request(`${origin}/plain`, { headers: { authorization } });
      expect(reply.status).toBe(200);
    }
  });
});

describe("services", () => {
  test("dist-tags", async () => {
    for (const path of ["/-/package/plain/dist-tags", "/-/package/@scope%2fscoped/dist-tags"]) {
      const reply = await request(origin + path);
      expect(reply.status).toBe(200);
      expect(reply.headers["content-type"]).toBe("application/json");
    }
    expect((await request(`${origin}/-/package/plain/dist-tags`)).json).toEqual({
      latest: "1.1.0",
      beta: "2.0.0-beta.1",
    });
    expect((await request(`${origin}/-/package/@scope/scoped/dist-tags`)).json).toEqual({ latest: "1.0.0" });
    const missing = await request(`${origin}/-/package/nothing-here/dist-tags`);
    expect({ status: missing.status, body: missing.text }).toEqual({ status: 404, body: `"Not Found"` });
  });

  test("ping, root and keys", async () => {
    expect(await request(`${origin}/-/ping`)).toMatchObject({ status: 200, text: "{}" });
    expect(await request(`${origin}/-/ping?write=true`)).toMatchObject({ status: 200, text: "{}" });
    expect(await request(`${origin}/`)).toMatchObject({ status: 200, text: "{}" });
    expect(await request(`${origin}/-/npm/v1/keys`)).toMatchObject({ status: 200, json: { keys: [] } });
  });

  test("a path that no service owns", async () => {
    expect(await request(`${origin}/-/all`)).toMatchObject({
      status: 404,
      json: { code: "ResourceNotFound", message: "/-/all does not exist" },
    });
    const bulk = await request(`${origin}/-/npm/v1/security/advisories/bulk`);
    expect(bulk.status).toBe(405);
    expect(bulk.headers.allow).toBe("POST");
    expect(bulk.json).toEqual({ code: "MethodNotAllowedError", message: "GET is not allowed" });
  });

  test("visibility and collaborators", async () => {
    expect((await request(`${origin}/-/package/plain/visibility`)).json).toEqual({ public: true });
    expect((await request(`${origin}/-/package/plain/collaborators`)).json).toEqual({});
  });

  test("search", async () => {
    const all = await request(`${origin}/-/v1/search`);
    expect(all.json.total).toBe(5);
    expect(all.json.objects.map((found: any) => found.package.name)).toEqual([
      "@scope/scoped",
      "everything",
      "gone",
      "plain",
      "untimed",
    ]);

    const one = await request(`${origin}/-/v1/search?text=plain&size=1`);
    expect(one.json.objects).toHaveLength(1);
    expect(one.json.objects[0].package).toEqual({
      name: "plain",
      scope: "unscoped",
      version: "1.1.0",
      keywords: [],
      date: "2024-01-02T00:00:00.000Z",
      links: { npm: `${origin}/plain` },
      maintainers: [],
    });
    expect(Object.keys(one.json).sort()).toEqual(["objects", "time", "total"]);
    expect(Object.keys(one.json.objects[0]).sort()).toEqual(["package", "score", "searchScore"]);

    const scoped = await request(`${origin}/-/v1/search?text=scope:scope`);
    expect(scoped.json.objects.map((found: any) => found.package.name)).toEqual(["@scope/scoped"]);
    expect((await request(`${origin}/-/v1/search?text=zzz`)).json.total).toBe(0);
    expect((await request(`${origin}/-/v1/search?from=4`)).json.objects).toHaveLength(1);
  });
});

describe("hooks", () => {
  test("recordRequests and intercept", async () => {
    using own = new Registry({
      storage: fixtures.path,
      recordRequests: true,
      intercept: request => {
        if (new URL(request.url).pathname === "/plain/-/plain-1.0.0.tgz") {
          return new Response("out of order", { status: 503 });
        }
      },
    }).start();
    await request(`${own.url}plain?write=true`, { headers: { accept: abbreviatedAccept } });
    await request(`${own.url}plain/-/plain-1.0.0.tgz`);
    await request(`${own.url}plain/-/plain-1.1.0.tgz`);
    expect(own.requests.map(({ method, path, status }) => ({ method, path, status }))).toEqual([
      { method: "GET", path: "/plain?write=true", status: 200 },
      { method: "GET", path: "/plain/-/plain-1.0.0.tgz", status: 503 },
      { method: "GET", path: "/plain/-/plain-1.1.0.tgz", status: 200 },
    ]);
    expect(own.requests[0].headers.accept).toBe(abbreviatedAccept);
  });

  test("stop and start keep the state", async () => {
    const own = new Registry({ storage: fixtures.path });
    expect(() => own.port).toThrow("The registry has no port before start()");
    own.auth.addUser("keeper", "secret");
    own.start();
    expect(own.start()).toBe(own);
    expect((await request(`${own.url}-/ping`)).status).toBe(200);
    own.stop();
    expect(own.listening).toBe(false);
    own.start();
    try {
      const reply = await request(`${own.url}-/whoami`, {
        headers: { authorization: `Basic ${btoa("keeper:secret")}` },
      });
      expect(reply.json).toEqual({ username: "keeper" });
    } finally {
      own.stop();
    }
  });
});
