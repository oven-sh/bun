import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { join } from "path";

// Covers three related `bun install` behaviours:
//  1. registry credentials are scoped to the registry URL's origin *and path*
//  2. `install.allowedHosts` refuses hosts the project did not list
//  3. `install.rewrite` redirects requests at fetch time without touching bun.lock

const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");
const integrity = "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==";

type Received = { path: string; authorization: string | null };

/**
 * A registry that serves the `no-deps@1.0.0` manifest under any path prefix
 * (`<prefix>/no-deps`) and the tarball at any path ending in `.tgz`, records
 * every request, and lets each test decide where the manifest's `dist.tarball`
 * points.
 */
function serveRegistry(received: Received[], tarballUrl: (registryOrigin: string, manifestPath: string) => string) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      received.push({ path: url.pathname, authorization: req.headers.get("authorization") });
      if (url.pathname.endsWith(".tgz")) {
        return new Response(Bun.file(tgz));
      }
      if (url.pathname.endsWith("/no-deps")) {
        return Response.json({
          name: "no-deps",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "no-deps",
              version: "1.0.0",
              dist: { integrity, tarball: tarballUrl(`http://127.0.0.1:${server.port}`, url.pathname) },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

/** A second host: serves the tarball to anyone, records what it was sent. */
function serveElsewhere(received: Received[], status = 200) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      received.push({ path: new URL(req.url).pathname, authorization: req.headers.get("authorization") });
      return status === 200 ? new Response(Bun.file(tgz)) : new Response("nope", { status });
    },
  });
}

async function install(cwd: string, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const packageJson = JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } });

