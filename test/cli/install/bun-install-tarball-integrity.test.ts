import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { realpath, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tempDir } from "harness";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { dirname, join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./dummy.registry";

setDefaultTimeout(1000 * 60 * 5);

beforeAll(() => {
  dummyBeforeAll();
});

afterAll(dummyAfterAll);

// Helper function that sets up test context and ensures cleanup
async function withContext(
  opts: { linker?: "hoisted" | "isolated" } | undefined,
  fn: (ctx: TestContext) => Promise<void>,
): Promise<void> {
  const ctx = await createTestContext(opts ? { linker: opts.linker! } : undefined);
  try {
    await fn(ctx);
  } finally {
    destroyTestContext(ctx);
  }
}

// Default context options for most tests
const defaultOpts = { linker: "hoisted" as const };

/** A .tgz with the given files under the usual `package/` root. */
function tarball(files: Record<string, Buffer>): Buffer {
  function octal(n: number, width: number) {
    return n.toString(8).padStart(width - 1, "0") + "\0";
  }
  const blocks: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const header = Buffer.alloc(512, 0);
    header.write(`package/${name}`, 0, 100, "utf8");
    header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(body.length, 12), 124);
    header.write(octal(0, 12), 136);
    header.fill(" ", 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(octal(sum, 8), 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

describe.concurrent("tarball integrity", () => {
  it("should store integrity hash for tarball URL in text lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: `${ctx.registry_url}baz-0.0.3.tgz`,
          },
        }),
      );
      await using proc = spawn({
        cmd: [bunExe(), "install", "--save-text-lockfile"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await proc.stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(await proc.exited).toBe(0);

      // Read the text lockfile and verify integrity hash is present for the tarball package
      const lockContent = await file(join(ctx.package_dir, "bun.lock")).text();
      // bun.lock uses trailing commas (not strict JSON), so match with regex
      expect(lockContent).toMatch(/"baz":\s*\[.*"sha512-[A-Za-z0-9+/]+=*"\]/s);
    });
  });

  it("should store integrity hash for local tarball in text lockfile", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: join(import.meta.dir, "baz-0.0.3.tgz"),
          },
        }),
      );
      await using proc = spawn({
        cmd: [bunExe(), "install", "--save-text-lockfile"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await proc.stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(await proc.exited).toBe(0);

      // Read the text lockfile and verify integrity hash is present for the local tarball package
      const lockContent = await file(join(ctx.package_dir, "bun.lock")).text();
      expect(lockContent).toMatch(/"baz":\s*\[.*"sha512-[A-Za-z0-9+/]+=*"\]/s);
    });
  });

  it("should store consistent integrity hash for tarball URL across reinstalls", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: `${ctx.registry_url}baz-0.0.3.tgz`,
          },
        }),
      );

      // First install to generate lockfile with integrity
      {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--save-text-lockfile"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const err = await proc.stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(await proc.exited).toBe(0);
      }

      // Read and verify integrity hash exists
      const lockContent1 = await file(join(ctx.package_dir, "bun.lock")).text();
      const integrityMatch1 = lockContent1.match(/"(sha512-[A-Za-z0-9+/]+=*)"/);
      expect(integrityMatch1).not.toBeNull();
      const integrity1 = integrityMatch1![1];

      // Delete lockfile and node_modules, reinstall from scratch
      await rm(join(ctx.package_dir, "bun.lock"), { force: true });
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });

      {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--save-text-lockfile"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const err = await proc.stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(await proc.exited).toBe(0);
      }

      // Verify the same integrity hash was computed
      const lockContent2 = await file(join(ctx.package_dir, "bun.lock")).text();
      const integrityMatch2 = lockContent2.match(/"(sha512-[A-Za-z0-9+/]+=*)"/);
      expect(integrityMatch2).not.toBeNull();
      expect(integrityMatch2![1]).toBe(integrity1);
    });
  });

  it("should fail integrity check when tarball URL content changes", async () => {
    await withContext(defaultOpts, async ctx => {
      // Serve baz-0.0.3.tgz on first install, then baz-0.0.5.tgz (different content) on second
      let requestCount = 0;
      setContextHandler(ctx, async request => {
        const url = request.url;
        if (url.endsWith(".tgz")) {
          requestCount++;
          // First request: serve baz-0.0.3.tgz, subsequent: serve baz-0.0.5.tgz (different content)
          const tgzFile = requestCount <= 1 ? "baz-0.0.3.tgz" : "baz-0.0.5.tgz";
          return new Response(file(join(import.meta.dir, tgzFile)));
        }
        return new Response("Not found", { status: 404 });
      });
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: `${ctx.registry_url}baz-0.0.3.tgz`,
          },
        }),
      );

      // First install - succeeds, stores integrity hash
      {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--save-text-lockfile"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const err = await proc.stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(await proc.exited).toBe(0);
      }

      // Verify integrity hash was stored
      const lockContent = await file(join(ctx.package_dir, "bun.lock")).text();
      expect(lockContent).toMatch(/"sha512-[A-Za-z0-9+/]+=*"/);

      // Remove node_modules to force re-download
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });

      // Second install - server now returns different tarball, integrity should fail
      {
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const err = await proc.stderr.text();
        const out = await proc.stdout.text();
        expect(err + out).toContain("Integrity check failed");
        expect(await proc.exited).toBe(1);
      }
    });
  });

  it("should install successfully from text lockfile without integrity hash (backward compat)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      // Write a text lockfile WITHOUT integrity hash (old format / backward compat)
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: `${ctx.registry_url}baz-0.0.3.tgz`,
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "bun.lock"),
        JSON.stringify({
          lockfileVersion: 1,
          configVersion: 1,
          workspaces: {
            "": {
              name: "foo",
              dependencies: {
                baz: `${ctx.registry_url}baz-0.0.3.tgz`,
              },
            },
          },
          packages: {
            baz: [`baz@${ctx.registry_url}baz-0.0.3.tgz`, { bin: { "baz-run": "index.js" } }],
          },
        }),
      );

      // Install with the old-format lockfile - should succeed without errors
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await proc.stderr.text();
      const out = await proc.stdout.text();
      // Should not contain any integrity-related errors
      expect(err).not.toContain("Integrity check failed");
      expect(err).not.toContain("error:");
      expect(await proc.exited).toBe(0);
      // Package should be installed
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual([
        ".bun-tag",
        "index.js",
        "package.json",
      ]);
    });
  });

  it("should add integrity hash to lockfile when re-resolving tarball dep", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: `${ctx.registry_url}baz-0.0.3.tgz`,
          },
        }),
      );

      // Fresh install (no existing lockfile) should produce integrity hash
      await using proc = spawn({
        cmd: [bunExe(), "install", "--save-text-lockfile"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await proc.stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(await proc.exited).toBe(0);

      // The newly generated lockfile should have the integrity hash
      const lockContent = await file(join(ctx.package_dir, "bun.lock")).text();
      expect(lockContent).toMatch(/"baz":\s*\[.*"sha512-[A-Za-z0-9+/]+=*"\]/s);
    });
  });

  it("should store consistent integrity hash for local tarball across reinstalls", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: join(import.meta.dir, "baz-0.0.3.tgz"),
          },
        }),
      );

      // First install
      {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--save-text-lockfile"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const err = await proc.stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(await proc.exited).toBe(0);
      }

      const lockContent1 = await file(join(ctx.package_dir, "bun.lock")).text();
      const integrityMatch1 = lockContent1.match(/"(sha512-[A-Za-z0-9+/]+=*)"/);
      expect(integrityMatch1).not.toBeNull();
      const integrity1 = integrityMatch1![1];

      // Delete lockfile and node_modules, reinstall
      await rm(join(ctx.package_dir, "bun.lock"), { force: true });
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });

      {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--save-text-lockfile"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const err = await proc.stderr.text();
        expect(err).toContain("Saved lockfile");
        expect(await proc.exited).toBe(0);
      }

      const lockContent2 = await file(join(ctx.package_dir, "bun.lock")).text();
      const integrityMatch2 = lockContent2.match(/"(sha512-[A-Za-z0-9+/]+=*)"/);
      expect(integrityMatch2).not.toBeNull();
      expect(integrityMatch2![1]).toBe(integrity1);
    });
  });

  it("should produce same integrity hash for same tarball via URL and local path", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      // Install via URL
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: `${ctx.registry_url}baz-0.0.3.tgz`,
          },
        }),
      );

      {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--save-text-lockfile"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        expect(await proc.exited).toBe(0);
      }

      const lockContent1 = await file(join(ctx.package_dir, "bun.lock")).text();
      const integrityMatch1 = lockContent1.match(/"(sha512-[A-Za-z0-9+/]+=*)"/);
      expect(integrityMatch1).not.toBeNull();
      const urlIntegrity = integrityMatch1![1];

      // Clean up
      await rm(join(ctx.package_dir, "bun.lock"), { force: true });
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });

      // Install via local path
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: join(import.meta.dir, "baz-0.0.3.tgz"),
          },
        }),
      );

      {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--save-text-lockfile"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        expect(await proc.exited).toBe(0);
      }

      const lockContent2 = await file(join(ctx.package_dir, "bun.lock")).text();
      const integrityMatch2 = lockContent2.match(/"(sha512-[A-Za-z0-9+/]+=*)"/);
      expect(integrityMatch2).not.toBeNull();
      expect(integrityMatch2![1]).toBe(urlIntegrity);
    });
  });

  it("should install successfully from text lockfile without integrity hash for local tarball (backward compat)", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      const tgzPath = join(import.meta.dir, "baz-0.0.3.tgz");

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            baz: tgzPath,
          },
        }),
      );
      await writeFile(
        join(ctx.package_dir, "bun.lock"),
        JSON.stringify({
          lockfileVersion: 1,
          configVersion: 1,
          workspaces: {
            "": {
              name: "foo",
              dependencies: {
                baz: tgzPath,
              },
            },
          },
          packages: {
            baz: [`baz@${tgzPath}`, { bin: { "baz-run": "index.js" } }],
          },
        }),
      );

      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await proc.stderr.text();
      expect(err).not.toContain("Integrity check failed");
      expect(err).not.toContain("error:");
      expect(await proc.exited).toBe(0);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual([
        ".bun-tag",
        "index.js",
        "package.json",
      ]);
    });
  });
});

