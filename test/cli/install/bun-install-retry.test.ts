import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { access, mkdir, readdir, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tmpdirSync, toBeValidBin, toBeWorkspaceLink, toHaveBins } from "harness";
import { join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  requested,
  root_url,
  setContextHandler,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

expect.extend({
  toHaveBins,
  toBeValidBin,
  toBeWorkspaceLink,
});

let port: string;
let add_dir: string;
setDefaultTimeout(1000 * 60 * 5);

beforeAll(() => {
  port = new URL(root_url).port;
});

beforeEach(async () => {
  add_dir = tmpdirSync();
  await dummyBeforeEach();
});
afterEach(async () => {
  await dummyAfterEach();
});

// Manifest request 302-redirects and the redirect target answers a retryable
// 500 once. The install retry must restart from the original manifest URL.
it("retries a manifest whose redirect target 500s once", async () => {
  const urls: string[] = [];
  let redirectTargetHits = 0;
  setHandler(async request => {
    const { pathname } = new URL(request.url);
    urls.push(pathname);
    if (pathname === "/BaR") {
      return new Response(null, { status: 302, headers: { Location: `${root_url}/redirected/BaR` } });
    }
    if (pathname === "/redirected/BaR") {
      if (redirectTargetHits++ === 0) {
        return new Response("transient", { status: 500 });
      }
      return Response.json({
        name: "BaR",
        versions: {
          "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
        },
        "dist-tags": { latest: "0.0.2" },
      });
    }
    if (pathname === "/BaR-0.0.2.tgz") {
      return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
    }
    return new Response("unexpected", { status: 404 });
  });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("1 package installed");
  expect(exitCode).toBe(0);
  // The retry restarts from the original manifest URL, so the server sees the
  // whole redirect chain a second time.
  expect(urls).toEqual(["/BaR", "/redirected/BaR", "/BaR", "/redirected/BaR", "/BaR-0.0.2.tgz"]);
  expect(await file(join(package_dir, "node_modules", "BaR", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
});

// A cross-origin redirect strips Authorization from the request (per the fetch
// spec). The install retry restarts from the original registry URL and must
// carry the original headers, including Authorization, again.
it("retries an authorized manifest whose cross-origin redirect target 500s once", async () => {
  const token = "test-registry-token";
  const registryUrls: string[] = [];
  const cdnAuth: (string | null)[] = [];
  let cdnHits = 0;
  // A second server on its own port stands in for the CDN the registry
  // redirects to; a different port makes the redirect cross-origin.
  await using cdn = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/cdn/BaR") {
        return new Response("unexpected", { status: 404 });
      }
      cdnAuth.push(request.headers.get("authorization"));
      if (cdnHits++ === 0) {
        return new Response("transient", { status: 500 });
      }
      return Response.json({
        name: "BaR",
        versions: {
          "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
        },
        "dist-tags": { latest: "0.0.2" },
      });
    },
  });
  setHandler(async request => {
    const { pathname } = new URL(request.url);
    registryUrls.push(pathname);
    if (pathname === "/BaR") {
      // The registry requires the token on every request, including the retry.
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("missing authorization", { status: 401 });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: `http://localhost:${cdn.port}/cdn/BaR` },
      });
    }
    if (pathname === "/BaR-0.0.2.tgz") {
      return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
    }
    return new Response("unexpected", { status: 404 });
  });
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: false,
        registry: { url: `${root_url}/`, token },
        saveTextLockfile: false,
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("1 package installed");
  expect(exitCode).toBe(0);
  // Both registry hits carried the token (the handler 401s otherwise); the
  // cross-origin CDN hops must NOT have (the spec strips it for that hop).
  expect(registryUrls).toEqual(["/BaR", "/BaR", "/BaR-0.0.2.tgz"]);
  expect(cdnAuth).toEqual([null, null]);
});

