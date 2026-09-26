import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Manifest } from "./fixtures.ts";
import { abbreviatedAccept, jsonHeaders, pack, publishBody, request, sha1, sha512, storage } from "./fixtures.ts";
import { Registry } from "./index.ts";

let fixtures: Awaited<ReturnType<typeof storage>>;

beforeAll(async () => {
  fixtures = await storage([
    {
      manifests: [
        { name: "on-disk", version: "1.0.0" },
        { name: "on-disk", version: "1.1.0" },
      ],
    },
  ]);
});

afterAll(() => {
  fixtures.directory[Symbol.dispose]();
});

function setup(options: ConstructorParameters<typeof Registry>[0] = {}) {
  const registry = new Registry({ storage: fixtures.path, ...options }).start();
  const token = (name: string) =>
    registry.auth.createToken(registry.auth.users.get(name) ?? registry.auth.addUser(name, "secret")).token;
  const put = (path: string, body: unknown, user: string | null = "alice", headers: Record<string, string> = {}) =>
    request(registry.url + path, {
      method: "PUT",
      headers: { ...jsonHeaders(user === null ? undefined : token(user)), ...headers },
      body: JSON.stringify(body),
    });
  const publish = async (manifest: Manifest, options: Parameters<typeof publishBody>[2] & { user?: string } = {}) =>
    put(
      manifest.name.replace("/", "%2f"),
      publishBody(manifest, await pack(manifest), { registry: registry.url, ...options }),
      options.user,
    );
  const packument = async (name: string, user?: string) =>
    (
      await request(registry.url + name.replace("/", "%2f") + "?write=true", {
        headers: user === undefined ? {} : { authorization: `Bearer ${token(user)}` },
      })
    ).json;
  return { registry, token, put, publish, packument };
}