// A `file:` path or a URL says where a tarball is, not which bytes it holds: the path
// written in package.json (`pkg.tgz`) names another tarball in every project that
// shares the cache, and both can hold other bytes tomorrow. Only the integrity in
// bun.lock says which bytes were meant, so that names the cache entry. Two projects,
// or two branches of one, get separate entries, an entry is never replaced, and a
// lockfile that does not record an integrity cannot name one and has the tarball read.
// An install that cannot record one either caches that tarball under its path or URL.
describe.concurrent.each(
  (["file:", "URL"] as const).flatMap(kind =>
    (["hoisted", "isolated"] as const).map(linker => [kind, linker] as const),
  ),
)("%s tarball cache entries (%s)", (kind, linker) => {
  async function tarball(exported: string, manifest: object = {}, name = "pkg") {
    const tgz = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ name, version: "1.0.0", ...manifest }),
        "package/index.js": `module.exports = ${JSON.stringify(exported)};\n`,
      },
      { compress: "gzip" },
    ).bytes();
    const digest = createHash("sha512").update(tgz).digest();
    return {
      file: Buffer.from(tgz),
      integrity: "sha512-" + digest.toString("base64"),
      cacheEntry: `@T@sha512-${digest.subarray(0, 16).toString("hex")}@@@1`,
    };
  }
  type Tarball = Awaited<ReturnType<typeof tarball>>;

  /**
   * Projects next to each other that share `cache/`. Each depends on `pkg.tgz`: a file of its own, or the one URL.
   * `put` makes a tarball what that path or URL holds from now on.
   */
  function sandbox(name: string, projects: Record<string, Record<string, string>>) {
    const served = new Map<string, Buffer>();
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        requests.push(pathname);
        const body = served.get(pathname);
        return body ? new Response(body) : new Response("not found", { status: 404 });
      },
    });
    const spec = kind === "URL" ? `${server.url}pkg.tgz` : "file:pkg.tgz";
    const dir = tempDir(
      name,
      Object.fromEntries(
        Object.entries(projects).map(([project, files]) => [
          project,
          {
            "package.json": JSON.stringify({ name: "app", dependencies: { pkg: spec } }),
            "bunfig.toml": Bun.TOML.stringify({ install: { linker } }),
            ...files,
          },
        ]),
      ),
    );
    const root = String(dir);
    const extraEnv: Record<string, string> = {};
    async function run(project: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: join(root, project),
        env: { ...env, BUN_INSTALL_CACHE_DIR: join(root, "cache"), ...extraEnv },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }
    async function ok(project: string, ...args: string[]) {
      const result = await run(project, ...args);
      expect(result.stderr).not.toContain("error:");
      expect(result.exitCode).toBe(0);
      return result;
    }
    return {
      root,
      spec,
      /** The resolution as bun.lock writes it. */
      resolution: kind === "URL" ? spec : "pkg.tgz",
      server,
      served,
      requests,
      /** Added to the environment of every `run`. */
      env: extraEnv,
      run,
      ok,
      put: async (project: string, tgz: Tarball) =>
        kind === "URL" ? void served.set("/pkg.tgz", tgz.file) : writeFile(join(root, project, "pkg.tgz"), tgz.file),
      installed: (project: string, alias = "pkg") =>
        file(join(root, project, "node_modules", alias, "index.js")).text(),
      lockfile: (project: string) => file(join(root, project, "bun.lock")).text(),
      reinstall: (project: string, ...args: string[]) =>
        rm(join(root, project, "node_modules"), { recursive: true }).then(() => ok(project, "install", ...args)),
      cacheEntries: async () => (await readdirSorted(join(root, "cache"))).filter(entry => entry.startsWith("@T@")),
      /** What a project holds: the three must always agree. */
      state: async (project: string) => ({
        installed: await file(join(root, project, "node_modules", "pkg", "index.js")).text(),
        tag: await file(join(root, project, "node_modules", "pkg", ".bun-tag")).text(),
        locked: (Bun.JSONC.parse(await file(join(root, project, "bun.lock")).text()) as any).packages.pkg.at(-1),
      }),
      [Symbol.dispose]() {
        server.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }
  const stateOf = (exported: string, tgz: Tarball) => ({
    installed: `module.exports = ${JSON.stringify(exported)};\n`,
    tag: tgz.integrity,
    locked: tgz.integrity,
  });

  it("keeps the tarballs of two projects that depend on the same path or URL separate", async () => {
    const one = await tarball("one");
    const two = await tarball("two");
    using box = sandbox("tarball-two-projects", { one: {}, two: {} });

    await box.put("one", one);
    await box.ok("one", "install");
    await box.put("two", two);
    await box.ok("two", "install");
    expect(await box.lockfile("one")).toContain(one.integrity);

    await box.reinstall("one");
    expect(await box.installed("one")).toBe('module.exports = "one";\n');
    expect(await box.installed("two")).toBe('module.exports = "two";\n');
    expect(await box.cacheEntries()).toEqual([one.cacheEntry, two.cacheEntry].sort());
  });

  it("installs the tarball the lockfile pins after another build of it was extracted from the same place", async () => {
    const v1 = await tarball("v1");
    const v2 = await tarball("v2");
    using box = sandbox("tarball-two-builds", { app: {} });
    const app = join(box.root, "app");

    await box.put("app", v1);
    await box.ok("app", "install");
    const v1Lockfile = await box.lockfile("app");
    expect(v1Lockfile).toContain(v1.integrity);

    // Like checking out a branch that ships v2: the rebuilt tarball is resolved and extracted.
    await box.put("app", v2);
    await rm(join(app, "bun.lock"));
    await box.reinstall("app");
    expect(await box.installed("app")).toBe('module.exports = "v2";\n');
    expect(await box.lockfile("app")).toContain(v2.integrity);

    // Back on the v1 branch, bun.lock is v1's again. The entry is still there, whatever the path or URL holds now.
    await writeFile(join(app, "bun.lock"), v1Lockfile);
    await box.reinstall("app");
    expect(await box.installed("app")).toBe('module.exports = "v1";\n');
    expect(await box.cacheEntries()).toEqual([v1.cacheEntry, v2.cacheEntry].sort());
  });

  it("without a lockfile, node_modules gets the bytes whose integrity lands in bun.lock", async () => {
    const v1 = await tarball("v1");
    const v2 = await tarball("v2");
    using box = sandbox("tarball-rebuilt-no-lockfile", { app: {} });

    await box.put("app", v1);
    await box.ok("app", "install");
    expect(await box.state("app")).toEqual(stateOf("v1", v1));

    await box.put("app", v2);
    await rm(join(box.root, "app", "bun.lock"));
    await box.ok("app", "install");
    expect(await box.state("app")).toEqual(stateOf("v2", v2));
  });

  it("reads the tarball when the lockfile does not record its integrity, then records it", async () => {
    const other = await tarball("other");
    const mine = await tarball("mine");
    using box = sandbox("tarball-unpinned", { other: {}, app: {} });
    // Written before bun recorded the integrity of tarball packages.
    await writeFile(
      join(box.root, "app", "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "app", dependencies: { pkg: box.spec } } },
        packages: { pkg: [`pkg@${box.resolution}`, {}] },
      }),
    );

    await box.put("other", other);
    await box.ok("other", "install");
    await box.put("app", mine);
    await box.ok("app", "install");
    expect(await box.state("app")).toEqual(stateOf("mine", mine));
    expect(await box.cacheEntries()).toEqual([mine.cacheEntry, other.cacheEntry].sort());

    // The recorded integrity names the entry that extraction created: this install is
    // served from it without reading the tarball (which would no longer match the pin).
    await box.put("app", other);
    await box.reinstall("app");
    expect(await box.installed("app")).toBe('module.exports = "mine";\n');
  });

  it.skipIf(kind === "URL")(
    "keeps the tarballs of two projects apart whose lockfiles record no integrity for the same path",
    async () => {
      const tarballs = { one: await tarball("one"), two: await tarball("two") };
      using box = sandbox("tarball-unpinned-two-projects", { one: {}, two: {} });
      for (const [project, tgz] of Object.entries(tarballs)) {
        await writeFile(
          join(box.root, project, "bun.lock"),
          JSON.stringify({
            lockfileVersion: 1,
            configVersion: 1,
            workspaces: { "": { name: "app", dependencies: { pkg: box.spec } } },
            packages: { pkg: [`pkg@${box.resolution}`, {}] },
          }),
        );
        await box.put(project, tgz);
        await box.ok(project, "install", "--frozen-lockfile");
      }
      expect(await box.cacheEntries()).toHaveLength(2);

      // Each from its own entry: the files are gone.
      for (const project of Object.keys(tarballs)) {
        await rm(join(box.root, project, "pkg.tgz"));
        await box.reinstall(project, "--frozen-lockfile");
        expect(await box.installed(project)).toBe(`module.exports = ${JSON.stringify(project)};\n`);
      }
    },
  );

  it.each(["--frozen-lockfile", "--no-save"])(
    "reads the tarball once when the lockfile does not record its integrity and bun install %s cannot record it",
    async flag => {
      const v1 = await tarball("v1");
      using box = sandbox("tarball-unpinned-not-saved", { app: {} });
      const lockfile = JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "app", dependencies: { pkg: box.spec } } },
        packages: { pkg: [`pkg@${box.resolution}`, {}] },
      });
      await writeFile(join(box.root, "app", "bun.lock"), lockfile);
      await box.put("app", v1);
      await box.ok("app", "install", flag);
      expect(await box.installed("app")).toBe('module.exports = "v1";\n');
      expect(box.requests.length).toBe(kind === "URL" ? 1 : 0);

      // From here on, neither the path nor the URL serves it.
      box.served.clear();
      await rm(join(box.root, "app", "pkg.tgz"), { force: true });

      const { stdout } = await box.ok("app", "install", flag);
      expect(stdout).toContain("(no changes)");
      expect(stdout).not.toContain("pkg@");

      for (const args of [[flag], [flag, "--offline"]]) {
        await box.reinstall("app", ...args);
        expect(await box.installed("app")).toBe('module.exports = "v1";\n');
      }
      expect(box.requests.length).toBe(kind === "URL" ? 1 : 0);
      expect(await box.lockfile("app")).toBe(lockfile);

      // An install that can record it still reads the tarball.
      await box.put("app", v1);
      await box.reinstall("app");
      expect(await box.state("app")).toEqual(stateOf("v1", v1));
    },
  );

  // https://github.com/oven-sh/bun/issues/8260
  it("an install that changes nothing installs nothing", async () => {
    const v1 = await tarball("v1");
    using box = sandbox("tarball-no-op", { app: {} });
    await box.put("app", v1);
    await box.ok("app", "install");
    expect(await box.state("app")).toEqual(stateOf("v1", v1));
    const lockfile = await box.lockfile("app");
    const requests = box.requests.length;

    for (const args of [[], ["--frozen-lockfile"]]) {
      const { stdout } = await box.ok("app", "install", ...args);
      expect(stdout).toContain("(no changes)");
      expect(stdout).not.toContain("pkg@");
    }
    expect(box.requests.length).toBe(requests);
    expect(await box.lockfile("app")).toBe(lockfile);
  });

  it("a bun.lock that pins a different build replaces the installed one", async () => {
    const v1 = await tarball("v1");
    const v2 = await tarball("v2");
    using box = sandbox("tarball-pulled-lockfile", { app: {}, teammate: {} });
    await box.put("app", v1);
    await box.ok("app", "install");
    await box.put("teammate", v2);
    await box.ok("teammate", "install");

    await box.put("app", v2);
    await writeFile(join(box.root, "app", "bun.lock"), await box.lockfile("teammate"));
    await box.ok("app", "install");
    expect(await box.state("app")).toEqual(stateOf("v2", v2));
  });

  it("ignores what an older version cached under a hash of the path or URL", async () => {
    const v1 = await tarball("v1");
    using box = sandbox("tarball-old-cache", { app: {} });
    // The name that Bun 1.4 gave the cache entry of `pkg.tgz`.
    const oldEntry = "@T@85f77fa09e18a07f@@@1";
    const oldFiles = {
      "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
      "index.js": 'module.exports = "whatever was there last";\n',
    };
    for (const [name, text] of Object.entries(oldFiles)) await Bun.write(join(box.root, "cache", oldEntry, name), text);
    await box.put("app", v1);
    await box.ok("app", "install");
    const lockfile = await box.lockfile("app");

    await box.reinstall("app", "--frozen-lockfile");
    expect(await box.state("app")).toEqual(stateOf("v1", v1));
    expect(await box.lockfile("app")).toBe(lockfile);
    expect(await box.cacheEntries()).toEqual([oldEntry, v1.cacheEntry].sort());
    expect(await readdirSorted(join(box.root, "cache", oldEntry))).toEqual(["index.js", "package.json"]);
    expect(await file(join(box.root, "cache", oldEntry, "index.js")).text()).toBe(oldFiles["index.js"]);
  });

  // https://github.com/oven-sh/bun/issues/31864
  describe("when the path or URL holds other bytes than bun.lock records", () => {
    async function changed(name: string) {
      const v1 = await tarball("v1");
      const v2 = await tarball("v2");
      const box = sandbox(name, { app: {} });
      await box.put("app", v1);
      await box.ok("app", "install");
      expect(await box.state("app")).toEqual(stateOf("v1", v1));
      await box.put("app", v2);
      return { box, v1, v2, lockfile: await box.lockfile("app"), requests: box.requests.length };
    }

    it.each([
      ["install --force", (_spec: string) => ["install", "--force"]],
      ["update", (_spec: string) => ["update"]],
      ["update pkg", (_spec: string) => ["update", "pkg"]],
      ["add <the same path or URL>", (spec: string) => ["add", spec]],
    ] as const)("bun %s takes them and records their integrity", async (label, command) => {
      const { box, v1, v2 } = await changed(`tarball-refresh-${label.replaceAll(/\W+/g, "-")}`);
      using _ = box;

      const { stderr } = await box.ok("app", ...command(box.spec));
      expect(stderr).toContain(`warn: "pkg" has changed: bun.lock recorded ${v1.integrity}, now ${v2.integrity}`);
      expect(await box.state("app")).toEqual(stateOf("v2", v2));
      expect(JSON.parse(await file(join(box.root, "app", "package.json")).text()).dependencies).toEqual({
        pkg: box.spec,
      });
      // Nothing was replaced, so a project that still pins v1 keeps its entry.
      expect(await box.cacheEntries()).toEqual([v1.cacheEntry, v2.cacheEntry].sort());

      // bun.lock describes what's at the path or URL, so a machine with an empty cache can install it.
      await rm(join(box.root, "cache"), { recursive: true });
      await box.reinstall("app", "--frozen-lockfile");
      expect(await box.state("app")).toEqual(stateOf("v2", v2));
    });

    it.each(["install", "install --force --frozen-lockfile", "install --force --no-save", "install --force --offline"])(
      "bun %s keeps what's recorded in bun.lock",
      async command => {
        const { box, v1, lockfile, requests } = await changed(`tarball-keep-${command.replaceAll(/\W+/g, "-")}`);
        using _ = box;

        await box.ok("app", ...command.split(" "));
        expect(await box.state("app")).toEqual(stateOf("v1", v1));
        expect(await box.lockfile("app")).toBe(lockfile);
        expect(box.requests.length).toBe(requests);
        expect(await box.cacheEntries()).toEqual([v1.cacheEntry]);
      },
    );

    it("another dependency on the same path or URL gets what's recorded in bun.lock, without reading it again", async () => {
      const { box, v1, requests } = await changed("tarball-second-dependent");
      using _ = box;

      await writeFile(
        join(box.root, "app", "package.json"),
        JSON.stringify({ name: "app", dependencies: { pkg: box.spec, alias: box.spec } }),
      );
      await box.ok("app", "install");
      expect(await box.state("app")).toEqual(stateOf("v1", v1));
      expect(await box.installed("app", "alias")).toBe('module.exports = "v1";\n');
      expect(box.requests.length).toBe(requests);
      expect(await box.cacheEntries()).toEqual([v1.cacheEntry]);
    });

    it("fails a clean install, and doesn't record other bytes in bun.lock", async () => {
      const { box, lockfile } = await changed("tarball-changed-clean-install");
      using _ = box;

      await rm(join(box.root, "cache"), { recursive: true });
      await rm(join(box.root, "app", "node_modules"), { recursive: true });
      const { stderr, exitCode } = await box.run("app", "install");
      expect(stderr).toContain("Integrity check failed for tarball: pkg");
      expect(await box.lockfile("app")).toBe(lockfile);
      expect(exitCode).toBe(1);
    });
  });

  it("bun update installs the dependencies of the tarball's new build", async () => {
    const dep = await tarball("dep", {}, "dep");
    using box = sandbox("tarball-refresh-dependencies", { app: {} });
    box.served.set("/dep.tgz", dep.file);
    const info = { dependencies: { dep: `${box.server.url}dep.tgz` }, bin: { "pkg-bin": "index.js" } };
    const v1 = await tarball("v1");
    const v2 = await tarball("v2", info);

    await box.put("app", v1);
    await box.ok("app", "install");
    await box.put("app", v2);
    await box.ok("app", "update");
    expect(await box.state("app")).toEqual(stateOf("v2", v2));
    expect((Bun.JSONC.parse(await box.lockfile("app")) as any).packages).toEqual({
      dep: [`dep@${box.server.url}dep.tgz`, { version: "1.0.0" }, dep.integrity],
      pkg: [`pkg@${box.resolution}`, { version: "1.0.0", ...info }, v2.integrity],
    });
    // Next to `pkg`, wherever the linker put that.
    const siblings = dirname(await realpath(join(box.root, "app", "node_modules", "pkg")));
    expect(await file(join(siblings, "dep", "index.js")).text()).toBe('module.exports = "dep";\n');
  });

  // `--no-verify` skips the hash check of a download (a `file:` tarball is always checked).
  // Unverified bytes never get a cache entry named after the hash in bun.lock: their entry
  // is named after the URL and that hash together, and only `--no-verify` installs look there.
  describe.skipIf(kind === "file:").each([
    ["buffered", { BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1" }],
    ["streamed", { BUN_INSTALL_STREAMING_MIN_SIZE: "1" }],
  ] as const)("--no-verify (%s)", (extractor, extractorEnv) => {
    function noVerifySandbox(name: string, projects: Record<string, Record<string, string>>) {
      const box = sandbox(`${name}-${extractor}`, projects);
      Object.assign(box.env, extractorEnv);
      return box;
    }

    /** `app` pins `real`, the URL holds `forged`, and `bun install --no-verify` ran with an empty cache. */
    async function unverified(name: string) {
      const real = await tarball("real");
      const forged = await tarball("forged");
      const box = noVerifySandbox(name, { app: {}, other: {} });
      await box.put("app", real);
      await box.ok("app", "install");
      const lockfile = await box.lockfile("app");
      expect(lockfile).toContain(real.integrity);
      await rm(join(box.root, "cache"), { recursive: true });

      await box.put("app", forged);
      await box.reinstall("app", "--no-verify");
      expect(await box.installed("app")).toBe('module.exports = "forged";\n');
      return { box, real, forged, lockfile };
    }

    it("another project that pins the same hash never gets the unverified bytes", async () => {
      const { box, real, lockfile } = await unverified("no-verify-other-project");
      using _ = box;
      const other = join(box.root, "other");

      // The same URL, which still holds the wrong bytes.
      await writeFile(join(other, "bun.lock"), lockfile);
      const { stderr, exitCode } = await box.run("other", "install");
      expect(stderr).toContain("Integrity check failed for tarball: pkg");
      expect(await file(join(other, "node_modules", "pkg", "index.js")).exists()).toBe(false);
      expect(exitCode).toBe(1);

      // Another URL, which holds the right bytes.
      const mirror = `${box.server.url}mirror.tgz`;
      box.served.set("/mirror.tgz", real.file);
      await writeFile(join(other, "package.json"), JSON.stringify({ name: "app", dependencies: { pkg: mirror } }));
      await writeFile(join(other, "bun.lock"), lockfile.replaceAll(box.spec, mirror));
      await box.ok("other", "install");
      expect(await box.state("other")).toEqual(stateOf("real", real));
      expect(await box.cacheEntries()).toEqual([expect.stringMatching(/^@T@[0-9a-f]{16}@@@1$/), real.cacheEntry]);
    });

    it("a second --no-verify install is a cache hit", async () => {
      const { box } = await unverified("no-verify-cache-hit");
      using _ = box;
      const requests = box.requests.length;

      await box.reinstall("app", "--no-verify");
      expect(await box.installed("app")).toBe('module.exports = "forged";\n');
      expect(box.requests.length).toBe(requests);
    });

    it("leaves bun.lock unchanged, and .bun-tag does not claim the hash that was not checked", async () => {
      const { box, real, lockfile } = await unverified("no-verify-lockfile");
      using _ = box;

      expect(await box.lockfile("app")).toBe(lockfile);
      expect(await box.state("app")).toEqual({
        installed: 'module.exports = "forged";\n',
        tag: "",
        locked: real.integrity,
      });
    });

    it("a later install without the flag replaces the unverified copy", async () => {
      const { box, real } = await unverified("no-verify-then-verify");
      using _ = box;

      await box.put("app", real);
      await box.ok("app", "install");
      expect(await box.state("app")).toEqual(stateOf("real", real));
    });

    it("without a lockfile, downloads once and records the hash of what it installed", async () => {
      const v1 = await tarball("v1");
      using box = noVerifySandbox("no-verify-no-lockfile", { app: {} });

      await box.put("app", v1);
      await box.ok("app", "install", "--no-verify");
      expect(await box.state("app")).toEqual(stateOf("v1", v1));
      expect(box.requests).toEqual(["/pkg.tgz"]);

      // The hash was computed from these bytes, so nothing is unverified: every later install is a cache hit.
      expect(await box.cacheEntries()).toEqual([v1.cacheEntry]);
      await box.reinstall("app");
      await box.reinstall("app", "--no-verify");
      await box.reinstall("app", "--offline");
      expect(await box.state("app")).toEqual(stateOf("v1", v1));
      expect(box.requests).toEqual(["/pkg.tgz"]);
    });

    it("uses an entry that a verified install cached", async () => {
      const real = await tarball("real");
      using box = noVerifySandbox("no-verify-prefers-verified", { app: {} });

      await box.put("app", real);
      await box.ok("app", "install");
      await box.reinstall("app", "--no-verify");
      expect(await box.state("app")).toEqual(stateOf("real", real));
      expect(await box.cacheEntries()).toEqual([real.cacheEntry]);
      expect(box.requests).toEqual(["/pkg.tgz"]);
    });

    // The patched entry is made from the unpatched one, so both have to be looked up under the same base name.
    it.each(["a verified install cached the package", "the cache is empty"])(
      "patches a package when %s",
      async cache => {
        const real = await tarball("real");
        using box = noVerifySandbox(`no-verify-patched-${cache.length}`, { app: {} });
        const app = join(box.root, "app");

        await box.put("app", real);
        await box.ok("app", "install");
        const manifest = JSON.parse(await file(join(app, "package.json")).text());
        await writeFile(
          join(app, "package.json"),
          JSON.stringify({ ...manifest, patchedDependencies: { [`pkg@${box.resolution}`]: "pkg.patch" } }),
        );
        await writeFile(
          join(app, "pkg.patch"),
          `diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-module.exports = "real";\n+module.exports = "patched";\n`,
        );
        if (cache === "the cache is empty") await rm(join(box.root, "cache"), { recursive: true });

        await box.reinstall("app", "--no-verify");
        expect(await box.installed("app")).toBe('module.exports = "patched";\n');
        await box.reinstall("app", "--no-verify");
        expect(await box.installed("app")).toBe('module.exports = "patched";\n');
      },
    );

    it("downloads once and records the hash when the lockfile does not record one", async () => {
      const v1 = await tarball("v1");
      using box = noVerifySandbox("no-verify-unpinned", { app: {} });
      await writeFile(
        join(box.root, "app", "bun.lock"),
        JSON.stringify({
          lockfileVersion: 1,
          configVersion: 1,
          workspaces: { "": { name: "app", dependencies: { pkg: box.spec } } },
          packages: { pkg: [`pkg@${box.resolution}`, {}] },
        }),
      );

      await box.put("app", v1);
      await box.ok("app", "install", "--no-verify");
      expect(await box.state("app")).toEqual(stateOf("v1", v1));
      expect(box.requests).toEqual(["/pkg.tgz"]);
    });

    it("bun update --no-verify installs the new bytes of the URL and records their hash", async () => {
      const v1 = await tarball("v1");
      const v2 = await tarball("v2");
      using box = noVerifySandbox("no-verify-update", { app: {} });

      await box.put("app", v1);
      await box.ok("app", "install", "--no-verify");
      await box.put("app", v2);
      await box.ok("app", "update", "--no-verify");
      expect(await box.state("app")).toEqual(stateOf("v2", v2));
    });
  });
});

