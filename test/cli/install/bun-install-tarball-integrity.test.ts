import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { exists, mkdir, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tempDir } from "harness";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { join } from "path";
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
  it("should fail (not hang) when tarball bytes don't match manifest SHA-512", { timeout: 60_000 }, async () => {
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
  function buildTarball(body: Buffer) {
    const tar = Buffer.concat([
      tarHeader("package/package.json", body.length),
      body,
      Buffer.alloc((512 - (body.length % 512)) % 512, 0),
      Buffer.alloc(1024, 0),
    ]);
    const tgz = gzipSync(tar);
    return {
      tgz,
      sha512: "sha512-" + createHash("sha512").update(tgz).digest("base64"),
      sha384: "sha384-" + createHash("sha384").update(tgz).digest("base64"),
    };
  }
  function serveManifest(integrity: string, tgz: Buffer) {
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
                  integrity,
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

    await using server = serveManifest(`${other.sha512} ${real.sha384}`, real.tgz);
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

    await using server = serveManifest(`${real.sha512} ${other.sha384}`, real.tgz);
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

    await using server = serveManifest(`${other.sha512}?vcs=git`, real.tgz);
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

// bun.lock pins a URL tarball and a `file:` tarball by the sha512 of its
// bytes. The tests below make bun resolve such a dependency again (its line in
// package.json moves to another group or is renamed, another workspace
// declares it, `bun update` runs) after the bytes behind the URL or the path
// changed. Each test has its own project, server and caches.
describe.concurrent("pinned tarball that is resolved again", () => {
  const PKG = "pinned-pkg";
  const kinds = ["url", "file"] as const;
  type Kind = (typeof kinds)[number];

  const sri = (algorithm: string, bytes: Uint8Array) =>
    `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`;

  /** A package tarball whose index.js exports `marker`. */
  function tarballOf(marker: string, manifest: Record<string, unknown> = {}, name = PKG) {
    return new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ name, version: "1.0.0", ...manifest }),
        "package/index.js": `module.exports = ${JSON.stringify(marker)};\n`,
      },
      { compress: "gzip" },
    ).bytes();
  }

  function fixture(kind: Kind) {
    const dir = tempDir("pinned-tarball", { project: { vendor: {} } });
    const root = String(dir);
    const project = join(root, "project");
    // URL path -> the bytes the server answers with
    const served = new Map<string, Uint8Array>();
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        requests++;
        const bytes = served.get(new URL(req.url).pathname);
        return bytes ? new Response(bytes) : new Response("not found", { status: 404 });
      },
    });

    return {
      kind,
      project,
      /** How package.json writes the tarball `name`. */
      spec: (name = "one.tgz") =>
        kind === "url" ? `http://localhost:${server.port}/${name}` : `file:./vendor/${name}`,
      /** Puts `bytes` behind the URL and the path of the tarball `name`. */
      async put(bytes: Uint8Array, name = "one.tgz") {
        served.set(`/${name}`, bytes);
        await writeFile(join(project, "vendor", name), bytes);
      },
      async manifest(manifest: Record<string, unknown>, at = ".") {
        await mkdir(join(project, at), { recursive: true });
        await writeFile(
          join(project, at, "package.json"),
          JSON.stringify({ name: "root", version: "1.0.0", ...manifest }),
        );
      },
      /** "warm" is the cache of the first install. "cold" is a cache that has never held the tarball. */
      async bun(cache: "cold" | "warm", args: string[], extraEnv: Record<string, string> = {}) {
        requests = 0;
        await using proc = spawn({
          cmd: [bunExe(), ...args],
          cwd: project,
          env: { ...env, BUN_INSTALL_CACHE_DIR: join(root, `cache-${cache}`), ...extraEnv },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { out: stdout + stderr, exitCode, requests };
      },
      /** The marker the installed package exports, or null when it is not installed. */
      async installed(at = join("node_modules", PKG)): Promise<string | null> {
        const index = file(join(project, at, "index.js"));
        if (!(await index.exists())) return null;
        const text = await index.text();
        return JSON.parse(text.slice(text.indexOf("=") + 1, text.lastIndexOf(";")));
      },
      lock: () => file(join(project, "bun.lock")).text(),
      /** The names of the packages that the cache holds as extracted tarballs. */
      async cached(cache: "cold" | "warm") {
        const names: string[] = [];
        const cacheDir = join(root, `cache-${cache}`);
        for (const entry of (await exists(cacheDir)) ? await readdirSorted(cacheDir) : []) {
          const manifest = file(join(cacheDir, entry, "package.json"));
          if (entry.startsWith("@T@") && (await manifest.exists())) names.push((await manifest.json()).name);
        }
        return names;
      },
      async removeNodeModules() {
        for (const at of [".", join("packages", "a"), join("packages", "b")]) {
          await rm(join(project, at, "node_modules"), { recursive: true, force: true });
        }
      },
      async [Symbol.asyncDispose]() {
        await server.stop(true);
        await dir[Symbol.asyncDispose]();
      },
    };
  }
  type Fixture = ReturnType<typeof fixture>;

  /** A project whose bun.lock pins the bytes with marker "v1". node_modules is removed again. */
  async function pinned(
    kind: Kind,
    write: (fx: Fixture) => Promise<void> = fx => fx.manifest({ dependencies: { [PKG]: fx.spec() } }),
  ) {
    const fx = fixture(kind);
    const bytes = await tarballOf("v1");
    await fx.put(bytes);
    await write(fx);
    const first = await fx.bun("warm", ["install"]);
    expect(first.out).not.toContain("error:");
    expect(first.exitCode).toBe(0);
    const pin = sri("sha512", bytes);
    const pinnedLock = await fx.lock();
    expect(pinnedLock).toContain(pin);
    await fx.removeNodeModules();
    return Object.assign(fx, { pin, pinnedLock });
  }
  type Pinned = Awaited<ReturnType<typeof pinned>>;

  /** bun refused the changed bytes: it installed nothing, bun.lock keeps the pin and the cold cache does not hold them. */
  async function expectRefused(pin: Pinned, result: { out: string; exitCode: number }, at = join("node_modules", PKG)) {
    expect({
      installed: await pin.installed(at),
      pinned: (await pin.lock()).includes(pin.pin),
      cached: (await pin.cached("cold")).filter(name => name === PKG),
    }).toEqual({ installed: null, pinned: true, cached: [] });
    expect(result.out).toContain("Integrity check failed");
    expect(result.exitCode).toBe(1);
  }

  describe.each(kinds)("%s, changed bytes, cold cache", kind => {
    const groups = ["devDependencies", "optionalDependencies", "peerDependencies"] as const;
    const commands = [["install"], ["install", "--frozen-lockfile"], ["ci"]];

    describe.each(groups)("the line moves to %s", group => {
      it.each(commands.map(args => [args]))("refuses: bun %j", async args => {
        await using pin = await pinned(kind);
        await pin.put(await tarballOf("v2"));
        await pin.manifest({ [group]: { [PKG]: pin.spec() } });

        await expectRefused(pin, await pin.bun("cold", args));
      });
    });

    it("refuses when the key is renamed", async () => {
      await using pin = await pinned(kind);
      await pin.put(await tarballOf("v2"));
      await pin.manifest({ dependencies: { "renamed-key": pin.spec() } });

      await expectRefused(pin, await pin.bun("cold", ["install"]), join("node_modules", "renamed-key"));
    });

    it("refuses when a key that never was the package name moves", async () => {
      await using pin = await pinned(kind, fx => fx.manifest({ dependencies: { "other-key": fx.spec() } }));
      await pin.put(await tarballOf("v2"));
      await pin.manifest({ devDependencies: { "other-key": pin.spec() } });

      await expectRefused(pin, await pin.bun("cold", ["ci"]), join("node_modules", "other-key"));
    });

    it("refuses when an override names the same tarball", async () => {
      await using pin = await pinned(kind);
      await pin.put(await tarballOf("v2"));
      await pin.manifest({ dependencies: { [PKG]: pin.spec() }, overrides: { [PKG]: pin.spec() } });

      await expectRefused(pin, await pin.bun("cold", ["install"]));
    });

    it("does not run the postinstall of the changed bytes for a trusted dependency", async () => {
      await using pin = await pinned(kind, fx =>
        fx.manifest({ dependencies: { [PKG]: fx.spec() }, trustedDependencies: [PKG] }),
      );
      // The script runs in node_modules/<PKG> and leaves its mark in the project.
      await pin.put(
        await tarballOf("v2", {
          scripts: { postinstall: `${bunExe()} -e "require('fs').writeFileSync('../../postinstall-ran', '')"` },
        }),
      );
      await pin.manifest({ devDependencies: { [PKG]: pin.spec() }, trustedDependencies: [PKG] });

      const result = await pin.bun("cold", ["install", "--frozen-lockfile"]);

      expect(await exists(join(pin.project, "postinstall-ran"))).toBe(false);
      await expectRefused(pin, result);
    });
  });

  // The root declares the tarball. `packages/*` are its workspaces.
  const withWorkspaces = (fx: Fixture) =>
    fx.manifest({ workspaces: ["packages/*"], dependencies: { [PKG]: fx.spec() } });

  it.each([[["install"]], [["install", "--frozen-lockfile"]]])(
    "url, changed bytes: refuses when a new workspace declares the tarball: bun %j",
    async args => {
      await using pin = await pinned("url", withWorkspaces);
      await pin.put(await tarballOf("v2"));
      await pin.manifest({ name: "a", dependencies: { [PKG]: pin.spec() } }, join("packages", "a"));

      const result = await pin.bun("cold", args);

      expect(await pin.installed(join("packages", "a", "node_modules", PKG))).toBe(null);
      await expectRefused(pin, result);
    },
  );

  describe.each(kinds)("%s, changed bytes, workspaces", kind => {
    it("refuses when a workspace that declares the tarball gets another dependency", async () => {
      // A `file:` path is relative to the package.json that declares it.
      const fromWorkspace = (fx: Fixture) => (kind === "url" ? fx.spec() : "file:../../vendor/one.tgz");
      await using pin = await pinned(kind, async fx => {
        await withWorkspaces(fx);
        await fx.manifest({ name: "a", dependencies: { [PKG]: fromWorkspace(fx) } }, join("packages", "a"));
        await fx.manifest({ name: "b" }, join("packages", "b"));
      });
      await pin.put(await tarballOf("v2"));
      await pin.manifest(
        { name: "a", dependencies: { [PKG]: fromWorkspace(pin), b: "workspace:*" } },
        join("packages", "a"),
      );

      const result = await pin.bun("cold", ["install"]);

      expect(await pin.installed(join("packages", "a", "node_modules", PKG))).toBe(null);
      await expectRefused(pin, result);
    });
  });

  it("refuses a changed tarball that another tarball declares when the line of that tarball moves", async () => {
    await using pin = await pinned("url", async fx => {
      await fx.put(await tarballOf("parent", { dependencies: { [PKG]: fx.spec() } }, "parent-pkg"), "parent.tgz");
      await fx.manifest({ dependencies: { "parent-pkg": fx.spec("parent.tgz") } });
    });
    await pin.put(await tarballOf("v2"));
    await pin.manifest({ devDependencies: { "parent-pkg": pin.spec("parent.tgz") } });

    await expectRefused(pin, await pin.bun("cold", ["install", "--frozen-lockfile"]));
  });

  // Two checkouts of one project share the cache. A command in the checkout
  // that moved the line must not put the changed bytes where the checkout
  // with no edit takes its install from.
  describe.each(kinds)("%s, changed bytes, a checkout that shares the cache", kind => {
    it.each([[["install", "--dry-run"]], [["install", "--frozen-lockfile"]], [["install"]]])(
      "bun %j on a moved line leaves the cache of the project with no edit alone",
      async args => {
        await using pin = await pinned(kind);
        await pin.put(await tarballOf("v2"));
        await pin.manifest({ devDependencies: { [PKG]: pin.spec() } });
        await pin.bun("warm", args);

        // back to the project with no edit
        await pin.manifest({ dependencies: { [PKG]: pin.spec() } });
        await writeFile(join(pin.project, "bun.lock"), pin.pinnedLock);
        await pin.removeNodeModules();
        const result = await pin.bun("warm", ["install", "--frozen-lockfile"]);

        expect(result.out).not.toContain("error:");
        expect({ installed: await pin.installed(), requests: result.requests }).toEqual({
          installed: "v1",
          requests: 0,
        });
        expect(result.exitCode).toBe(0);
      },
    );
  });

  // bun reads the pin of a tarball from the lockfile of npm and of pnpm when the project has no bun.lock yet.
  describe("url, the lockfile of another package manager", () => {
    const foreign: Record<string, (url: string, integrity: string) => string> = {
      "package-lock.json": (url, integrity) =>
        JSON.stringify({
          name: "root",
          version: "1.0.0",
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": { name: "root", version: "1.0.0", dependencies: { [PKG]: url } },
            [`node_modules/${PKG}`]: { version: "1.0.0", resolved: url, integrity },
          },
        }),
      "pnpm-lock.yaml": (url, integrity) =>
        [
          "lockfileVersion: '9.0'",
          "",
          "settings:",
          "  autoInstallPeers: true",
          "  excludeLinksFromLockfile: false",
          "",
          "importers:",
          "",
          "  .:",
          "    dependencies:",
          `      ${PKG}:`,
          `        specifier: ${url}`,
          `        version: ${url}`,
          "",
          "packages:",
          "",
          `  ${PKG}@${url}:`,
          `    resolution: {integrity: ${integrity}, tarball: ${url}}`,
          "    version: 1.0.0",
          "",
          "snapshots:",
          "",
          `  ${PKG}@${url}: {}`,
          "",
        ].join("\n"),
    };
    const cases = [
      ["package-lock.json", "sha512"],
      ["package-lock.json", "sha1"],
      ["pnpm-lock.yaml", "sha512"],
    ] as const;

    describe.each(cases)("%s with a %s pin", (lockName, algorithm) => {
      it.each([
        ["with no edit", "dependencies"],
        ["when the line moves", "devDependencies"],
      ] as const)("refuses changed bytes %s", async (_, group) => {
        await using fx = fixture("url");
        await fx.put(await tarballOf("v2"));
        await writeFile(
          join(fx.project, lockName),
          foreign[lockName](fx.spec(), sri(algorithm, await tarballOf("v1"))),
        );
        await fx.manifest({ [group]: { [PKG]: fx.spec() } });

        const result = await fx.bun("cold", ["install"]);

        expect({ installed: await fx.installed(), cached: await fx.cached("cold") }).toEqual({
          installed: null,
          cached: [],
        });
        expect(result.out).toContain("Integrity check failed");
        expect(result.exitCode).toBe(1);
      });
    });
  });

  // A line that moves is the same dependency. It keeps its package, so bun does not ask for the tarball again.
  describe.each(kinds)("%s, changed bytes, warm cache", kind => {
    it.each([[["install"]], [["install", "--frozen-lockfile"]]])(
      "installs the pinned bytes from the cache when the line moves: bun %j",
      async args => {
        await using pin = await pinned(kind);
        await pin.put(await tarballOf("v2"));
        await pin.manifest({ devDependencies: { [PKG]: pin.spec() } });

        const result = await pin.bun("warm", args);

        expect(result.out).not.toContain("error:");
        expect({
          installed: await pin.installed(),
          requests: result.requests,
          pinned: (await pin.lock()).includes(pin.pin),
        }).toEqual({ installed: "v1", requests: 0, pinned: true });
        expect(result.exitCode).toBe(0);
      },
    );
  });

  // `bun update` asks for the bytes the tarball has now. bun.lock then pins what was installed.
  describe.each(kinds)("%s, bun update", kind => {
    const updates = [[["update"]], [["update", PKG]], [["update", "--latest"]]] as const;

    it.each(updates)("keeps the pin when the bytes are unchanged: bun %j", async args => {
      await using pin = await pinned(kind);

      const result = await pin.bun("cold", [...args]);

      expect(result.out).not.toContain("error:");
      expect({ installed: await pin.installed(), lock: await pin.lock() }).toEqual({
        installed: "v1",
        lock: pin.pinnedLock,
      });
      expect(result.exitCode).toBe(0);
    });

    it.each(updates)("installs changed bytes and pins them: bun %j", async args => {
      await using pin = await pinned(kind);
      const changed = await tarballOf("v2");
      await pin.put(changed);

      const update = await pin.bun("warm", [...args]);

      expect(update.out).not.toContain("error:");
      expect({ installed: await pin.installed(), lock: await pin.lock() }).toEqual({
        installed: "v2",
        lock: pin.pinnedLock.replace(pin.pin, sri("sha512", changed)),
      });
      expect(update.exitCode).toBe(0);

      // The new pin is the one an install on another machine checks.
      await pin.removeNodeModules();
      const install = await pin.bun("cold", ["install", "--frozen-lockfile"]);
      expect(install.out).not.toContain("error:");
      expect(await pin.installed()).toBe("v2");
      expect(install.exitCode).toBe(0);
    });

    it("bun update <package name> reaches a dependency that another key declares", async () => {
      await using pin = await pinned(kind, fx => fx.manifest({ dependencies: { "other-key": fx.spec() } }));
      const changed = await tarballOf("v2");
      await pin.put(changed);

      const result = await pin.bun("cold", ["update", PKG]);

      expect(result.out).not.toContain("error:");
      expect({ installed: await pin.installed(join("node_modules", "other-key")), lock: await pin.lock() }).toEqual({
        installed: "v2",
        lock: pin.pinnedLock.replace(pin.pin, sri("sha512", changed)),
      });
      expect(result.exitCode).toBe(0);
    });
  });

  it("file, bun add of the tarball installs changed bytes and pins them", async () => {
    await using pin = await pinned("file");
    const changed = await tarballOf("v2");
    await pin.put(changed);

    const result = await pin.bun("warm", ["add", "./vendor/one.tgz"]);

    expect(result.out).not.toContain("error:");
    expect({ installed: await pin.installed(), pinned: (await pin.lock()).includes(sri("sha512", changed)) }).toEqual({
      installed: "v2",
      pinned: true,
    });
    expect(result.exitCode).toBe(0);
  });

  describe.each(kinds)("%s, unchanged bytes", kind => {
    it.each([[["install"]], [["install", "--frozen-lockfile"]], [["ci"]]])(
      "installs the pinned bytes when the line moves: bun %j",
      async args => {
        await using pin = await pinned(kind);
        await pin.manifest({ devDependencies: { [PKG]: pin.spec() } });

        const result = await pin.bun("cold", args);

        expect(result.out).not.toContain("error:");
        expect({ installed: await pin.installed(), pinned: (await pin.lock()).includes(pin.pin) }).toEqual({
          installed: "v1",
          pinned: true,
        });
        expect(result.exitCode).toBe(0);
      },
    );
  });
});