describe("publish", () => {
  test("a new package", async () => {
    const { registry, publish } = setup();
    using _ = registry;
    const manifest = {
      name: "fresh",
      version: "1.0.0",
      description: "a fresh package",
      keywords: ["new"],
      license: "MIT",
      scripts: { postinstall: "echo hi" },
      readme: "# fresh",
      readmeFilename: "README.md",
    };
    const tarball = await pack(manifest);
    const before = Date.now();
    const reply = await publish(manifest);
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ ok: true, id: "fresh", rev: expect.stringMatching(/^1-[0-9a-f]{32}$/) });

    const full = await request(`${registry.url}fresh`);
    const published = new Date(full.json.time["1.0.0"]).getTime();
    expect(published).toBeGreaterThanOrEqual(before);
    expect(full.json).toEqual({
      _id: "fresh",
      _rev: reply.json.rev,
      name: "fresh",
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          name: "fresh",
          version: "1.0.0",
          description: "a fresh package",
          keywords: ["new"],
          license: "MIT",
          scripts: { postinstall: "echo hi" },
          readmeFilename: "README.md",
          _id: "fresh@1.0.0",
          _nodeVersion: "24.3.0",
          _npmVersion: "10.8.3",
          dist: {
            integrity: sha512(tarball),
            shasum: sha1(tarball),
            // The registry decides where the tarball is, not the client.
            tarball: `${registry.url}fresh/-/fresh-1.0.0.tgz`,
          },
          _npmUser: { name: "alice", email: "alice@example.com" },
          maintainers: [{ name: "alice", email: "alice@example.com" }],
        },
      },
      maintainers: [{ name: "alice", email: "alice@example.com" }],
      time: { "1.0.0": full.json.time["1.0.0"], modified: full.json.time["1.0.0"], created: full.json.time["1.0.0"] },
      // The fields of the latest version that the registry lifts to the top.
      description: "a fresh package",
      keywords: ["new"],
      license: "MIT",
      readmeFilename: "README.md",
      readme: "# fresh",
    });

    const abbreviated = await request(`${registry.url}fresh`, { headers: { accept: abbreviatedAccept } });
    expect(abbreviated.json.versions["1.0.0"].hasInstallScript).toBe(true);
    expect(abbreviated.json.modified).toBe(full.json.time.modified);

    const download = await request(full.json.versions["1.0.0"].dist.tarball);
    expect(Buffer.from(download.bytes).equals(tarball)).toBe(true);
    expect((await request(`${registry.url}-/package/fresh/collaborators`)).json).toEqual({ alice: "write" });
  });

  test("more versions and tags", async () => {
    const { registry, publish, packument } = setup();
    using _ = registry;
    expect((await publish({ name: "tagged", version: "1.0.0" }, { tag: "next" })).status).toBe(200);
    // Every package has a latest. The first version takes it when the client asks for another tag only.
    expect((await packument("tagged"))["dist-tags"]).toEqual({ next: "1.0.0", latest: "1.0.0" });

    const second = await publish({ name: "tagged", version: "2.0.0-rc.1" }, { tag: "next" });
    expect(second.json.rev).toStartWith("2-");
    expect((await packument("tagged"))["dist-tags"]).toEqual({ next: "2.0.0-rc.1", latest: "1.0.0" });

    expect((await publish({ name: "tagged", version: "0.9.0", description: "old" })).status).toBe(200);
    const document = await packument("tagged");
    // The registry does not compare versions: the client put latest on 0.9.0.
    expect(document["dist-tags"]).toEqual({ next: "2.0.0-rc.1", latest: "0.9.0" });
    expect(Object.keys(document.versions)).toEqual(["1.0.0", "2.0.0-rc.1", "0.9.0"]);
    expect(document.description).toBe("old");
    expect(document.time.created).toBe(document.time["1.0.0"]);
    expect(document.time.modified).toBe(document.time["0.9.0"]);
  });

  test("a version of a package of the storage directory", async () => {
    const { registry, publish, packument } = setup();
    using _ = registry;
    expect((await publish({ name: "on-disk", version: "2.0.0" })).status).toBe(200);
    const document = await packument("on-disk");
    expect(Object.keys(document.versions)).toEqual(["1.0.0", "1.1.0", "2.0.0"]);
    expect(document["dist-tags"]).toEqual({ latest: "2.0.0" });
    for (const version of Object.values<any>(document.versions)) {
      const download = await request(version.dist.tarball);
      expect(sha512(download.bytes)).toBe(version.dist.integrity);
    }
    // The directory is as it was. Another registry on the same storage does not see the version.
    using other = new Registry({ storage: fixtures.path }).start();
    expect(Object.keys((await request(`${other.url}on-disk`)).json.versions)).toEqual(["1.0.0", "1.1.0"]);
    registry.packages.reset("on-disk");
    expect(Object.keys((await packument("on-disk")).versions)).toEqual(["1.0.0", "1.1.0"]);
  });

  test("a version is published once", async () => {
    const { registry, publish } = setup();
    using _ = registry;
    expect((await publish({ name: "once", version: "1.0.0" })).status).toBe(200);
    for (const name of ["once", "on-disk"]) {
      const again = await publish({ name, version: "1.0.0", description: "changed" });
      expect(again.status).toBe(403);
      expect(again.json).toEqual({ error: "You cannot publish over the previously published versions: 1.0.0." });
    }
    expect((await request(`${registry.url}once`)).json).not.toHaveProperty("description");

    // A test that needs the same version again removes the package.
    registry.packages.delete("once");
    expect((await request(`${registry.url}once`)).status).toBe(404);
    expect((await publish({ name: "once", version: "1.0.0" })).status).toBe(200);
  });

  test("concurrent publishes of one version", async () => {
    const { registry, publish, packument, token } = setup();
    using _ = registry;
    token("alice");
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, index) => publish({ name: "race", version: "1.0.0", description: String(index) })),
    );
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 403, 403, 403, 403, 403, 403, 403]);
    const versions = await Promise.all(
      Array.from({ length: 8 }, (_, index) => publish({ name: "many", version: `1.0.${index}` })),
    );
    expect(versions.map(reply => reply.status)).toEqual(Array(8).fill(200));
    expect(Object.keys((await packument("many")).versions)).toHaveLength(8);
  });

  test("who can publish", async () => {
    const { registry, publish, put } = setup();
    using _ = registry;
    const manifest = { name: "owned", version: "1.0.0" };
    const body = publishBody(manifest, await pack(manifest));

    const anonymous = await put("owned", body, null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.json).toEqual({ error: "You must be logged in to publish packages." });

    const wrongToken = await request(`${registry.url}owned`, {
      method: "PUT",
      headers: jsonHeaders("npm_000000000000000000000000000000000000"),
      body: JSON.stringify(body),
    });
    expect(wrongToken.status).toBe(401);

    expect((await publish(manifest, { user: "alice" })).status).toBe(200);
    const stranger = await publish({ name: "owned", version: "1.0.1" }, { user: "bob" });
    expect(stranger.status).toBe(403);
    expect(stranger.json).toEqual({
      error: `You do not have permission to publish "owned". Are you logged in as the correct user?`,
    });
    // A package of the storage directory has no maintainers, so every user can add a version.
    expect((await publish({ name: "on-disk", version: "3.0.0" }, { user: "bob" })).status).toBe(200);
  });

  test("access rules replace the defaults", async () => {
    const { registry, publish } = setup({
      access: { "@team/*": { read: "authenticated", write: ["alice"] }, "open-*": { write: "authenticated" } },
    });
    using _ = registry;
    expect((await publish({ name: "@team/tool", version: "1.0.0" }, { user: "bob" })).status).toBe(403);
    expect((await publish({ name: "@team/tool", version: "1.0.0" }, { user: "alice", access: "public" })).status).toBe(
      200,
    );
    expect((await request(`${registry.url}@team%2ftool`)).status).toBe(404);

    expect((await publish({ name: "open-source", version: "1.0.0" }, { user: "alice" })).status).toBe(200);
    expect((await publish({ name: "open-source", version: "1.0.1" }, { user: "bob" })).status).toBe(200);
  });

  test("a scoped package is restricted unless the client says public", async () => {
    const { registry, publish, token } = setup();
    using _ = registry;
    expect((await publish({ name: "@alice/secret", version: "1.0.0" })).status).toBe(200);
    expect((await publish({ name: "@alice/open", version: "1.0.0" }, { access: "public" })).status).toBe(200);
    expect((await publish({ name: "@alice/closed", version: "1.0.0" }, { access: "restricted" })).status).toBe(200);
    expect((await publish({ name: "unscoped", version: "1.0.0" }, { access: "restricted" })).status).toBe(400);

    const statuses = async (authorization?: string) =>
      Object.fromEntries(
        await Promise.all(
          ["@alice%2fsecret", "@alice%2fopen", "@alice%2fclosed"].map(async path => [
            path,
            (await request(registry.url + path, { headers: authorization ? { authorization } : {} })).status,
          ]),
        ),
      );
    expect(await statuses()).toEqual({ "@alice%2fsecret": 404, "@alice%2fopen": 200, "@alice%2fclosed": 404 });
    expect(await statuses(`Bearer ${token("alice")}`)).toEqual({
      "@alice%2fsecret": 200,
      "@alice%2fopen": 200,
      "@alice%2fclosed": 200,
    });
    // Another user is not a maintainer.
    expect(await statuses(`Bearer ${token("bob")}`)).toEqual({
      "@alice%2fsecret": 404,
      "@alice%2fopen": 200,
      "@alice%2fclosed": 404,
    });

    const visibility = `${registry.url}-/package/@alice%2fsecret/visibility`;
    const headers = jsonHeaders(token("alice"));
    expect((await request(visibility, { headers })).json).toEqual({ public: false });
    const opened = await request(`${registry.url}-/package/@alice%2fsecret/access`, {
      method: "POST",
      headers,
      body: JSON.stringify({ access: "public" }),
    });
    expect(opened.status).toBe(200);
    expect((await request(visibility)).json).toEqual({ public: true });
    expect((await request(`${registry.url}@alice%2fsecret`)).status).toBe(200);
  });

  test.each([
    ["another name in the body", (body: any) => (body.name = "other"), "the body is for"],
    ["another name in the version", (body: any) => (body.versions["1.0.0"].name = "other"), "must have this name"],
    ["another version in the version", (body: any) => (body.versions["1.0.0"].version = "1.0.1"), "must have this"],
    ["two versions", (body: any) => (body.versions["1.0.1"] = body.versions["1.0.0"]), "one version"],
    ["no versions", (body: any) => (body.versions = {}), "one version"],
    ["a wrong shasum", (body: any) => (body.versions["1.0.0"].dist.shasum = "0".repeat(40)), "dist.shasum"],
    [
      "a wrong integrity",
      (body: any) => (body.versions["1.0.0"].dist.integrity = `sha512-${btoa("0".repeat(64))}`),
      "dist.integrity",
    ],
    ["a wrong length", (body: any) => (Object.values<any>(body._attachments)[0].length += 1), "length"],
    ["data that is not base64", (body: any) => (Object.values<any>(body._attachments)[0].data = "%%%"), "base64"],
    ["an empty tarball", (body: any) => (Object.values<any>(body._attachments)[0].data = ""), "empty"],
    ["a tag that reads as a range", (body: any) => (body["dist-tags"] = { "1.x": "1.0.0" }), "dist-tag"],
    ["a tag for another version", (body: any) => (body["dist-tags"] = { latest: "2.0.0" }), "must point to"],
    ["an unknown access", (body: any) => (body.access = "secret"), "access"],
  ])("refuses %s", async (_, change, message) => {
    const { registry, put } = setup();
    using __ = registry;
    const manifest = { name: "checked", version: "1.0.0" };
    const body = publishBody(manifest, await pack(manifest));
    change(body);
    const reply = await put("checked", body);
    expect(reply.status).toBe(400);
    expect(reply.json.error).toContain(message);
    expect(await registry.packages.has("checked")).toBe(false);
  });

  test.each([
    ["Capital", "name can no longer contain capital letters"],
    ["http", "http is a core module name"],
    ["special~", `name can no longer contain special characters ("~'!()*")`],
    ["x".repeat(215), "name can no longer contain more than 214 characters"],
  ])("refuses the new name %s", async (name, reason) => {
    const { registry, publish } = setup();
    using _ = registry;
    const reply = await publish({ name, version: "1.0.0" });
    expect(reply.status).toBe(400);
    expect(reply.json.error).toEndWith(reason);
  });

  test.each(["1.0", "v1.0.0", "01.0.0", "latest", "1.0.0.0"])("refuses the version %s", async version => {
    const { registry, publish } = setup();
    using _ = registry;
    const reply = await publish({ name: "versioned", version });
    expect(reply).toMatchObject({ status: 400, json: { error: `Bad Request: "${version}" is not a valid version` } });
  });

  test("build metadata is part of the version", async () => {
    const { registry, publish, packument } = setup();
    using _ = registry;
    expect((await publish({ name: "built", version: "1.0.0+build.5" })).status).toBe(200);
    expect(Object.keys((await packument("built")).versions)).toEqual(["1.0.0+build.5"]);
  });

  test("the body must be JSON of the right type", async () => {
    const { registry, token } = setup();
    using _ = registry;
    const manifest = { name: "typed", version: "1.0.0" };
    const body = JSON.stringify(publishBody(manifest, await pack(manifest)));
    const authorization = `Bearer ${token("alice")}`;
    const send = (headers: Record<string, string>, content: BodyInit = body) =>
      request(`${registry.url}typed`, { method: "PUT", headers: { authorization, ...headers }, body: content });

    expect((await send({ "content-type": "application/octet-stream" })).status).toBe(415);
    expect((await send({ "content-type": "application/json" }, "{ not json")).status).toBe(400);
    expect((await send({ "content-type": "application/json" }, "[]")).status).toBe(400);
    expect(await registry.packages.has("typed")).toBe(false);
    expect((await send({ "content-type": "application/json; charset=utf-8" })).status).toBe(200);
    registry.packages.delete("typed");
    const gzipped = await send({ "content-type": "application/json", "content-encoding": "gzip" }, Bun.gzipSync(body));
    expect(gzipped.status).toBe(200);
  });
});