describe.concurrent("registry credentials are path-scoped", () => {
  // The registry (with a token) lives at http://127.0.0.1:<port>/prefix-a/.
  // Its manifest points the tarball at various places; only URLs under
  // /prefix-a/ on that origin may carry the token.
  describe.each([
    ["the registry path itself", (origin: string) => `${origin}/prefix-a/no-deps/-/no-deps-1.0.0.tgz`, "Bearer tok-a"],
    [
      "a deeper path under the registry",
      (origin: string) => `${origin}/prefix-a/deep/er/no-deps-1.0.0.tgz`,
      "Bearer tok-a",
    ],
    ["a sibling path on the same host", (origin: string) => `${origin}/prefix-b/no-deps/-/no-deps-1.0.0.tgz`, null],
    ["a path that merely shares a string prefix", (origin: string) => `${origin}/prefix-ab/no-deps-1.0.0.tgz`, null],
    ["the host root", (origin: string) => `${origin}/no-deps-1.0.0.tgz`, null],
    ["a dot-segment escape", (origin: string) => `${origin}/prefix-a/../prefix-b/no-deps-1.0.0.tgz`, null],
    ["an encoded dot-segment escape", (origin: string) => `${origin}/prefix-a/%2e%2e/prefix-b/no-deps-1.0.0.tgz`, null],
    ["an encoded-backslash escape", (origin: string) => `${origin}/prefix-a/..%5Cprefix-b/no-deps-1.0.0.tgz`, null],
    [
      "an encoded-slash escape",
      (origin: string) => `${origin}/prefix-a/x%2F..%2f..%2Fprefix-b/no-deps-1.0.0.tgz`,
      null,
    ],
    [
      "an encoded slash that is just part of a name",
      (origin: string) => `${origin}/prefix-a/@scope%2fno-deps/-/no-deps-1.0.0.tgz`,
      "Bearer tok-a",
    ],
  ])("tarball at %s", (_, tarballUrl, expectedAuthorization) => {
    it(`is fetched with authorization ${expectedAuthorization}`, async () => {
      const received: Received[] = [];
      await using registry = serveRegistry(received, tarballUrl);
      using dir = tempDir("registry-path-scoped-auth", {
        "package.json": packageJson,
        "bunfig.toml": `
[install]
cache = false
registry = { url = "http://127.0.0.1:${registry.port}/prefix-a/", token = "tok-a" }
`,
      });

      const { stdout, stderr, exitCode } = await install(String(dir));
      expect(stderr).toContain("Saved lockfile");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);

      const manifest = received.find(r => r.path === "/prefix-a/no-deps");
      const tarball = received.find(r => r.path.endsWith(".tgz"));
      expect(manifest?.authorization).toBe("Bearer tok-a");
      expect(tarball).toBeDefined();
      expect(tarball!.authorization).toBe(expectedAuthorization);
    });
  });

  // A redirect is held to the same rule as the request that produced it: the
  // token issued for /prefix-a/ does not follow a hop to another path on the
  // same origin (fetch's own rule only strips it cross-origin).
  it("does not forward the token on a redirect that leaves the registry path", async () => {
    const received: Received[] = [];
    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        received.push({ path: url.pathname, authorization: req.headers.get("authorization") });
        const origin = `http://127.0.0.1:${registry.port}`;
        if (url.pathname === "/prefix-a/no-deps") {
          return Response.redirect(`${origin}/mirror/no-deps`, 302);
        }
        if (url.pathname === "/mirror/no-deps") {
          return Response.json({
            name: "no-deps",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "no-deps",
                version: "1.0.0",
                dist: { integrity, tarball: `${origin}/prefix-a/no-deps/-/no-deps-1.0.0.tgz` },
              },
            },
          });
        }
        if (url.pathname === "/prefix-a/no-deps/-/no-deps-1.0.0.tgz") {
          return Response.redirect(`${origin}/prefix-b/no-deps-1.0.0.tgz`, 307);
        }
        if (url.pathname === "/prefix-b/no-deps-1.0.0.tgz") {
          return new Response(Bun.file(tgz));
        }
        return new Response("not found", { status: 404 });
      },
    });
    using dir = tempDir("registry-path-scoped-auth", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = { url = "http://127.0.0.1:${registry.port}/prefix-a/", token = "tok-a" }
`,
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(received).toEqual([
      { path: "/prefix-a/no-deps", authorization: "Bearer tok-a" },
      { path: "/mirror/no-deps", authorization: null },
      { path: "/prefix-a/no-deps/-/no-deps-1.0.0.tgz", authorization: "Bearer tok-a" },
      { path: "/prefix-b/no-deps-1.0.0.tgz", authorization: null },
    ]);
  });

  it("tarball on another host never receives the token", async () => {
    const received: Received[] = [];
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    await using registry = serveRegistry(
      received,
      () => `http://127.0.0.1:${elsewhere.port}/prefix-a/no-deps/-/no-deps-1.0.0.tgz`,
    );
    using dir = tempDir("registry-path-scoped-auth", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = { url = "http://127.0.0.1:${registry.port}/prefix-a/", token = "tok-a" }
`,
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(received.find(r => r.path === "/prefix-a/no-deps")?.authorization).toBe("Bearer tok-a");
    expect(elsewhereReceived).toEqual([{ path: "/prefix-a/no-deps/-/no-deps-1.0.0.tgz", authorization: null }]);
  });

  it("npmrc credentials for a path-based registry follow the same rule", async () => {
    const received: Received[] = [];
    await using registry = serveRegistry(received, origin => `${origin}/prefix-b/no-deps/-/no-deps-1.0.0.tgz`);
    using dir = tempDir("registry-path-scoped-auth", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
`,
      ".npmrc": [
        `registry=http://127.0.0.1:${registry.port}/prefix-a/`,
        `//127.0.0.1:${registry.port}/prefix-a/:_authToken=tok-a`,
        ``,
      ].join("\n"),
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(received.find(r => r.path === "/prefix-a/no-deps")?.authorization).toBe("Bearer tok-a");
    expect(received.find(r => r.path === "/prefix-b/no-deps/-/no-deps-1.0.0.tgz")?.authorization).toBeNull();
  });

  // npm's "nerf dart" lookup: a `//host/path/:_authToken` line that no
  // configured registry claims still supplies credentials for requests under
  // that host and path. This is how a registry whose tarballs live under a
  // sibling path is given a token for both.
  it("an extra npmrc //host/path/ entry covers requests under that path", async () => {
    const received: Received[] = [];
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    let tarballOnElsewhere = false;
    await using registry = serveRegistry(received, origin =>
      tarballOnElsewhere
        ? `http://127.0.0.1:${elsewhere.port}/downloads/no-deps-1.0.0.tgz`
        : `${origin}/prefix-b/no-deps/-/no-deps-1.0.0.tgz`,
    );
    const npmrc = [
      `registry=http://127.0.0.1:${registry.port}/prefix-a/`,
      `//127.0.0.1:${registry.port}/prefix-a/:_authToken=tok-a`,
      `//127.0.0.1:${registry.port}/prefix-b/:_authToken=tok-b`,
      `//127.0.0.1:${registry.port}/prefix-b/no-deps/:username=deep`,
      `//127.0.0.1:${registry.port}/prefix-b/no-deps/:_password=${Buffer.from("secret").toString("base64")}`,
      `//127.0.0.1:${elsewhere.port}/downloads/:_authToken=tok-elsewhere`,
      ``,
    ].join("\n");

    {
      using dir = tempDir("registry-path-scoped-auth", {
        "package.json": packageJson,
        "bunfig.toml": `[install]\ncache = false\n`,
        ".npmrc": npmrc,
      });
      const { stdout, stderr, exitCode } = await install(String(dir));
      expect(stderr).toContain("Saved lockfile");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
      expect(received).toEqual([
        { path: "/prefix-a/no-deps", authorization: "Bearer tok-a" },
        // the longest matching `//host/path/` wins: username + _password under /prefix-b/no-deps/
        {
          path: "/prefix-b/no-deps/-/no-deps-1.0.0.tgz",
          authorization: `Basic ${Buffer.from("deep:secret").toString("base64")}`,
        },
      ]);
    }

    // Over plain http an npmrc entry only covers an origin the configuration
    // itself declares as an http registry (the entries carry no scheme, and a
    // manifest must not be able to downgrade a request to cleartext and still
    // collect the token) ...
    tarballOnElsewhere = true;
    received.length = 0;
    {
      using dir = tempDir("registry-path-scoped-auth", {
        "package.json": packageJson,
        "bunfig.toml": `[install]\ncache = false\n`,
        ".npmrc": npmrc,
      });
      const { stdout, stderr, exitCode } = await install(String(dir));
      expect(stderr).toContain("Saved lockfile");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
      expect(received).toEqual([{ path: "/prefix-a/no-deps", authorization: "Bearer tok-a" }]);
      expect(elsewhereReceived).toEqual([{ path: "/downloads/no-deps-1.0.0.tgz", authorization: null }]);
    }

    // ... such as a scoped registry on that origin.
    received.length = 0;
    elsewhereReceived.length = 0;
    {
      using dir = tempDir("registry-path-scoped-auth", {
        "package.json": packageJson,
        "bunfig.toml": `[install]\ncache = false\n`,
        ".npmrc": npmrc + `@other:registry=http://127.0.0.1:${elsewhere.port}/\n`,
      });
      const { stdout, stderr, exitCode } = await install(String(dir));
      expect(stderr).toContain("Saved lockfile");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
      expect(received).toEqual([{ path: "/prefix-a/no-deps", authorization: "Bearer tok-a" }]);
      expect(elsewhereReceived).toEqual([
        { path: "/downloads/no-deps-1.0.0.tgz", authorization: "Bearer tok-elsewhere" },
      ]);
    }
  });

  it("an npmrc entry used over plain http keeps covering a redirect under its path", async () => {
    // The credential's scope follows the scheme it was honoured on: a hop that
    // stays under //host/npm/ keeps the token, one that leaves it does not.
    const received: Received[] = [];
    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        received.push({ path: url.pathname, authorization: req.headers.get("authorization") });
        const origin = `http://127.0.0.1:${registry.port}`;
        if (url.pathname === "/npm/team-a/no-deps") {
          return Response.json({
            name: "no-deps",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "no-deps",
                version: "1.0.0",
                dist: { integrity, tarball: `${origin}/npm/team-a/no-deps/-/no-deps-1.0.0.tgz` },
              },
            },
          });
        }
        if (url.pathname === "/npm/team-a/no-deps/-/no-deps-1.0.0.tgz") {
          return Response.redirect(`${origin}/npm/blobs/no-deps-1.0.0.tgz`, 307);
        }
        if (url.pathname === "/npm/blobs/no-deps-1.0.0.tgz") {
          return Response.redirect(`${origin}/cdn/no-deps-1.0.0.tgz`, 307);
        }
        if (url.pathname === "/cdn/no-deps-1.0.0.tgz") {
          return new Response(Bun.file(tgz));
        }
        return new Response("not found", { status: 404 });
      },
    });
    using dir = tempDir("registry-path-scoped-auth", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${registry.port}/npm/team-a/"
`,
      ".npmrc": `//127.0.0.1:${registry.port}/npm/:_authToken=npm-wide\n`,
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(received).toEqual([
      { path: "/npm/team-a/no-deps", authorization: "Bearer npm-wide" },
      { path: "/npm/team-a/no-deps/-/no-deps-1.0.0.tgz", authorization: "Bearer npm-wide" },
      { path: "/npm/blobs/no-deps-1.0.0.tgz", authorization: "Bearer npm-wide" },
      { path: "/cdn/no-deps-1.0.0.tgz", authorization: null },
    ]);
  });

  it("an npmrc entry for a parent path covers a registry configured below it", async () => {
    const received: Received[] = [];
    await using registry = serveRegistry(received, origin => `${origin}/npm/team-a/no-deps/-/no-deps-1.0.0.tgz`);
    using dir = tempDir("registry-path-scoped-auth", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${registry.port}/npm/team-a/"
`,
      ".npmrc": `//127.0.0.1:${registry.port}/npm/:_authToken=npm-wide\n`,
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(received).toEqual([
      { path: "/npm/team-a/no-deps", authorization: "Bearer npm-wide" },
      { path: "/npm/team-a/no-deps/-/no-deps-1.0.0.tgz", authorization: "Bearer npm-wide" },
    ]);
  });

  it("an npmrc entry written without a port does not cover a non-default port", async () => {
    const received: Received[] = [];
    await using registry = serveRegistry(received, origin => `${origin}/prefix-b/no-deps-1.0.0.tgz`);
    using dir = tempDir("registry-path-scoped-auth", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${registry.port}/prefix-a/"
`,
      ".npmrc": `//127.0.0.1/prefix-b/:_authToken=portless\n`,
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(received.map(r => r.authorization)).toEqual([null, null]);
  });

  it("a registry configured at the host root still authenticates every path on it", async () => {
    const received: Received[] = [];
    await using registry = serveRegistry(received, origin => `${origin}/some/where/else/no-deps-1.0.0.tgz`);
    using dir = tempDir("registry-path-scoped-auth", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = { url = "http://127.0.0.1:${registry.port}", token = "root-token" }
`,
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(received.map(r => r.authorization)).toEqual(["Bearer root-token", "Bearer root-token"]);
  });
});

describe.concurrent("install.allowedHosts", () => {
  it("refuses a tarball on a host that is not listed, without contacting it", async () => {
    const received: Received[] = [];
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    const tarballUrl = `http://127.0.0.1:${elsewhere.port}/no-deps/-/no-deps-1.0.0.tgz`;
    await using registry = serveRegistry(received, () => tarballUrl);
    using dir = tempDir("allowed-hosts", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${registry.port}/"
allowedHosts = []
`,
    });

    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain(
      `error: Refusing to download "${tarballUrl}" for package "no-deps": host is not in install.allowedHosts`,
    );
    expect(stderr).not.toContain("Saved lockfile");
    expect(stderr).not.toContain("internal error");
    expect(exitCode).toBe(1);
    // the manifest came from the (implicitly allowed) registry host ...
    expect(received.map(r => r.path)).toEqual(["/no-deps"]);
    // ... and the foreign host was never contacted
    expect(elsewhereReceived).toEqual([]);
  });

  describe.each([
    ["host:port", (port: number) => `["127.0.0.1:${port}"]`],
    ["a bare hostname (any port)", () => `["127.0.0.1"]`],
    ["one of several entries", (port: number) => `["registry.example.com", "127.0.0.1:${port}", "[::1]:1"]`],
  ])("a tarball host listed as %s", (_, entry) => {
    it("is allowed", async () => {
      const received: Received[] = [];
      const elsewhereReceived: Received[] = [];
      await using elsewhere = serveElsewhere(elsewhereReceived);
      await using registry = serveRegistry(
        received,
        () => `http://127.0.0.1:${elsewhere.port}/no-deps/-/no-deps-1.0.0.tgz`,
      );
      using dir = tempDir("allowed-hosts", {
        "package.json": packageJson,
        "bunfig.toml": `
[install]
cache = false
registry = { url = "http://localhost:${registry.port}/", token = "registry-token" }
allowedHosts = ${entry(elsewhere.port)}
`,
      });

      const { stdout, stderr, exitCode } = await install(String(dir));
      expect(stderr).toContain("Saved lockfile");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
      // allowed to fetch, but being on the list does not earn the registry's token
      expect(elsewhereReceived).toEqual([{ path: "/no-deps/-/no-deps-1.0.0.tgz", authorization: null }]);
    });
  });

  // An allowed host must not be able to bounce the install to an unlisted one:
  // the allow-list is re-applied to every redirect hop before it is followed.
  describe.each(["manifest", "tarball"] as const)("a %s redirect to a host that is not listed", which => {
    it("is refused without contacting it", async () => {
      const elsewhereReceived: Received[] = [];
      await using elsewhere = serveElsewhere(elsewhereReceived);
      const received: Received[] = [];
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          const url = new URL(req.url);
          received.push({ path: url.pathname, authorization: req.headers.get("authorization") });
          const origin = `http://127.0.0.1:${registry.port}`;
          const elsewhereOrigin = `http://127.0.0.1:${elsewhere.port}`;
          if (url.pathname === "/no-deps") {
            if (which === "manifest") return Response.redirect(`${elsewhereOrigin}/no-deps`, 302);
            return Response.json({
              name: "no-deps",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": {
                  name: "no-deps",
                  version: "1.0.0",
                  dist: { integrity, tarball: `${origin}/no-deps/-/no-deps-1.0.0.tgz` },
                },
              },
            });
          }
          if (url.pathname === "/no-deps/-/no-deps-1.0.0.tgz") {
            return Response.redirect(`${elsewhereOrigin}/no-deps-1.0.0.tgz`, 302);
          }
          return new Response("not found", { status: 404 });
        },
      });
      using dir = tempDir("allowed-hosts", {
        "package.json": packageJson,
        "bunfig.toml": `
[install]
cache = false
registry = { url = "http://127.0.0.1:${registry.port}/", token = "registry-token" }
allowedHosts = []
`,
      });

      const { stderr, exitCode } = await install(String(dir));
      expect(stderr).toContain(
        which === "manifest"
          ? "RedirectHostNotAllowed downloading package manifest no-deps"
          : "RedirectHostNotAllowed downloading tarball no-deps@1.0.0",
      );
      expect(exitCode).toBe(1);
      // one attempt, not retried, and the redirect target never contacted
      expect(
        received.filter(r => r.path === (which === "manifest" ? "/no-deps" : "/no-deps/-/no-deps-1.0.0.tgz")),
      ).toHaveLength(1);
      expect(elsewhereReceived).toEqual([]);
    });

    it("is followed once the host is listed, without the registry's token", async () => {
      const elsewhereReceived: Received[] = [];
      await using elsewhere = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          const url = new URL(req.url);
          elsewhereReceived.push({ path: url.pathname, authorization: req.headers.get("authorization") });
          if (url.pathname === "/no-deps") {
            return Response.json({
              name: "no-deps",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": {
                  name: "no-deps",
                  version: "1.0.0",
                  dist: { integrity, tarball: `http://127.0.0.1:${elsewhere.port}/no-deps-1.0.0.tgz` },
                },
              },
            });
          }
          return new Response(Bun.file(tgz));
        },
      });
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          const url = new URL(req.url);
          const origin = `http://127.0.0.1:${registry.port}`;
          const elsewhereOrigin = `http://127.0.0.1:${elsewhere.port}`;
          if (url.pathname === "/no-deps") {
            if (which === "manifest") return Response.redirect(`${elsewhereOrigin}/no-deps`, 302);
            return Response.json({
              name: "no-deps",
              "dist-tags": { latest: "1.0.0" },
              versions: {
                "1.0.0": {
                  name: "no-deps",
                  version: "1.0.0",
                  dist: { integrity, tarball: `${origin}/no-deps/-/no-deps-1.0.0.tgz` },
                },
              },
            });
          }
          if (url.pathname === "/no-deps/-/no-deps-1.0.0.tgz") {
            return Response.redirect(`${elsewhereOrigin}/no-deps-1.0.0.tgz`, 302);
          }
          return new Response("not found", { status: 404 });
        },
      });
      using dir = tempDir("allowed-hosts", {
        "package.json": packageJson,
        "bunfig.toml": `
[install]
cache = false
registry = { url = "http://127.0.0.1:${registry.port}/", token = "registry-token" }
allowedHosts = ["127.0.0.1:${elsewhere.port}"]
`,
      });

      const { stdout, stderr, exitCode } = await install(String(dir));
      expect(stderr).toContain("Saved lockfile");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
      expect(elsewhereReceived.length).toBeGreaterThan(0);
      expect(elsewhereReceived.every(r => r.authorization === null)).toBeTrue();
    });
  });

  it("does not match a listed host on a different port", async () => {
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    await using registry = serveRegistry([], () => `http://127.0.0.1:${elsewhere.port}/no-deps-1.0.0.tgz`);
    using dir = tempDir("allowed-hosts", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${registry.port}/"
allowedHosts = ["127.0.0.1:${registry.port}"]
`,
    });

    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("host is not in install.allowedHosts");
    expect(exitCode).toBe(1);
    expect(elsewhereReceived).toEqual([]);
  });

  it("is off when unset: tarballs may come from any host", async () => {
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    await using registry = serveRegistry([], () => `http://127.0.0.1:${elsewhere.port}/no-deps-1.0.0.tgz`);
    using dir = tempDir("allowed-hosts", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:${registry.port}/"
`,
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(elsewhereReceived.map(r => r.path)).toEqual(["/no-deps-1.0.0.tgz"]);
  });

  it("refuses git dependencies on hosts that are not listed", async () => {
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived, 404);
    using dir = tempDir("allowed-hosts", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { repo: `git+http://127.0.0.1:${elsewhere.port}/someone/repo.git` },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:1/"
allowedHosts = []
`,
    });

    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain(
      `error: Refusing to clone git dependency "repo" from "127.0.0.1:${elsewhere.port}": host is not in install.allowedHosts`,
    );
    expect(exitCode).toBe(1);
    expect(elsewhereReceived).toEqual([]);
  });

  it("refuses a tarball URL dependency on a host that is not listed", async () => {
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    const tarballUrl = `http://127.0.0.1:${elsewhere.port}/no-deps-1.0.0.tgz`;
    using dir = tempDir("allowed-hosts", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": tarballUrl } }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:1/"
allowedHosts = []
`,
    });

    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain(
      `error: Refusing to download "${tarballUrl}" for package "no-deps": host is not in install.allowedHosts`,
    );
    expect(stderr).not.toContain("internal error");
    expect(exitCode).toBe(1);
    expect(elsewhereReceived).toEqual([]);
  });

  it("an optional dependency whose manifest host is not listed also fails the install", async () => {
    // Only reachable through a rewrite (registries are implicitly allowed);
    // must fail closed like the tarball case.
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    await using registry = serveRegistry([], origin => `${origin}/no-deps/-/no-deps-1.0.0.tgz`);
    using dir = tempDir("allowed-hosts", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", optionalDependencies: { "no-deps": "1.0.0" } }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${registry.port}/"
allowedHosts = []
rewrite = [{ from = "http://127.0.0.1:${registry.port}/", to = "http://127.0.0.1:${elsewhere.port}/" }]
`,
    });

    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain(
      `error: Refusing to fetch manifest "http://127.0.0.1:${elsewhere.port}/no-deps" for package "no-deps": host is not in install.allowedHosts`,
    );
    expect(exitCode).toBe(1);
    expect(elsewhereReceived).toEqual([]);
  });

  it("an optional dependency whose tarball host is not listed also fails the install", async () => {
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    const tarballUrl = `http://127.0.0.1:${elsewhere.port}/no-deps/-/no-deps-1.0.0.tgz`;
    await using registry = serveRegistry([], () => tarballUrl);
    using dir = tempDir("allowed-hosts", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", optionalDependencies: { "no-deps": "1.0.0" } }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${registry.port}/"
allowedHosts = []
`,
    });

    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain(
      `error: Refusing to download "${tarballUrl}" for package "no-deps": host is not in install.allowedHosts`,
    );
    expect(stderr).not.toContain("internal error");
    expect(exitCode).toBe(1);
    expect(elsewhereReceived).toEqual([]);
    expect(existsSync(join(String(dir), "node_modules", "no-deps"))).toBeFalse();
  });

  it("a package that is optional for one dependent and required for another is refused once", async () => {
    // Whichever edge is seen first, the refusal is one error and the install
    // fails; the second edge must neither downgrade nor repeat it.
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    const pkgs = join(import.meta.dir, "registry", "packages");
    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        const origin = `http://127.0.0.1:${registry.port}`;
        if (url.pathname === "/one-dep") {
          // one-dep@1.0.0 depends on no-deps@1.0.1; its own tarball is on the registry
          return Response.json({
            name: "one-dep",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "one-dep",
                version: "1.0.0",
                dependencies: { "no-deps": "1.0.1" },
                dist: { tarball: `${origin}/one-dep/-/one-dep-1.0.0.tgz` },
              },
            },
          });
        }
        if (url.pathname === "/no-deps") {
          return Response.json({
            name: "no-deps",
            "dist-tags": { latest: "1.0.1" },
            versions: {
              "1.0.1": {
                name: "no-deps",
                version: "1.0.1",
                dist: { tarball: `http://127.0.0.1:${elsewhere.port}/no-deps/-/no-deps-1.0.1.tgz` },
              },
            },
          });
        }
        if (url.pathname === "/one-dep/-/one-dep-1.0.0.tgz") {
          return new Response(Bun.file(join(pkgs, "one-dep", "one-dep-1.0.0.tgz")));
        }
        return new Response("not found", { status: 404 });
      },
    });
    using dir = tempDir("allowed-hosts", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "one-dep": "1.0.0" },
        optionalDependencies: { "no-deps": "1.0.1" },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${registry.port}/"