describe.concurrent.each(["hoisted", "isolated"] as const)("tarball integrity mismatch (%s)", linker => {
  // Regression test for #29646 — with the isolated linker, a SHA-512 mismatch
  // during the resolve-phase tarball extract left `task_queue` /
  // `network_dedupe_map` populated, so the install phase's later
  // `enqueuePackageForDownload` returned early on `found_existing` and the
  // installer waited forever for a callback that was never dispatched.
  //
  // We trigger the mismatch by advertising one tarball's SHA-512 in the
  // manifest while serving a different tarball's bytes. No existing lockfile
  // means the failure happens in the resolve phase, where the runTasks
  // callback is the void `onPackageDownloadError = {}` — i.e. the branch the
  // fix in runTasks.zig now cleans up.
  it("should fail (not hang) when tarball bytes don't match manifest SHA-512", { timeout: 60_000 }, async () => {
    function buildTarball(body: Buffer) {
      const tgz = tarball({ "package.json": body });
      return { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") };
    }

    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));
    const lie = buildTarball(Buffer.from('{"name":"other","version":"9.9.9"}\n'));

    // Custom server instead of the dummy registry — we need to advertise an
    // integrity hash that deliberately does not match the served bytes, which
    // the dummy registry doesn't support.
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/pkg")) {
          return Response.json({
            name: "pkg",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "pkg",
                version: "1.0.0",
                dist: {
                  integrity: lie.integrity,
                  tarball: `http://127.0.0.1:${server.port}/pkg/-/pkg-1.0.0.tgz`,
                },
              },
            },
          });
        }
        if (url.pathname.endsWith("/pkg-1.0.0.tgz")) {
          return new Response(real.tgz, { headers: { "content-length": String(real.tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    using dir = tempDir("integrity-mismatch-" + linker, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { pkg: "1.0.0" },
      }),
      "bunfig.toml": Bun.TOML.stringify({
        install: {
          registry: `http://127.0.0.1:${server.port}/`,
          linker,
        },
      }),
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    // The hang path in #29646 also prints "Integrity check failed" (it comes
    // from the streaming extractor — the hang happens *after*), exits with a
    // SIGTERM-induced non-zero code when the spawn timeout fires, and never
    // produces "1 package installed". So the presence of the message, the
    // absence of success output, and a non-zero exit are all consistent with
    // either outcome. The load-bearing assertion is `signalCode === null`:
    // with the fix, bun exits cleanly on its own; on hang, Bun.spawn's
    // timeout kills the child with SIGTERM.
    expect(proc.signalCode).toBeNull();
    // The exact message matters: it used to leak a literal "<r>" markup tag
    // ("Integrity check failed<r> for tarball: ...").
    expect(stderr + stdout).toContain("Integrity check failed for tarball: pkg");
    expect(stderr + stdout).not.toContain("<r>");
    expect(stdout).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });
});