describe("changes after the publish", () => {
  test("deprecate", async () => {
    const { registry, publish, packument, put } = setup();
    using _ = registry;
    await publish({ name: "aging", version: "1.0.0" });
    await publish({ name: "aging", version: "1.1.0" });

    // `npm deprecate` reads the packument, writes the message into the versions, and sends all of it back.
    const document = await packument("aging");
    document.versions["1.0.0"].deprecated = "1.0.0 has a bug";
    expect((await put("aging", document, "bob")).status).toBe(403);
    const reply = await put("aging", document);
    expect(reply.status).toBe(200);
    expect(reply.json.rev).toStartWith("3-");

    const abbreviated = await request(`${registry.url}aging`, { headers: { accept: abbreviatedAccept } });
    expect(abbreviated.json.versions["1.0.0"].deprecated).toBe("1.0.0 has a bug");
    expect(abbreviated.json.versions["1.1.0"]).not.toHaveProperty("deprecated");

    // An empty message takes the deprecation away.
    const current = await packument("aging");
    current.versions["1.0.0"].deprecated = "";
    expect((await put("aging", current)).status).toBe(200);
    expect((await packument("aging")).versions["1.0.0"]).not.toHaveProperty("deprecated");
  });

  test("star", async () => {
    const { registry, publish, packument, put } = setup();
    using _ = registry;
    await publish({ name: "shiny", version: "1.0.0" });
    // Every user can star, also one that cannot publish the package.
    const document = await packument("shiny");
    const reply = await put("shiny", { _id: "shiny", _rev: document._rev, users: { bob: true } }, "bob");
    expect(reply.status).toBe(200);
    expect((await packument("shiny")).users).toEqual({ bob: true });
    await put("shiny", { _id: "shiny", users: {} }, "bob");
    expect((await packument("shiny")).users).toEqual({});
  });

  test("dist-tags", async () => {
    const { registry, publish, token } = setup();
    using _ = registry;
    await publish({ name: "labels", version: "1.0.0" });
    await publish({ name: "labels", version: "2.0.0" }, { tag: "next" });
    const tags = `${registry.url}-/package/labels/dist-tags`;
    const write = (method: string, tag: string, version?: string, user = "alice") =>
      request(`${tags}/${encodeURIComponent(tag)}`, {
        method,
        headers: jsonHeaders(token(user)),
        body: version === undefined ? undefined : JSON.stringify(version),
      });

    // The body is the version as a JSON string.
    expect(await write("PUT", "stable", "1.0.0")).toMatchObject({ status: 200, json: { ok: "dist-tags updated" } });
    expect((await write("POST", "latest", "2.0.0")).status).toBe(200);
    expect((await request(tags)).json).toEqual({ latest: "2.0.0", next: "2.0.0", stable: "1.0.0" });

    expect((await write("DELETE", "next")).status).toBe(200);
    expect((await request(tags)).json).toEqual({ latest: "2.0.0", stable: "1.0.0" });

    expect(await write("PUT", "stable", "9.9.9")).toMatchObject({ status: 404 });
    expect((await write("PUT", "1.x", "1.0.0")).status).toBe(400);
    expect((await write("DELETE", "latest")).status).toBe(400);
    expect((await write("DELETE", "never-set")).status).toBe(404);
    expect((await write("DELETE", "constructor")).status).toBe(404);
    expect((await write("PUT", "__proto__", "1.0.0")).status).toBe(400);
    expect((await write("PUT", "stable", "2.0.0", "bob")).status).toBe(403);
    const anonymous = await request(`${tags}/stable`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify("2.0.0"),
    });
    expect(anonymous.status).toBe(401);
    expect((await request(tags)).json).toEqual({ latest: "2.0.0", stable: "1.0.0" });
  });
});