// Sibling retry site (tarball downloads in runTasks): the tarball URL
// 302-redirects and the target 500s once before serving the archive.
it("retries a tarball whose redirect target 500s once", async () => {
  const urls: string[] = [];
  let redirectTargetHits = 0;
  setHandler(async request => {
    const { pathname } = new URL(request.url);
    urls.push(pathname);
    if (pathname === "/BaR") {
      return Response.json({
        name: "BaR",
        versions: {
          "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
        },
        "dist-tags": { latest: "0.0.2" },
      });
    }
    if (pathname === "/BaR-0.0.2.tgz") {
      return new Response(null, { status: 302, headers: { Location: `${root_url}/redirected/BaR-0.0.2.tgz` } });
    }
    if (pathname === "/redirected/BaR-0.0.2.tgz") {
      if (redirectTargetHits++ === 0) {
        return new Response("transient", { status: 500 });
      }
      return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
    }
    return new Response("unexpected", { status: 404 });
  });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("1 package installed");
  expect(exitCode).toBe(0);
  expect(urls).toEqual([
    "/BaR",
    "/BaR-0.0.2.tgz",
    "/redirected/BaR-0.0.2.tgz",
    "/BaR-0.0.2.tgz",
    "/redirected/BaR-0.0.2.tgz",
  ]);
  expect(await file(join(package_dir, "node_modules", "BaR", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
});

it("retries on 500", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, undefined, 4));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "BaR", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
  ]);
  expect(requested).toBe(12);
  await Promise.all([
    (async () => expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "BaR"]))(),
    (async () => expect(await readdirSorted(join(package_dir, "node_modules", "BaR"))).toEqual(["package.json"]))(),
    (async () =>
      expect(await file(join(package_dir, "node_modules", "BaR", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      }))(),
    (async () =>
      expect(await file(join(package_dir, "package.json")).text()).toEqual(
        JSON.stringify(
          {
            name: "foo",
            version: "0.0.1",
            dependencies: {
              BaR: "^0.0.2",
            },
          },
          null,
          2,
        ),
      ))(),
    async () => await access(join(package_dir, "bun.lockb")),
  ]);
});