describe.concurrent("tarball integrity metadata forms", () => {
  function buildTarball(body: Buffer) {
    const tgz = tarball({ "package.json": body });
    return {
      tgz,
      sha512: "sha512-" + createHash("sha512").update(tgz).digest("base64"),
      sha384: "sha384-" + createHash("sha384").update(tgz).digest("base64"),
      sha1: "sha1-" + createHash("sha1").update(tgz).digest("base64"),
      shasum: createHash("sha1").update(tgz).digest("hex"),
    };
  }
  function serveManifest(dist: { integrity?: string; shasum?: string }, tgz: Buffer) {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/pkg")) {
          return Response.json({
            name: "pkg",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "pkg",
                version: "1.0.0",
                dist: {
                  ...dist,
                  tarball: `http://127.0.0.1:${server.port}/pkg/-/pkg-1.0.0.tgz`,
                },
              },
            },
          });
        }
        if (url.pathname.endsWith("/pkg-1.0.0.tgz")) {
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    return server;
  }
  function projectDir(name: string, port: number) {
    return tempDir(name, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { pkg: "1.0.0" },
      }),
      "bunfig.toml": Bun.TOML.stringify({
        install: {
          registry: `http://127.0.0.1:${port}/`,
        },
      }),
    });
  }

  it("verifies the tarball against the strongest entry of a multi-hash integrity string", async () => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));
    const other = buildTarball(Buffer.from('{"name":"other","version":"9.9.9"}\n'));

    await using server = serveManifest({ integrity: `${other.sha512} ${real.sha384}` }, real.tgz);
    using dir = projectDir("integrity-multi-hash", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr + stdout).toContain("Integrity check failed");
    expect(stdout).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });

  it("records the strongest entry of a multi-hash integrity string in the lockfile", async () => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));
    const other = buildTarball(Buffer.from('{"name":"other","version":"9.9.9"}\n'));

    await using server = serveManifest({ integrity: `${real.sha512} ${other.sha384}` }, real.tgz);
    using dir = projectDir("integrity-multi-hash-lock", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install", "--save-text-lockfile"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stdout).toContain("1 package installed");
    const lockContent = await file(join(String(dir), "bun.lock")).text();
    const integrityMatch = lockContent.match(/"(sha\d+-[A-Za-z0-9+/]+=*)"/);
    expect(integrityMatch).not.toBeNull();
    expect(integrityMatch![1]).toBe(real.sha512);
    expect(exitCode).toBe(0);
  });

  it("verifies the tarball when the integrity entry carries an option suffix", async () => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));
    const other = buildTarball(Buffer.from('{"name":"other","version":"9.9.9"}\n'));

    await using server = serveManifest({ integrity: `${other.sha512}?vcs=git` }, real.tgz);
    using dir = projectDir("integrity-option-suffix", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr + stdout).toContain("Integrity check failed");
    expect(stdout).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });

  it("--no-verify installs a tarball whose bytes don't match the advertised integrity", async () => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));
    const other = buildTarball(Buffer.from('{"name":"other","version":"9.9.9"}\n'));

    await using server = serveManifest({ integrity: other.sha512 }, real.tgz);
    using dir = projectDir("integrity-no-verify-flag", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install", "--no-verify"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr + stdout).not.toContain("Integrity check failed");
    expect(stdout).toContain("1 package installed");
    expect(await file(join(String(dir), "node_modules", "pkg", "package.json")).json()).toEqual({
      name: "pkg",
      version: "1.0.0",
    });
    expect(exitCode).toBe(0);
  });

  it.each(["1", "true"])("BUN_CONFIG_NO_VERIFY=%s skips the integrity check like --no-verify", async value => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));
    const other = buildTarball(Buffer.from('{"name":"other","version":"9.9.9"}\n'));

    await using server = serveManifest({ integrity: other.sha512 }, real.tgz);
    using dir = projectDir("integrity-no-verify-env-on", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"), BUN_CONFIG_NO_VERIFY: value },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr + stdout).not.toContain("Integrity check failed");
    expect(stdout).toContain("1 package installed");
    expect(await file(join(String(dir), "node_modules", "pkg", "package.json")).json()).toEqual({
      name: "pkg",
      version: "1.0.0",
    });
    expect(exitCode).toBe(0);
  });

  it.each(["0", "false", "", "no", "off"])("BUN_CONFIG_NO_VERIFY=%j keeps the integrity check enabled", async value => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));
    const other = buildTarball(Buffer.from('{"name":"other","version":"9.9.9"}\n'));

    await using server = serveManifest({ integrity: other.sha512 }, real.tgz);
    using dir = projectDir("integrity-no-verify-env-off", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"), BUN_CONFIG_NO_VERIFY: value },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr + stdout).toContain("Integrity check failed");
    expect(stdout).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });

  it("verifies the tarball against the manifest shasum when there is no integrity field", async () => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));
    const other = buildTarball(Buffer.from('{"name":"other","version":"9.9.9"}\n'));

    await using server = serveManifest({ shasum: other.shasum }, real.tgz);
    using dir = projectDir("integrity-shasum-mismatch", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr).not.toContain("Unsupported or malformed integrity hash");
    expect(stderr + stdout).toContain("Integrity check failed");
    expect(stdout).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
  });

  it("falls back to the manifest shasum when the integrity field is unusable, without warning", async () => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));

    await using server = serveManifest({ integrity: "md5-AAAAAAAAAAAAAAAAAAAAAA==", shasum: real.shasum }, real.tgz);
    using dir = projectDir("integrity-shasum-fallback", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install", "--save-text-lockfile"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr).not.toContain("Unsupported or malformed integrity hash");
    expect(stdout).toContain("1 package installed");
    expect(await file(join(String(dir), "bun.lock")).text()).toContain(real.sha1);
    expect(exitCode).toBe(0);
  });

  it.each([
    // Same length as a sha1 hex digest, but not hex.
    ["malformed shasum", { shasum: Buffer.alloc(40, "x").toString() }],
    ["unsupported integrity algorithm", { integrity: "md5-AAAAAAAAAAAAAAAAAAAAAA==" }],
    ["malformed integrity and empty shasum", { integrity: "sha512-!!!", shasum: "" }],
  ] as const)("warns instead of silently skipping verification: %s", async (_label, dist) => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));

    await using server = serveManifest(dist, real.tgz);
    using dir = projectDir("integrity-unusable", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install", "--save-text-lockfile"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr).toContain(
      "warn: Unsupported or malformed integrity hash in registry metadata for pkg@1.0.0, tarball will not be verified",
    );
    expect(stdout).toContain("1 package installed");
    // No usable hash was advertised, so the lockfile has no pin for it.
    expect(await file(join(String(dir), "bun.lock")).text()).not.toMatch(/sha\d+-/);
    expect(exitCode).toBe(0);
  });

  it("prints nothing when the manifest advertises no hash at all", async () => {
    const real = buildTarball(Buffer.from('{"name":"pkg","version":"1.0.0"}\n'));

    await using server = serveManifest({}, real.tgz);
    using dir = projectDir("integrity-absent", server.port);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr).not.toContain("Unsupported or malformed integrity hash");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
  });
});