describe("unpublish", () => {
  test("one version", async () => {
    const { registry, publish, packument, put, token } = setup();
    using _ = registry;
    await publish({ name: "shrinking", version: "1.0.0" });
    await publish({ name: "shrinking", version: "1.1.0" }, { tag: "next" });
    await publish({ name: "shrinking", version: "2.0.0" });

    // What `npm unpublish shrinking@2.0.0` sends: the packument without the version and without its tags.
    const document = await packument("shrinking");
    const tarball = new URL(document.versions["2.0.0"].dist.tarball).pathname;
    delete document.versions["2.0.0"];
    delete document["dist-tags"].latest;

    const stale = await put(`shrinking/-rev/1-${"0".repeat(32)}`, document);
    expect(stale).toMatchObject({ status: 409, json: { error: "Document update conflict." } });
    expect((await put(`shrinking/-rev/${document._rev}`, document, "bob")).status).toBe(403);

    const replaced = await put(`shrinking/-rev/${document._rev}`, document);
    expect(replaced.status).toBe(200);
    const after = await packument("shrinking");
    expect(Object.keys(after.versions)).toEqual(["1.0.0", "1.1.0"]);
    // The highest version that is left takes latest.
    expect(after["dist-tags"]).toEqual({ next: "1.1.0", latest: "1.1.0" });
    // The time of the version stays in the document.
    expect(Object.keys(after.time)).toContain("2.0.0");

    // The tarball goes away in a request of its own.
    expect((await request(registry.url + tarball.slice(1))).status).toBe(200);
    const removed = await request(`${registry.url}${tarball.slice(1)}/-rev/${after._rev}`, {
      method: "DELETE",
      headers: jsonHeaders(token("alice")),
    });
    expect(removed.status).toBe(200);
    expect((await request(registry.url + tarball.slice(1))).status).toBe(404);

    // The tarball of a version that is still there cannot be removed.
    const kept = await request(`${registry.url}shrinking/-/shrinking-1.0.0.tgz/-rev/${after._rev}`, {
      method: "DELETE",
      headers: jsonHeaders(token("alice")),
    });
    expect(kept.status).toBe(400);

    // The version number is used up.
    const again = await publish({ name: "shrinking", version: "2.0.0" });
    expect(again.status).toBe(403);
    expect((await publish({ name: "shrinking", version: "2.0.1" })).status).toBe(200);
  });

  test("the whole package", async () => {
    const { registry, publish, packument, token } = setup();
    using _ = registry;
    await publish({ name: "leaving", version: "1.0.0" });
    const { _rev } = await packument("leaving");
    const unpublish = (user: string) =>
      request(`${registry.url}leaving/-rev/${_rev}`, { method: "DELETE", headers: jsonHeaders(token(user)) });

    expect((await unpublish("bob")).status).toBe(403);
    expect((await unpublish("alice")).status).toBe(200);
    expect((await request(`${registry.url}leaving`)).status).toBe(404);
    expect((await request(`${registry.url}leaving/-/leaving-1.0.0.tgz`)).status).toBe(404);
    expect((await unpublish("alice")).status).toBe(404);

    const soon = await publish({ name: "leaving", version: "1.0.1" });
    expect(soon.status).toBe(403);
    expect(soon.json).toEqual({ error: "leaving cannot be republished until 24 hours have passed." });
  });

  test("the last version takes the package with it", async () => {
    const { registry, publish, packument, put } = setup();
    using _ = registry;
    await publish({ name: "single", version: "1.0.0" });
    const document = await packument("single");
    document.versions = {};
    document["dist-tags"] = {};
    expect((await put(`single/-rev/${document._rev}`, document)).status).toBe(200);
    expect((await request(`${registry.url}single`)).status).toBe(404);
  });

  test("owners", async () => {
    const { registry, publish, packument, put } = setup();
    using _ = registry;
    await publish({ name: "shared", version: "1.0.0" });
    const { _id, _rev } = await packument("shared");
    const maintainers = [
      { name: "alice", email: "alice@example.com" },
      { name: "bob", email: "bob@example.com" },
    ];
    expect((await put(`shared/-rev/${_rev}`, { _id, _rev, maintainers: [] })).status).toBe(400);
    expect((await put(`shared/-rev/${_rev}`, { _id, _rev, maintainers })).status).toBe(200);
    expect((await packument("shared")).maintainers).toEqual(maintainers);
    expect((await publish({ name: "shared", version: "1.0.1" }, { user: "bob" })).status).toBe(200);
  });
});