allowedHosts = []
`,
    });

    const { stderr, exitCode } = await install(String(dir));
    const refusal = `error: Refusing to download "http://127.0.0.1:${elsewhere.port}/no-deps/-/no-deps-1.0.1.tgz" for package "no-deps": host is not in install.allowedHosts`;
    expect(stderr).toContain(refusal);
    expect(stderr.split(refusal).length - 1).toBe(1);
    expect(exitCode).toBe(1);
    expect(elsewhereReceived).toEqual([]);
  });

  it("a host allowed only on the ssh port still gets the ssh attempt", async () => {
    // `git@host:path` is tried over https first (port 443, not allowed here)
    // and then over ssh (port 22, allowed). The https form must be skipped
    // quietly rather than failing the dependency; the ssh attempt is made to
    // fail fast so no real connection is needed.
    using dir = tempDir("allowed-hosts", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { repo: "git@git.example.invalid:someone/repo.git" },
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://localhost:1/"
allowedHosts = ["git.example.invalid:22"]
`,
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, GIT_SSH_COMMAND: "false", GIT_TERMINAL_PROMPT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("Refusing to clone");
    expect(stderr).toContain(`"git clone" for "repo" failed`);
    expect(exitCode).toBe(1);
  });

  it("rejects entries that are not host[:port]", async () => {
    using dir = tempDir("allowed-hosts", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
allowedHosts = ["https://registry.example.com/npm/"]
`,
    });

    const { stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain(`Expected a hostname or "hostname:port" (not a URL) in allowedHosts`);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("install.rewrite", () => {
  it("fetches tarballs from the rewritten URL but records the canonical URL in bun.lock", async () => {
    // "canonical" is where the manifest (and therefore bun.lock) says the
    // tarball lives; it must never be contacted. The mirror is a path on the
    // registry server.
    const canonicalReceived: Received[] = [];
    await using canonical = serveElsewhere(canonicalReceived, 500);
    const received: Received[] = [];
    await using registry = serveRegistry(
      received,
      () => `http://127.0.0.1:${canonical.port}/no-deps/-/no-deps-1.0.0.tgz`,
    );
    using dir = tempDir("install-rewrite", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = { url = "http://127.0.0.1:${registry.port}/", token = "mirror-token" }

[[install.rewrite]]
from = "http://127.0.0.1:${canonical.port}/"
to = "http://127.0.0.1:${registry.port}/not-specific-enough/"

[[install.rewrite]]
from = "http://127.0.0.1:${canonical.port}/no-deps/"
to = "http://127.0.0.1:${registry.port}/mirror/no-deps/"
`,
    });

    {
      const { stdout, stderr, exitCode } = await install(String(dir));
      expect(stderr).toContain("Saved lockfile");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
    }
    // longest matching `from` wins; the rewritten URL is under the registry, so
    // it carries the registry's credentials
    expect(received.filter(r => r.path.endsWith(".tgz"))).toEqual([
      { path: "/mirror/no-deps/-/no-deps-1.0.0.tgz", authorization: "Bearer mirror-token" },
    ]);
    expect(canonicalReceived).toEqual([]);

    const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockfile).toContain(`http://127.0.0.1:${canonical.port}/no-deps/-/no-deps-1.0.0.tgz`);
    expect(lockfile).not.toContain("/mirror/");

    // a frozen install from that lockfile goes through the rewrite again
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });
    received.length = 0;
    {
      const { stdout, stderr, exitCode } = await install(String(dir), "--frozen-lockfile");
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
    }
    expect(received).toEqual([{ path: "/mirror/no-deps/-/no-deps-1.0.0.tgz", authorization: "Bearer mirror-token" }]);
    expect(canonicalReceived).toEqual([]);
    expect(await Bun.file(join(String(dir), "bun.lock")).text()).toBe(lockfile);
  });

  it("credentials and allowedHosts are judged against the rewritten URL", async () => {
    // The registry (with a token) points tarballs at itself; the rewrite sends
    // them to another host. That host is on the allow-list, so the download
    // proceeds — but it is not under the registry URL, so no token.
    const elsewhereReceived: Received[] = [];
    await using elsewhere = serveElsewhere(elsewhereReceived);
    const received: Received[] = [];
    await using registry = serveRegistry(received, origin => `${origin}/no-deps/-/no-deps-1.0.0.tgz`);
    using dir = tempDir("install-rewrite", {
      "package.json": packageJson,
      "bunfig.toml": `
[install]
cache = false
registry = { url = "http://127.0.0.1:${registry.port}/", token = "registry-token" }
allowedHosts = ["127.0.0.1:${elsewhere.port}"]
rewrite = [
  { from = "http://127.0.0.1:${registry.port}/no-deps/-/", to = "http://127.0.0.1:${elsewhere.port}/tarballs/" },
]
`,
    });

    const { stdout, stderr, exitCode } = await install(String(dir));
    expect(stderr).toContain("Saved lockfile");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(received).toEqual([{ path: "/no-deps", authorization: "Bearer registry-token" }]);
    expect(elsewhereReceived).toEqual([{ path: "/tarballs/no-deps-1.0.0.tgz", authorization: null }]);
  });
});
