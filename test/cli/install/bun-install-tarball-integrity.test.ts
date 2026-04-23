import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tempDir } from "harness";
import { join } from "path";
import { gzipSync } from "node:zlib";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./dummy.registry";

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
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
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
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
  it("should fail (not hang) when tarball bytes don't match manifest SHA-512", async () => {
    function octal(n: number, width: number) {
      return n.toString(8).padStart(width - 1, "0") + "\0";
    }
    function tarHeader(name: string, size: number) {
      const buf = Buffer.alloc(512, 0);
      buf.write(name, 0, 100, "utf8");
      buf.write(octal(0o644, 8), 100);
      buf.write(octal(0, 8), 108);
      buf.write(octal(0, 8), 116);
      buf.write(octal(size, 12), 124);
      buf.write(octal(0, 12), 136);
      buf.fill(" ", 148, 156);
      buf.write("0", 156);
      buf.write("ustar\0", 257);
      buf.write("00", 263);
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += buf[i];
      buf.write(octal(sum, 8), 148);
      return buf;
    }
    function pad512(len: number) {
      return Buffer.alloc((512 - (len % 512)) % 512, 0);
    }
    function buildTarball(body: Buffer) {
      const tar = Buffer.concat([
        tarHeader("package/package.json", body.length),
        body,
        pad512(body.length),
        Buffer.alloc(1024, 0),
      ]);
      const tgz = gzipSync(tar);
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
      "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${server.port}/"\nlinker = "${linker}"\n`,
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stderr, stdout, exitCode] = await Promise.all([
      proc.stderr.text(),
      proc.stdout.text(),
      proc.exited,
    ]);

    // Must surface the integrity failure and must not claim success.
    expect(stderr + stdout).toContain("Integrity check failed");
    expect(stdout).not.toContain("1 package installed");
    expect(exitCode).not.toBe(0);
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