describe("advisories", () => {
  test("the bulk endpoint answers for the versions the client has", async () => {
    const { registry } = setup();
    using _ = registry;
    const advisory = registry.advisories.add("on-disk", { vulnerable_versions: "<1.1.0", severity: "critical" });
    registry.advisories.add("on-disk", { vulnerable_versions: ">=5", title: "not installed" });
    registry.advisories.add("elsewhere", { vulnerable_versions: "*" });

    const ask = (body: unknown, gzip = false) =>
      request(`${registry.url}-/npm/v1/security/advisories/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(gzip ? { "content-encoding": "gzip" } : {}) },
        body: gzip ? Bun.gzipSync(JSON.stringify(body)) : JSON.stringify(body),
      });

    const found = await ask({ "on-disk": ["1.0.0", "1.1.0"], "unknown": ["1.0.0"] }, true);
    expect(found.status).toBe(200);
    expect(found.json).toEqual({ "on-disk": [advisory] });
    expect(advisory).toEqual({
      id: expect.any(Number),
      url: `https://github.com/advisories/GHSA-${advisory.id}`,
      title: "Vulnerability in on-disk",
      severity: "critical",
      vulnerable_versions: "<1.1.0",
      cwe: [],
      cvss: { score: 0, vectorString: null },
    });
    expect(await ask({ "on-disk": ["1.1.0"] })).toMatchObject({ status: 200, text: "{}" });
    expect((await ask([])).status).toBe(400);
  });
});