// Bun writes a hash that it can check, or none. Reading anything else as "none" would let an edit of bun.lock turn the
// check off. For a tarball, it would also install and record whatever is there now.
describe.concurrent("an invalid integrity in bun.lock", () => {
  const tgz = tarball({ "package.json": Buffer.from(JSON.stringify({ name: "pkg", version: "1.0.0" })) });
  const integrity = "sha512-" + createHash("sha512").update(tgz).digest("base64");
  const rows = {
    "npm package": ["1.0.0", (hash: string) => ["pkg@1.0.0", "", {}, hash]],
    "file: tarball": ["file:pkg.tgz", (hash: string) => ["pkg@pkg.tgz", {}, hash]],
    "GitHub package": [
      "github:owner/pkg#abc1234",
      (hash: string) => ["pkg@github:owner/pkg#abc1234", {}, "owner-pkg-abc1234", hash],
    ],
  } as const;

  async function install(kind: keyof typeof rows, lockfileVersion: number, hash: string, ...args: string[]) {
    const [dependency, row] = rows[kind];
    const requests: string[] = [];
    await using registry = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(req.url);
        return new Response("not found", { status: 404 });
      },
    });
    using dir = tempDir("lockfile-integrity", {
      "package.json": JSON.stringify({ name: "app", dependencies: { pkg: dependency } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: registry.url.href, cache: false } }),
      "pkg.tgz": tgz,
      "bun.lock": JSON.stringify({
        lockfileVersion,
        configVersion: 1,
        workspaces: { "": { name: "app", dependencies: { pkg: dependency } } },
        packages: { pkg: row(hash) },
      }),
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const locked = (Bun.JSONC.parse(await file(join(String(dir), "bun.lock")).text()) as any).packages.pkg.at(-1);
    return { stderr, exitCode, locked, requests, installed: await readdirSorted(String(dir)) };
  }

  describe.each(Object.keys(rows) as (keyof typeof rows)[])("%s", kind => {
    it.each(["md5-AAAAAAAAAAAAAAAAAAAAAA==", "sha512-!!!", "none"])("%s fails a frozen install", async hash => {
      const result = await install(kind, 2, hash, "--frozen-lockfile");
      expect(result.stderr).toContain("error: Unsupported or malformed integrity hash\n");
      expect(result).toMatchObject({
        exitCode: 1,
        locked: hash,
        requests: [],
        installed: ["bun.lock", "bunfig.toml", "package.json", "pkg.tgz"],
      });
    });
  });

  it("is reported, and bun.lock is rewritten, by an install that's allowed to", async () => {
    const result = await install("file: tarball", 2, "md5-AAAAAAAAAAAAAAAAAAAAAA==");
    expect(result.stderr).toContain("error: Unsupported or malformed integrity hash\n");
    expect(result.stderr).toContain("Ignoring lockfile");
    expect(result).toMatchObject({ exitCode: 0, locked: integrity });
  });

  it("is ignored with a warning in a lockfile from before version 2", async () => {
    const result = await install("file: tarball", 1, "md5-AAAAAAAAAAAAAAAAAAAAAA==");
    expect(result.stderr).toContain("warn: Unsupported or malformed integrity hash; ignoring\n");
    expect(result.stderr).not.toContain("error:");
    expect(result).toMatchObject({ exitCode: 0, locked: integrity });
  });
});