// A tarball that fails permanently must run its download (and retry cycle)
// exactly once and be reported as exactly one error. Previously the resolve
// phase's failure dropped the dedupe entry so the install phase re-ran the
// entire download: a 500 endpoint saw 12 GETs instead of 6 and the same
// `error: GET ...` line was printed twice.
describe.each(["hoisted", "isolated"])("linker=%s", linker => {
  it.each([
    { status: 404, expectedGets: 1 },
    { status: 500, expectedGets: 6 },
  ])("does not re-download a tarball that already failed with $status", async ({ status, expectedGets }) => {
    const urls: string[] = [];
    setHandler(async request => {
      const { pathname } = new URL(request.url);
      urls.push(pathname);
      if (pathname === "/BaR") {
        return Response.json({
          name: "BaR",
          "dist-tags": { latest: "0.0.2" },
          versions: {
            "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
          },
        });
      }
      if (pathname === "/BaR-0.0.2.tgz") {
        return new Response("no", { status });
      }
      return new Response("unexpected", { status: 404 });
    });
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: false,
          registry: `${root_url}/`,
          linker,
        },
      }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
    );
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--no-progress", "--ignore-scripts"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

    const tarballGets = urls.filter(u => u === "/BaR-0.0.2.tgz");
    const errorLines = err.split("\n").filter(l => l.startsWith("error:"));
    expect({ tarballGets: tarballGets.length, errorLines }).toEqual({
      tarballGets: expectedGets,
      errorLines: [`error: GET ${root_url}/BaR-0.0.2.tgz - ${status}`],
    });
    expect(out).not.toContain("installed");
    expect(exitCode).toBe(1);
  });

  it("does not re-download an optional dependency's tarball that already failed", async () => {
    const urls: string[] = [];
    setHandler(async request => {
      const { pathname } = new URL(request.url);
      urls.push(pathname);
      if (pathname === "/BaR") {
        return Response.json({
          name: "BaR",
          "dist-tags": { latest: "0.0.2" },
          versions: {
            "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
          },
        });
      }
      if (pathname === "/BaR-0.0.2.tgz") return new Response("no", { status: 404 });
      if (pathname === "/baz") {
        return Response.json({
          name: "baz",
          "dist-tags": { latest: "0.0.3" },
          versions: {
            "0.0.3": { name: "baz", version: "0.0.3", dist: { tarball: `${root_url}/baz-0.0.3.tgz` } },
          },
        });
      }
      if (pathname === "/baz-0.0.3.tgz") return new Response(file(join(import.meta.dir, "baz-0.0.3.tgz")));
      return new Response("unexpected", { status: 404 });
    });
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: false,
          registry: `${root_url}/`,
          linker,
        },
      }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: { baz: "0.0.3" },
        optionalDependencies: { BaR: "0.0.2" },
      }),
    );
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--no-progress", "--ignore-scripts"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

    const tarballGets = urls.filter(u => u === "/BaR-0.0.2.tgz");
    const warnLines = err.split("\n").filter(l => l.startsWith("warn:"));
    const errorLines = err.split("\n").filter(l => l.startsWith("error:"));
    expect({ tarballGets: tarballGets.length, warnLines, errorLines }).toEqual({
      tarballGets: 1,
      warnLines: [`warn: GET ${root_url}/BaR-0.0.2.tgz - 404`],
      errorLines: [],
    });
    expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
      name: "baz",
      version: "0.0.3",
    });
    if (linker === "hoisted") {
      expect(out).not.toContain("Failed to install");
      expect(exitCode).toBe(0);
    }
  });

  // One download serves every dependency on a package. When one of them is
  // required, its failure must fail the install, whichever of them asked first.
  describe.concurrent("a failed download that an optional and a required dependency share", () => {
    const packageTarball = (name: string, pkg: object) =>
      new Bun.Archive(
        { "package/package.json": JSON.stringify({ name, version: "1.0.0", ...pkg }) },
        { compress: "gzip" },
      ).bytes();

    // A project with a registry prefix of its own, so these tests run together. The
    // registry has baz@0.0.3, whose tarball can fail, baz@0.0.5, and `packages` at 1.0.0.
    async function project(packages: Record<string, object> = {}) {
      const ctx = await createTestContext({ linker: linker as "hoisted" | "isolated" });
      const dir = ctx.package_dir;
      const registry = ctx.registry_url.slice(0, -1);
      const tarball = `${registry}/baz-0.0.3.tgz`;
      /** How many of the next requests for `tarball` get a 404. */
      let failures = 0;
      let tarballGets = 0;
      const tarballFailed = Promise.withResolvers<void>();
      const routes = new Map<string, () => Response | Promise<Response>>();
      for (const [name, pkg] of Object.entries(packages)) {
        const packed = await packageTarball(name, pkg);
        routes.set(`/${name}-1.0.0.tgz`, () => new Response(packed));
      }
      const manifest = (name: string, versions: Record<string, object>) =>
        Response.json({
          name,
          "dist-tags": { latest: Object.keys(versions)[0] },
          versions: Object.fromEntries(
            Object.entries(versions).map(([version, pkg]) => [
              version,
              { name, version, ...pkg, dist: { tarball: `${registry}/${name}-${version}.tgz` } },
            ]),
          ),
        });
      setContextHandler(ctx, request => {
        const pathname = new URL(request.url).pathname.slice(`/${ctx.id}`.length);
        const name = pathname.slice(1);
        if (name === "baz") return manifest("baz", { "0.0.3": {}, "0.0.5": {} });
        if (name in packages) return manifest(name, { "1.0.0": packages[name] });
        if (name === "baz-0.0.5.tgz") return new Response(file(join(import.meta.dir, name)));
        if (name !== "baz-0.0.3.tgz") return routes.get(pathname)?.() ?? new Response("unexpected", { status: 404 });
        tarballGets++;
        if (failures === 0) return new Response(file(join(import.meta.dir, name)));
        failures--;
        queueMicrotask(tarballFailed.resolve);
        return new Response("no", { status: 404 });
      });
      await writeFile(
        join(dir, "bunfig.toml"),
        Bun.TOML.stringify({ install: { cache: false, registry: ctx.registry_url, linker } }),
      );

      // The isolated linker names the package by its resolution: a version, or the tarball URL.
      const errorLine = (resolution: string) =>
        linker === "hoisted"
          ? `error: GET ${tarball} - 404`
          : `error: failed to download baz@${resolution}: 404 Not Found`;
      return {
        dir,
        registry,
        tarball,
        routes,
        tarballFailed: tarballFailed.promise,
        [Symbol.dispose]: () => destroyTestContext(ctx),

        async install(pkg: object, ...args: string[]) {
          await writeFile(join(dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1", ...pkg }));
          await using proc = spawn({
            cmd: [bunExe(), "install", "--no-progress", "--ignore-scripts", ...args],
            cwd: dir,
            stdout: "ignore",
            stderr: "pipe",
            env,
          });
          const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
          const lines = err.split(/\r?\n/);
          return {
            warnLines: lines.filter(l => l.startsWith("warn:")),
            errorLines: lines.filter(l => l.startsWith("error:")),
            tarballGets,
            exitCode,
          };
        },
        // `cache: false` keeps the cache in node_modules/.cache, so this also empties the cache.
        async failTarballOnColdCache(times = Infinity) {
          await rm(join(dir, "node_modules"), { recursive: true, force: true });
          failures = times;
          tarballGets = 0;
        },
        failTarball() {
          failures = Infinity;
        },

        installed: { warnLines: [], errorLines: [], tarballGets: 1, exitCode: 0 },
        // The download failed for optional dependencies only.
        warned: { warnLines: [`warn: GET ${tarball} - 404`], errorLines: [], tarballGets: 1, exitCode: 0 },
        // The download failed once, for the required dependency.
        failed: (resolution = tarball) => ({
          warnLines: [],
          errorLines: [errorLine(resolution)],
          tarballGets: 1,
          exitCode: 1,
        }),
        // The download failed for an optional dependency first (a warning), then again for the required one.
        failedAgain: (resolution = tarball) => ({
          warnLines: [`warn: GET ${tarball} - 404`],
          errorLines: [errorLine(resolution)],
          tarballGets: 2,
          exitCode: 1,
        }),
      };
    }

    // The lockfile resolves `a`, so only the new `b` asks for the tarball while
    // resolving: a warning. The installer then asks for it again for `a`.
    it("reports the required one after the optional one's download failed", async () => {
      using t = await project();
      expect(await t.install({ dependencies: { a: t.tarball } })).toEqual(t.installed);
      await t.failTarballOnColdCache();
      expect(await t.install({ dependencies: { a: t.tarball }, optionalDependencies: { b: t.tarball } })).toEqual(
        t.failedAgain(),
      );
    });

    // The failure that `b` got is not `a`'s: `a` downloads again, and this time it works.
    it("installs the required one when its own download succeeds", async () => {
      using t = await project();
      expect(await t.install({ dependencies: { a: t.tarball } })).toEqual(t.installed);
      await t.failTarballOnColdCache(1);
      expect(await t.install({ dependencies: { a: t.tarball }, optionalDependencies: { b: t.tarball } })).toEqual({
        warnLines: [`warn: GET ${t.tarball} - 404`],
        errorLines: [],
        tarballGets: 2,
        exitCode: 0,
      });
      expect(await file(join(t.dir, "node_modules", "a", "package.json")).json()).toMatchObject({ name: "baz" });
    });

    // The lockfile resolves both. optionalDependencies sort first, so the installer
    // starts the download for `b` and `a` joins it.
    it("reports the required one when it joins the optional one's download", async () => {
      using t = await project();
      const pkg = { dependencies: { a: t.tarball }, optionalDependencies: { b: t.tarball } };
      expect(await t.install(pkg)).toEqual(t.installed);
      await t.failTarballOnColdCache();
      expect(await t.install(pkg)).toEqual(t.failed());
    });

    // No lockfile. Both aliases resolve to baz@0.0.3, and `b` resolves it first, so
    // the download that fails while resolving is a warning.
    it("reports the required alias of an npm package after the optional alias's download failed", async () => {
      using t = await project();
      t.failTarball();
      expect(
        await t.install({ dependencies: { a: "npm:baz@0.0.3" }, optionalDependencies: { b: "npm:baz@0.0.3" } }),
      ).toEqual(t.failedAgain("0.0.3"));
    });

    // `d` arrives after the tarball's 404, so its optional dependency `c` asks for
    // the tarball once it has failed: that callback stays queued and nothing runs
    // it. The download for `a` must start again, not wait behind it.
    it("reports the required one when a callback is still queued for the failed download", async () => {
      using t = await project();
      const d = await packageTarball("d", { optionalDependencies: { c: t.tarball } });
      t.routes.set("/d.tgz", async () => {
        await t.tarballFailed;
        return new Response(d);
      });

      expect(await t.install({ dependencies: { a: t.tarball } })).toEqual(t.installed);
      await t.failTarballOnColdCache();
      expect(
        await t.install({
          dependencies: { a: t.tarball, d: `${t.registry}/d.tgz` },
          optionalDependencies: { b: t.tarball },
        }),
      ).toEqual(t.failedAgain());
    });

    // Peers resolve after everything else, so `p` asks for the tarball once it has
    // failed for `b`. That failure stays the warning it was reported as.
    it("reports the required one when a peer asked for the failed download in between", async () => {
      using t = await project();
      expect(await t.install({ dependencies: { a: t.tarball } })).toEqual(t.installed);
      await t.failTarballOnColdCache();
      expect(
        await t.install({
          dependencies: { a: t.tarball },
          optionalDependencies: { b: t.tarball },
          peerDependencies: { p: t.tarball },
        }),
      ).toEqual(t.failedAgain());
    });

    // node_modules has one baz for both dependencies on it, and the linker asks for
    // it through the first one: the root's optional dependency.
    describe("when the optional dependency is the one the linker asks through", () => {
      const pkg = { dependencies: { bar: "1.0.0" }, optionalDependencies: { baz: "0.0.3" } };
      const bar = { bar: { dependencies: { baz: "0.0.3" } } };

      it("reports the required one on a fresh install", async () => {
        using t = await project(bar);
        t.failTarball();
        expect(await t.install(pkg)).toEqual(t.failedAgain("0.0.3"));
      });

      it("reports the required one from the lockfile on a cold cache", async () => {
        using t = await project(bar);
        expect(await t.install(pkg)).toEqual(t.installed);
        await t.failTarballOnColdCache();
        expect(await t.install(pkg)).toEqual(t.failed("0.0.3"));
      });

      // The same question decides whether a package that --offline cannot find is an error.
      it("reports the required one that --offline does not find in the cache", async () => {
        using t = await project(bar);
        expect(await t.install(pkg)).toEqual(t.installed);
        // bar stays installed and cached. baz leaves node_modules and the cache in it.
        const node_modules = join(t.dir, "node_modules");
        for (const store of [".", ".bun", ".cache"]) {
          for (const entry of await readdir(join(node_modules, store)).catch(() => [])) {
            if (entry.startsWith("baz")) await rm(join(node_modules, store, entry), { recursive: true, force: true });
          }
        }
        expect(await t.install(pkg, "--offline")).toEqual({
          warnLines: [],
          errorLines: ['error: --offline: "baz" is not in the cache'],
          // still the request of the first install
          tarballGets: 1,
          exitCode: 1,
        });
      });

      // `x` comes first, so its dependency on baz is the one the linker asks through.
      it.each(["optionalDependencies", "dependencies"])(
        "reports the required one when the first of two parents has baz in %s",
        async first => {
          const second = first === "dependencies" ? "optionalDependencies" : "dependencies";
          using t = await project({ x: { [first]: { baz: "0.0.3" } }, y: { [second]: { baz: "0.0.3" } } });
          const parents = { dependencies: { x: "1.0.0", y: "1.0.0" } };
          expect(await t.install(parents)).toEqual(t.installed);
          await t.failTarballOnColdCache();
          expect(await t.install(parents)).toEqual(t.failed("0.0.3"));
        },
      );
    });

    // Nothing that this install links requires baz@0.0.3, so its failed download stays
    // a warning and the install succeeds. Hoisted only: the isolated linker fails the
    // install for every package that it cannot download.
    describe.skipIf(linker === "isolated")("stays a warning", () => {
      it("when only a devDependency requires the package and --production skips it", async () => {
        using t = await project({ bar: { dependencies: { baz: "0.0.3" } } });
        const pkg = { devDependencies: { bar: "1.0.0" }, optionalDependencies: { baz: "0.0.3" } };
        expect(await t.install(pkg)).toEqual(t.installed);
        await t.failTarballOnColdCache();
        expect(await t.install(pkg, "--production")).toEqual(t.warned);
      });

      it("when only a workspace that --filter skips requires the package", async () => {
        using t = await project();
        for (const [name, pkg] of Object.entries({
          opt: { optionalDependencies: { baz: "0.0.3" } },
          req: { dependencies: { baz: "0.0.3" } },
        })) {
          await mkdir(join(t.dir, "packages", name), { recursive: true });
          await writeFile(join(t.dir, "packages", name, "package.json"), JSON.stringify({ name, ...pkg }));
        }
        expect(await t.install({ workspaces: ["packages/*"] })).toEqual(t.installed);
        await t.failTarballOnColdCache();
        expect(await t.install({ workspaces: ["packages/*"] }, "--filter", "opt")).toEqual(t.warned);
      });

      describe.each(["a fresh install", "the lockfile on a cold cache"])("with %s", flow => {
        async function install(t: Awaited<ReturnType<typeof project>>, pkg: object) {
          if (flow === "a fresh install") {
            t.failTarball();
          } else {
            expect(await t.install(pkg)).toEqual(t.installed);
            await t.failTarballOnColdCache();
          }
          return await t.install(pkg);
        }

        // `x` comes first, so its optional peer is the dependency the linker asks through.
        it("when an optional peer and an optional dependency share the package", async () => {
          using t = await project({
            x: { peerDependencies: { baz: "*" }, peerDependenciesMeta: { baz: { optional: true } } },
            y: { optionalDependencies: { baz: "0.0.3" } },
          });
          expect(await install(t, { dependencies: { x: "1.0.0", y: "1.0.0" } })).toEqual(t.warned);
        });

        // x's peer resolves to baz@0.0.3, but the tree gives x the root's baz@0.0.5.
        // Only y's optional dependency links baz@0.0.3.
        it("when a peer resolves to the package and the linker binds it to another one", async () => {
          using t = await project({
            x: { peerDependencies: { baz: "^0.0.3" } },
            y: { optionalDependencies: { baz: "0.0.3" } },
          });
          const pkg = { dependencies: { x: "1.0.0", y: "1.0.0" }, optionalDependencies: { baz: "0.0.5" } };
          expect(await install(t, pkg)).toEqual(t.warned);
        });
      });
    });
  });
});
