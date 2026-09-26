import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { rm, writeFile } from "fs/promises";
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

// Minimal ustar tarball builders shared by the hand-rolled-tarball tests below.
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

describe.concurrent.each(["hoisted", "isolated"] as const)("tarball --force refresh (%s)", linker => {
  // https://github.com/oven-sh/bun/issues/31864 — URL/local tarballs are cached
  // under a folder named from the URL/path hash, not the content. When the bytes
  // behind the same URL changed, `bun install --force` copied the stale
  // extraction into node_modules and never re-downloaded, so the code never
  // updated. A forced re-download would also have tripped the lockfile-pinned
  // integrity, hence the reporter having to clear the cache + lockfile by hand.
  // One-package tarball whose package.json and index.js carry `marker`, so the
  // installed content can be asserted byte-for-byte.
  function buildTarball(marker: string, name = "my-url-pkg") {
    const files: Array<[string, Buffer]> = [
      ["package/package.json", Buffer.from(JSON.stringify({ name, version: "1.0.0" }) + "\n")],
      ["package/index.js", Buffer.from(`module.exports = ${JSON.stringify(marker)};\n`)],
    ];
    const parts: Buffer[] = [];
    for (const [name, body] of files) {
      parts.push(tarHeader(name, body.length), body, pad512(body.length));
    }
    parts.push(Buffer.alloc(1024, 0));
    const tgz = gzipSync(Buffer.concat(parts));
    return { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") };
  }

  it("re-downloads the changed tarball instead of reusing the stale cache", async () => {
    const v1 = buildTarball("VERSION_ONE");
    const v2 = buildTarball("VERSION_TWO");
    const v3 = buildTarball("VERSION_THREE");
    expect(v1.integrity).not.toBe(v2.integrity);

    // Same URL serves whatever `served` points at. Track every tarball request
    // so we can prove `--force` actually hit the network again.
    let served = v1;
    const tarballRequests: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/my-url-pkg.tgz")) {
          tarballRequests.push(served === v1 ? "v1" : served === v2 ? "v2" : "v3");
          const { tgz } = served;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const tarballUrl = `http://127.0.0.1:${server.port}/my-url-pkg.tgz`;

    using dir = tempDir("issue-31864-" + linker, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "my-url-pkg": tarballUrl },
      }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });

    const installedIndex = join(String(dir), "node_modules", "my-url-pkg", "index.js");
    const cacheDir = join(String(dir), ".cache");
    const tmpDir = join(String(dir), ".tmp");
    const spawnOpts = {
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: cacheDir, BUN_TMPDIR: tmpDir },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };

    // First install: serves v1 and populates the URL-hash cache folder.
    {
      await using proc = spawn({ cmd: [bunExe(), "install"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_ONE";\n');
    expect(tarballRequests).toEqual(["v1"]);
    const tmpEntriesAfterFirstInstall = await readdirSorted(tmpDir);

    // Swap the bytes served at the same URL, then force a reinstall. Before the
    // fix, `--force` copied the stale extraction and never re-requested the
    // tarball, so node_modules stayed on VERSION_ONE.
    served = v2;
    tarballRequests.length = 0;
    {
      await using proc = spawn({ cmd: [bunExe(), "install", "--force"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      // A naive re-download without recomputing integrity would reject v2
      // against v1's lockfile-pinned hash.
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(stderr).toContain(
        `warn: my-url-pkg changed since it was last installed; updating its integrity in the lockfile (was ${v1.integrity}, now ${v2.integrity})`,
      );
      expect(exitCode).toBe(0);
    }

    expect(tarballRequests).toEqual(["v2"]);
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_TWO";\n');
    // The refresh swapped the new extraction over the old cache folder. The
    // old tree must not be left behind in the temp dir.
    expect(await readdirSorted(tmpDir)).toEqual(tmpEntriesAfterFirstInstall);

    // The lockfile integrity should now match v2, so a later cache-cleared
    // install of the current bytes does not fail the integrity check.
    const lockContent = await file(join(String(dir), "bun.lock")).text();
    expect(lockContent).toContain(v2.integrity);
    expect(lockContent).not.toContain(v1.integrity);

    // `--silent` suppresses the warning like the other install warnings.
    served = v3;
    tarballRequests.length = 0;
    {
      await using proc = spawn({ cmd: [bunExe(), "install", "--force", "--silent"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout + stderr).toBe("");
      expect(exitCode).toBe(0);
    }
    expect(tarballRequests).toEqual(["v3"]);
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_THREE";\n');
    expect(await file(join(String(dir), "bun.lock")).text()).toContain(v3.integrity);
  });

  it("re-reads a changed local tarball at the same path", async () => {
    const v1 = buildTarball("VERSION_ONE");
    const v2 = buildTarball("VERSION_TWO");
    expect(v1.integrity).not.toBe(v2.integrity);

    // Local tarballs are cached by the same path-hash key as URLs, so the same
    // bug applies: overwriting the file at the same path must still refresh
    // under `--force`.
    using dir = tempDir("issue-31864-local-" + linker, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "my-url-pkg": "./pkg.tgz" },
      }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });
    const tgzPath = join(String(dir), "pkg.tgz");
    await writeFile(tgzPath, v1.tgz);

    const installedIndex = join(String(dir), "node_modules", "my-url-pkg", "index.js");
    const spawnOpts = {
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };

    {
      await using proc = spawn({ cmd: [bunExe(), "install"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_ONE";\n');

    // Overwrite the tarball at the same path, then force a reinstall.
    await writeFile(tgzPath, v2.tgz);
    {
      await using proc = spawn({ cmd: [bunExe(), "install", "--force"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }

    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_TWO";\n');

    const lockContent = await file(join(String(dir), "bun.lock")).text();
    expect(lockContent).toContain(v2.integrity);
    expect(lockContent).not.toContain(v1.integrity);
  });

  it("installs the tarball on a first --force install with no lockfile", async () => {
    // `--force` as the very first install (no bun.lock): the resolve phase
    // downloads+extracts the tarball and marks it done, so the install phase must
    // copy the fresh cache into node_modules. Without a `Done` guard on the
    // force-refresh cache-miss path, the install phase re-enqueued into the
    // already-drained task and silently skipped installing the package — the run
    // reported success with an empty node_modules.
    const v1 = buildTarball("VERSION_ONE");
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          return new Response(v1.tgz, { headers: { "content-length": String(v1.tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    using dir = tempDir("issue-31864-fresh-" + linker, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "my-url-pkg": `http://127.0.0.1:${server.port}/my-url-pkg.tgz` },
      }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });

    await using proc = spawn({
      cmd: [bunExe(), "install", "--force"],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await file(join(String(dir), "node_modules", "my-url-pkg", "index.js")).text()).toBe(
      'module.exports = "VERSION_ONE";\n',
    );
  });

  it("re-adding the URL on the command line refreshes it without --force", async () => {
    // Bun 1.3 refreshed a URL tarball whenever it was explicitly named on the
    // command line (`bun i <url>`), with no --force. Naming the dep makes it an
    // update request, which re-fetches the bytes at the same URL.
    const v1 = buildTarball("VERSION_ONE");
    const v2 = buildTarball("VERSION_TWO");

    let serveV2 = false;
    const tarballRequests: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          tarballRequests.push(serveV2 ? "v2" : "v1");
          const { tgz } = serveV2 ? v2 : v1;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const tarballUrl = `http://127.0.0.1:${server.port}/my-url-pkg.tgz`;

    using dir = tempDir("issue-31864-readd-" + linker, {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });
    const installedIndex = join(String(dir), "node_modules", "my-url-pkg", "index.js");
    const spawnOpts = {
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };

    // First add: installs v1, writes package.json + bun.lock.
    {
      await using proc = spawn({ cmd: [bunExe(), "install", tarballUrl], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_ONE";\n');
    expect(tarballRequests).toEqual(["v1"]);

    // Swap the bytes at the same URL, then re-add the same URL (no --force).
    serveV2 = true;
    tarballRequests.length = 0;
    {
      await using proc = spawn({ cmd: [bunExe(), "install", tarballUrl], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }

    expect(tarballRequests).toEqual(["v2"]);
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_TWO";\n');

    // package.json must not grow a second, URL-keyed entry (#30499), and the
    // lockfile integrity must now pin v2.
    const pkg = JSON.parse(await file(join(String(dir), "package.json")).text());
    expect(Object.keys(pkg.dependencies)).toEqual(["my-url-pkg"]);
    const lockContent = await file(join(String(dir), "bun.lock")).text();
    expect(lockContent).toContain(v2.integrity);
    expect(lockContent).not.toContain(v1.integrity);
  });

  it("bun update <name> installs the re-extracted tarball instead of dead-ending", async () => {
    // `bun update` re-fetches the tarball during the resolve phase. The install
    // phase must copy that fresh extraction into node_modules rather than
    // re-enqueue into the already-drained task (which left node_modules stale
    // on hoisted and hung the isolated installer). The lockfile row is not
    // asserted here: `bun update` keeps the old row for tarball deps on main
    // regardless of this change, tracked in #44000.
    const v1 = buildTarball("VERSION_ONE");
    const v2 = buildTarball("VERSION_TWO");

    let serveV2 = false;
    const tarballRequests: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          tarballRequests.push(serveV2 ? "v2" : "v1");
          const { tgz } = serveV2 ? v2 : v1;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const tarballUrl = `http://127.0.0.1:${server.port}/my-url-pkg.tgz`;

    using dir = tempDir("issue-31864-update-" + linker, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "my-url-pkg": tarballUrl },
      }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });
    const installedIndex = join(String(dir), "node_modules", "my-url-pkg", "index.js");
    const spawnOpts = {
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };

    {
      await using proc = spawn({ cmd: [bunExe(), "install"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_ONE";\n');
    expect(tarballRequests).toEqual(["v1"]);

    serveV2 = true;
    tarballRequests.length = 0;
    {
      await using proc = spawn({ cmd: [bunExe(), "update", "my-url-pkg"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }

    expect(tarballRequests).toEqual(["v2"]);
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_TWO";\n');
  });

  it.each(["--frozen-lockfile", "--no-save"])("does not refresh under %s", async flag => {
    // A run that does not save the lockfile cannot record a new hash, so a
    // refresh would leave node_modules holding bytes the lockfile does not
    // pin. `--force` must keep the cached extraction and the lockfile untouched.
    const v1 = buildTarball("VERSION_ONE");
    const v2 = buildTarball("VERSION_TWO");

    let serveV2 = false;
    const tarballRequests: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          tarballRequests.push(serveV2 ? "v2" : "v1");
          const { tgz } = serveV2 ? v2 : v1;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    using dir = tempDir("issue-31864-nosave-" + linker, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "my-url-pkg": `http://127.0.0.1:${server.port}/my-url-pkg.tgz` },
      }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });
    const installedIndex = join(String(dir), "node_modules", "my-url-pkg", "index.js");
    const spawnOpts = {
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };

    {
      await using proc = spawn({ cmd: [bunExe(), "install"], ...spawnOpts });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    const lockBefore = await file(join(String(dir), "bun.lock")).text();

    serveV2 = true;
    tarballRequests.length = 0;
    {
      await using proc = spawn({ cmd: [bunExe(), "install", "--force", flag], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }

    expect(tarballRequests).toEqual([]);
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_ONE";\n');
    expect(await file(join(String(dir), "bun.lock")).text()).toBe(lockBefore);
  });

  it("installs from the cache under --offline instead of forcing a download", async () => {
    // `--offline` never touches the network; a forced refresh would otherwise
    // report the cached tarball as missing and fail the install.
    const v1 = buildTarball("VERSION_ONE");
    const tarballRequests: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          tarballRequests.push("hit");
          return new Response(v1.tgz, { headers: { "content-length": String(v1.tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    using dir = tempDir("issue-31864-offline-" + linker, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "my-url-pkg": `http://127.0.0.1:${server.port}/my-url-pkg.tgz` },
      }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });
    const installedIndex = join(String(dir), "node_modules", "my-url-pkg", "index.js");
    const spawnOpts = {
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };

    {
      await using proc = spawn({ cmd: [bunExe(), "install"], ...spawnOpts });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(tarballRequests).toEqual(["hit"]);

    tarballRequests.length = 0;
    {
      await using proc = spawn({ cmd: [bunExe(), "install", "--force", "--offline"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout + stderr).not.toContain("is not in the cache");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(tarballRequests).toEqual([]);
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_ONE";\n');
  });

  it("a named update in one workspace does not refresh the same-named tarball in another", async () => {
    // A named request matches dependency rows by name, so without the update
    // scope `bun update my-url-pkg` run inside ws-a would also re-fetch ws-b's
    // unrelated `my-url-pkg`, dropping its integrity pin along the way.
    const a1 = buildTarball("A_ONE", "my-url-pkg");
    const a2 = buildTarball("A_TWO", "my-url-pkg");
    const b1 = buildTarball("B_ONE", "my-url-pkg");
    const b2 = buildTarball("B_TWO", "my-url-pkg");

    let serveV2 = false;
    const requests: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path.endsWith("/a.tgz")) {
          requests.push("a");
          const { tgz } = serveV2 ? a2 : a1;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        if (path.endsWith("/b.tgz")) {
          requests.push("b");
          const { tgz } = serveV2 ? b2 : b1;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const aUrl = `http://127.0.0.1:${server.port}/a.tgz`;
    const bUrl = `http://127.0.0.1:${server.port}/b.tgz`;

    using dir = tempDir("issue-31864-wsscope-" + linker, {
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
      "packages/ws-a/package.json": JSON.stringify({
        name: "ws-a",
        version: "1.0.0",
        dependencies: { "my-url-pkg": aUrl },
      }),
      "packages/ws-b/package.json": JSON.stringify({
        name: "ws-b",
        version: "1.0.0",
        dependencies: { "my-url-pkg": bUrl },
      }),
    });
    const env2 = { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") };

    {
      await using proc = spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: env2,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(requests.sort()).toEqual(["a", "b"]);

    // Both tarballs change; update only ws-a's by name from inside ws-a.
    serveV2 = true;
    requests.length = 0;
    {
      await using proc = spawn({
        cmd: [bunExe(), "update", "my-url-pkg"],
        cwd: join(String(dir), "packages", "ws-a"),
        env: env2,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }
    expect(requests).toEqual(["a"]);

    // ws-a has the new bytes, ws-b keeps the old ones, and the lockfile pins
    // exactly those.
    const resolved = async (ws: string) => {
      await using proc = spawn({
        cmd: [bunExe(), "-e", "console.log(require('my-url-pkg'))"],
        cwd: join(String(dir), "packages", ws),
        env: env2,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return stdout.trim();
    };
    expect([await resolved("ws-a"), await resolved("ws-b")]).toEqual(["A_TWO", "B_ONE"]);
    const lockContent = await file(join(String(dir), "bun.lock")).text();
    expect(lockContent).toContain(a2.integrity);
    expect(lockContent).toContain(b1.integrity);
    expect(lockContent).not.toContain(a1.integrity);
    expect(lockContent).not.toContain(b2.integrity);
  });

  it("a refresh in one project does not satisfy another project's older pin from the shared cache", async () => {
    // Two projects share the cache and pin the same URL tarball. After project A
    // refreshes it, the cache folder holds the new bytes under the same URL
    // key. Project B still pins the old hash, so its install must not take the
    // folder as a hit: it re-downloads against its pin and fails while the
    // server keeps serving the new bytes.
    const v1 = buildTarball("VERSION_ONE");
    const v2 = buildTarball("VERSION_TWO");

    let served = v1;
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          const { tgz } = served;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const pkgJson = JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "my-url-pkg": `http://127.0.0.1:${server.port}/my-url-pkg.tgz` },
    });
    const bunfig = `[install]\nlinker = "${linker}"\n`;
    using dir = tempDir("issue-31864-shared-" + linker, {
      "a/package.json": pkgJson,
      "a/bunfig.toml": bunfig,
      "b/package.json": pkgJson,
      "b/bunfig.toml": bunfig,
    });
    const env2 = { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") };
    const run = async (project: string, args: string[]) => {
      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd: join(String(dir), project),
        env: env2,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { output: stdout + stderr, exitCode };
    };
    const installedIndex = (project: string) => join(String(dir), project, "node_modules", "my-url-pkg", "index.js");
    const lockfile = (project: string) => file(join(String(dir), project, "bun.lock")).text();

    for (const project of ["a", "b"]) {
      const { output, exitCode } = await run(project, []);
      expect(output).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await file(installedIndex(project)).text()).toBe('module.exports = "VERSION_ONE";\n');
    }
    const lockB = await lockfile("b");
    expect(lockB).toContain(v1.integrity);

    served = v2;
    {
      const { output, exitCode } = await run("a", ["--force"]);
      expect(output).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await file(installedIndex("a")).text()).toBe('module.exports = "VERSION_TWO";\n');
      expect(await lockfile("a")).toContain(v2.integrity);
    }
    // B installs into a fresh node_modules, like a new checkout or a CI job.
    await rm(join(String(dir), "b", "node_modules"), { recursive: true, force: true });
    {
      const { output, exitCode } = await run("b", ["--frozen-lockfile"]);
      expect(output).toContain("Integrity check failed");
      expect(exitCode).not.toBe(0);
      expect(await lockfile("b")).toBe(lockB);
    }

    // Once the server serves the pinned bytes again, B installs them.
    served = v1;
    {
      const { output, exitCode } = await run("b", ["--frozen-lockfile"]);
      expect(output).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await file(installedIndex("b")).text()).toBe('module.exports = "VERSION_ONE";\n');
      expect(await lockfile("b")).toBe(lockB);
    }
  });

  it("a cache folder without its integrity tag is a miss", async () => {
    // The tag is what ties the folder to the pin. Without it (a write that
    // never happened, a crash between the folder swap and the tag write) the
    // folder must not be trusted: the install re-downloads and verifies.
    const v1 = buildTarball("VERSION_ONE");
    const tarballRequests: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          tarballRequests.push("hit");
          return new Response(v1.tgz, { headers: { "content-length": String(v1.tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    using dir = tempDir("issue-31864-notag-" + linker, {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "my-url-pkg": `http://127.0.0.1:${server.port}/my-url-pkg.tgz` },
      }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });
    const cacheDir = join(String(dir), ".cache");
    const spawnOpts = {
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: cacheDir },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };

    {
      await using proc = spawn({ cmd: [bunExe(), "install"], ...spawnOpts });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    const tags = Array.from(new Bun.Glob("@T@*.bun-tag").scanSync({ cwd: cacheDir, absolute: true }));
    expect(tags).toHaveLength(1);
    expect(await file(tags[0]).text()).toBe(v1.integrity);
    expect(tarballRequests).toEqual(["hit"]);

    await rm(tags[0]);
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });
    tarballRequests.length = 0;
    {
      await using proc = spawn({ cmd: [bunExe(), "install", "--frozen-lockfile"], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout + stderr).not.toContain("Integrity check failed");
      expect(exitCode).toBe(0);
    }
    expect(tarballRequests).toEqual(["hit"]);
    expect(await file(tags[0]).text()).toBe(v1.integrity);
    expect(await file(join(String(dir), "node_modules", "my-url-pkg", "index.js")).text()).toBe(
      'module.exports = "VERSION_ONE";\n',
    );
  });

  it("--no-verify records the hash of the extracted bytes, not the unchecked pin", async () => {
    // A `--no-verify` install of changed bytes must not leave a tag that
    // vouches for the old pin, or a verifying project sharing the cache would
    // take the new bytes as a hit.
    const v1 = buildTarball("VERSION_ONE");
    const v2 = buildTarball("VERSION_TWO");
    let served = v1;
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          const { tgz } = served;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const pkgJson = JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { "my-url-pkg": `http://127.0.0.1:${server.port}/my-url-pkg.tgz` },
    });
    const bunfig = `[install]\nlinker = "${linker}"\n`;
    using dir = tempDir("issue-31864-noverify-" + linker, {
      "a/package.json": pkgJson,
      "a/bunfig.toml": bunfig,
      "b/package.json": pkgJson,
      "b/bunfig.toml": bunfig,
    });
    const cacheDir = join(String(dir), ".cache");
    const run = async (project: string, args: string[]) => {
      await using proc = spawn({
        cmd: [bunExe(), "install", ...args],
        cwd: join(String(dir), project),
        env: { ...env, BUN_INSTALL_CACHE_DIR: cacheDir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { output: stdout + stderr, exitCode };
    };

    for (const project of ["a", "b"]) {
      const { output, exitCode } = await run(project, []);
      expect(output).not.toContain("error:");
      expect(exitCode).toBe(0);
    }

    // Cold cache, changed bytes, verification off: A installs v2 under a v1 pin.
    await rm(cacheDir, { recursive: true, force: true });
    await rm(join(String(dir), "a", "node_modules"), { recursive: true, force: true });
    served = v2;
    {
      const { output, exitCode } = await run("a", ["--no-verify"]);
      expect(output).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await file(join(String(dir), "a", "node_modules", "my-url-pkg", "index.js")).text()).toBe(
        'module.exports = "VERSION_TWO";\n',
      );
    }
    const tags = Array.from(new Bun.Glob("@T@*.bun-tag").scanSync({ cwd: cacheDir, absolute: true }));
    expect(tags).toHaveLength(1);
    expect(await file(tags[0]).text()).toBe(v2.integrity);

    // B verifies into a fresh node_modules: the folder does not match its pin,
    // so it downloads and fails.
    await rm(join(String(dir), "b", "node_modules"), { recursive: true, force: true });
    {
      const { output, exitCode } = await run("b", ["--frozen-lockfile"]);
      expect(output).toContain("Integrity check failed");
      expect(exitCode).not.toBe(0);
    }
  });

  it("a new alias of an already pinned tarball is verified against that pin", async () => {
    // A plain install resolves a new dependency row on a URL another row
    // already pins. The fetch must verify against that pin: on changed bytes
    // it fails instead of writing the new bytes into the cache under a tag the
    // existing row does not match.
    const v1 = buildTarball("VERSION_ONE");
    const v2 = buildTarball("VERSION_TWO");
    let served = v1;
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
          const { tgz } = served;
          return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const tarballUrl = `http://127.0.0.1:${server.port}/my-url-pkg.tgz`;
    using dir = tempDir("issue-31864-alias-" + linker, {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "my-url-pkg": tarballUrl } }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });
    const spawnOpts = {
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };
    const install = async (...args: string[]) => {
      await using proc = spawn({ cmd: [bunExe(), "install", ...args], ...spawnOpts });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { output: stdout + stderr, exitCode };
    };
    const installedIndex = join(String(dir), "node_modules", "my-url-pkg", "index.js");

    {
      const { output, exitCode } = await install();
      expect(output).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    const lockBefore = await file(join(String(dir), "bun.lock")).text();
    expect(lockBefore).toContain(v1.integrity);

    // Add a second row on the same URL while the server serves other bytes.
    served = v2;
    await writeFile(
      join(String(dir), "package.json"),
      JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "my-url-pkg": tarballUrl, "my-url-pkg-alias": tarballUrl },
      }),
    );
    {
      const { output, exitCode } = await install();
      expect(output).toContain("Integrity check failed");
      expect(exitCode).not.toBe(0);
    }
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_ONE";\n');
    expect(await file(join(String(dir), "bun.lock")).text()).toBe(lockBefore);

    // With the pinned bytes served again the new row resolves and installs.
    served = v1;
    {
      const { output, exitCode } = await install();
      expect(output).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(await file(installedIndex).text()).toBe('module.exports = "VERSION_ONE";\n');
  });

  it.skipIf(linker !== "isolated")(
    "keeps the lockfile pin for a global-store entry whose tarball left the cache",
    async () => {
      // A global-store entry is keyed by the integrity the lockfile held when the
      // install started. If the extracted tarball is gone from the cache but the
      // store entry is not, `--force` must re-download against the pinned hash
      // and fail on changed bytes, instead of publishing the new bytes under the
      // key other projects still link to.
      const v1 = buildTarball("VERSION_ONE");
      const v2 = buildTarball("VERSION_TWO");

      let serveV2 = false;
      await using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          if (new URL(req.url).pathname.endsWith("/my-url-pkg.tgz")) {
            const { tgz } = serveV2 ? v2 : v1;
            return new Response(tgz, { headers: { "content-length": String(tgz.length) } });
          }
          return new Response("Not found", { status: 404 });
        },
      });
      const tarballUrl = `http://127.0.0.1:${server.port}/my-url-pkg.tgz`;

      using dir = tempDir("issue-31864-gvs-", {
        "package.json": JSON.stringify({
          name: "app",
          version: "1.0.0",
          dependencies: { "my-url-pkg": tarballUrl },
        }),
        "bunfig.toml": `[install]\nlinker = "isolated"\nglobalStore = true\n`,
      });
      const cacheDir = join(String(dir), ".cache");
      const spawnOpts = {
        cwd: String(dir),
        env: { ...env, BUN_INSTALL_CACHE_DIR: cacheDir },
        stdout: "pipe" as const,
        stderr: "pipe" as const,
      };

      {
        await using proc = spawn({ cmd: [bunExe(), "install"], ...spawnOpts });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("error:");
        expect(stdout + stderr).not.toContain("Integrity check failed");
        expect(exitCode).toBe(0);
      }
      const storeIndex = Array.from(
        new Bun.Glob("*/node_modules/my-url-pkg/index.js").scanSync({ cwd: join(cacheDir, "links"), absolute: true }),
      );
      expect(storeIndex).toHaveLength(1);
      expect(await file(storeIndex[0]).text()).toBe('module.exports = "VERSION_ONE";\n');

      // Drop the extracted tarball from the cache, keep the global store.
      for (const name of await readdirSorted(cacheDir)) {
        if (name !== "links") await rm(join(cacheDir, name), { recursive: true, force: true });
      }

      serveV2 = true;
      {
        await using proc = spawn({ cmd: [bunExe(), "install", "--force"], ...spawnOpts });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout + stderr).toContain("Integrity check failed");
        expect(exitCode).not.toBe(0);
      }

      expect(await file(storeIndex[0]).text()).toBe('module.exports = "VERSION_ONE";\n');
      const lockContent = await file(join(String(dir), "bun.lock")).text();
      expect(lockContent).toContain(v1.integrity);
      expect(lockContent).not.toContain(v2.integrity);
    },
  );
});