describe.concurrent.each(["hoisted", "isolated"] as const)("tarball download failure (%s)", linker => {
  it("should fail (not hang) when registry returns 404 for tarball", async () => {
    await withContext({ linker }, async ctx => {
      const urls: string[] = [];
      let tarballStatus = 200;
      setContextHandler(ctx, async request => {
        const url = request.url.replaceAll("%2f", "/");
        urls.push(url);
        if (url.endsWith(".tgz")) {
          if (tarballStatus !== 200) {
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({ errors: [{ status: 404, message: "Could not find resource" }] }),
                    ),
                  );
                  controller.close();
                },
              }),
              { status: tarballStatus, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(file(join(import.meta.dir, "baz-0.0.3.tgz")));
        }
        return Response.json({
          name: "baz",
          versions: {
            "0.0.3": {
              name: "baz",
              version: "0.0.3",
              dist: { tarball: `${ctx.registry_url}baz-0.0.3.tgz` },
            },
          },
          "dist-tags": { latest: "0.0.3" },
        });
      });

      // Project-local .npmrc takes precedence over any user-level ~/.npmrc.
      await writeFile(join(ctx.package_dir, ".npmrc"), `registry=${ctx.registry_url}\n`);
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: { baz: "0.0.3" },
        }),
      );

      // First install: succeeds, writes lockfile + node_modules.
      {
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("404");
        expect(exitCode).toBe(0);
      }

      // Second install with node_modules removed and tarball now 404: should
      // fail with a clear error, not hang. The lockfile is kept so the resolve
      // phase is a no-op and the tarball download happens in the install phase.
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
      tarballStatus = 404;
      urls.length = 0;

      {
        await using proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });
        const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

        // Previously, the isolated installer would hang indefinitely here
        // because the store entry's pending-task slot was never released.
        expect(urls.some(u => u.endsWith(".tgz"))).toBe(true);
        expect(stderr).toContain("baz");
        // The isolated installer maps the status to a human-readable
        // reason phrase; the hoisted installer prints `GET <url> - 404`.
        expect(stderr).toContain(linker === "isolated" ? "404 Not Found" : "404");
        expect(stdout).not.toContain("1 package installed");
        expect(exitCode).not.toBe(0);
      }
    });
  });
});

// Installing without a lockfile extracts a `file:` or URL tarball again. The same
// bytes have the same cache folder, which stays as it is, and the fresh copy must not
// be left behind in the temp dir, which used to grow by one extracted tarball per
// install. A repacked tarball gets a folder of its own.
describe.concurrent("tarball re-extraction over an existing cache folder", () => {
  function tarballOfVersion(version: string, padding: Record<string, Buffer> = {}) {
    return tarball({ "package.json": Buffer.from(JSON.stringify({ name: "pkg", version }) + "\n"), ...padding });
  }

  function project(name: string, spec: string) {
    return tempDir(name, {
      "app/package.json": JSON.stringify({ name: "app", dependencies: { pkg: spec } }),
      // The install extracts into tmp/ and renames into cache/; both are inside
      // the test directory, so anything left in tmp/ after an install is a leak.
      cache: {},
      tmp: {},
    });
  }

  /** `bun install` from scratch (no node_modules, no lockfile); returns the installed version of `pkg`. */
  async function installFresh(dir: string) {
    const app = join(dir, "app");
    await Promise.all([
      rm(join(app, "node_modules"), { recursive: true, force: true }),
      rm(join(app, "bun.lock"), { force: true }),
    ]);
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: app,
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(dir, "cache"), BUN_TMPDIR: join(dir, "tmp") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    const { version } = await file(join(app, "node_modules", "pkg", "package.json")).json();
    return version as string;
  }

  async function cacheState(dir: string) {
    const [tmp, cache] = await Promise.all([readdirSorted(join(dir, "tmp")), readdirSorted(join(dir, "cache"))]);
    return { tmp, tarballFolders: cache.filter(name => name.startsWith("@T@")).length };
  }

  it("file: tarball", async () => {
    using dir = project("tarball-reextract-file", "file:../pkg.tgz");
    await writeFile(join(String(dir), "pkg.tgz"), tarballOfVersion("1.0.0"));

    expect(await installFresh(String(dir))).toBe("1.0.0");
    expect(await installFresh(String(dir))).toBe("1.0.0");
    expect(await installFresh(String(dir))).toBe("1.0.0");
    expect(await cacheState(String(dir))).toEqual({ tmp: [], tarballFolders: 1 });

    await writeFile(join(String(dir), "pkg.tgz"), tarballOfVersion("2.0.0"));
    expect(await installFresh(String(dir))).toBe("2.0.0");
    expect(await cacheState(String(dir))).toEqual({ tmp: [], tarballFolders: 2 });
  });

  it("tarball URL", async () => {
    // Incompressible padding, served without a Content-Length in several
    // chunks, makes the download take the streaming extractor rather than
    // being buffered and extracted in one go.
    const padding = { "blob.bin": randomBytes(256 * 1024) };
    let tgz = tarballOfVersion("1.0.0", padding);
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        let offset = 0;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (offset >= tgz.length) return controller.close();
              controller.enqueue(tgz.subarray(offset, offset + 64 * 1024));
              offset += 64 * 1024;
            },
          }),
        );
      },
    });
    using dir = project("tarball-reextract-url", `${server.url}pkg.tgz`);

    expect(await installFresh(String(dir))).toBe("1.0.0");
    expect(await installFresh(String(dir))).toBe("1.0.0");
    expect(await installFresh(String(dir))).toBe("1.0.0");
    expect(await cacheState(String(dir))).toEqual({ tmp: [], tarballFolders: 1 });

    tgz = tarballOfVersion("2.0.0", padding);
    expect(await installFresh(String(dir))).toBe("2.0.0");
    expect(await cacheState(String(dir))).toEqual({ tmp: [], tarballFolders: 2 });
  });
});
