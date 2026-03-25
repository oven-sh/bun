import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("bun outdated --changelog", () => {
  function createMinimalTarball(name: string, version: string): Buffer {
    const packageJson = JSON.stringify({ name, version });
    const content = Buffer.from(packageJson);

    const header = Buffer.alloc(512);
    const filename = "package/package.json";
    header.write(filename, 0, Math.min(filename.length, 100));
    header.write("0000644\0", 100, 8);
    header.write("0000000\0", 108, 8);
    header.write("0000000\0", 116, 8);
    header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    header.write("00000000000\0", 136, 12);
    header[156] = 0x30;
    header.write("ustar\0", 257, 6);
    header.write("00", 263, 2);

    header.fill(0x20, 148, 156);
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i];
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);

    const contentPadded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
    content.copy(contentPadded);
    const tar = Buffer.concat([header, contentPadded, Buffer.alloc(1024)]);
    return Buffer.from(Bun.gzipSync(tar));
  }

  function computeIntegrity(buf: Buffer): string {
    const hash = new Bun.CryptoHasher("sha512").update(buf).digest("base64");
    return `sha512-${hash}`;
  }

  async function setupMockRegistry(opts: { name: string; repository?: object | string }) {
    const tarball1 = createMinimalTarball(opts.name, "1.0.0");
    const tarball2 = createMinimalTarball(opts.name, "2.0.0");
    const integrity1 = computeIntegrity(tarball1);
    const integrity2 = computeIntegrity(tarball2);

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === `/${opts.name}`) {
          const meta: any = {
            name: opts.name,
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": {
                name: opts.name,
                version: "1.0.0",
                dist: {
                  tarball: `http://localhost:${server.port}/${opts.name}/-/${opts.name}-1.0.0.tgz`,
                  integrity: integrity1,
                },
              },
              "2.0.0": {
                name: opts.name,
                version: "2.0.0",
                dist: {
                  tarball: `http://localhost:${server.port}/${opts.name}/-/${opts.name}-2.0.0.tgz`,
                  integrity: integrity2,
                },
              },
            },
          };
          if (opts.repository) meta.repository = opts.repository;
          return Response.json(meta);
        }
        if (url.pathname.includes("1.0.0") && url.pathname.endsWith(".tgz")) {
          return new Response(tarball1);
        }
        if (url.pathname.includes("2.0.0") && url.pathname.endsWith(".tgz")) {
          return new Response(tarball2);
        }
        return new Response("Not found", { status: 404 });
      },
    });
    return server;
  }

  async function runOutdatedChangelog(
    cwd: string,
    env: Record<string, string | undefined> = { ...bunEnv, NO_COLOR: "1" },
  ): Promise<{ stdout: string; exitCode: number }> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "outdated", "--changelog"],
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, exitCode };
  }

  test("shows repository URLs for outdated packages", async () => {
    await using server = await setupMockRegistry({
      name: "no-deps",
      repository: { type: "git", url: "git+https://github.com/example/no-deps.git" },
    });

    using dir = tempDir("outdated-changelog", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({
        name: "test-project",
        dependencies: { "no-deps": "1.0.0" },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const installStderr = await installProc.stderr.text();
    expect(installStderr).not.toContain("error:");
    expect(await installProc.exited).toBe(0);

    const result = await runOutdatedChangelog(String(dir));
    expect(result.stdout).toContain("no-deps");
    expect(result.stdout).toContain("Changelogs:");
    expect(result.stdout).toContain("https://github.com/example/no-deps");
    expect(result.exitCode).toBe(0);
  });

  test("omits changelog section when no repository field exists", async () => {
    await using server = await setupMockRegistry({
      name: "no-deps",
      // no repository field
    });

    using dir = tempDir("outdated-no-changelog", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({
        name: "test-project",
        dependencies: { "no-deps": "1.0.0" },
      }),
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    const result = await runOutdatedChangelog(String(dir));
    expect(result.stdout).toContain("no-deps");
    expect(result.stdout).not.toContain("Changelogs:");
    expect(result.exitCode).toBe(0);
  });

  test("warm cache still shows changelog URLs", async () => {
    await using server = await setupMockRegistry({
      name: "no-deps",
      repository: { type: "git", url: "git+https://github.com/example/no-deps.git" },
    });

    // Use caching enabled (no cache=false)
    using cacheDir = tempDir("outdated-cache-dir", {});
    using dir = tempDir("outdated-warm-cache", {
      "bunfig.toml": `[install]\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({
        name: "test-project",
        dependencies: { "no-deps": "1.0.0" },
      }),
    });

    const testEnv = { ...bunEnv, NO_COLOR: "1", BUN_INSTALL_CACHE_DIR: join(String(cacheDir), ".bun-cache") };

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installProc.exited).toBe(0);

    // First run (cold cache) — populates disk cache
    const result1 = await runOutdatedChangelog(String(dir), testEnv);
    expect(result1.stdout).toContain("Changelogs:");
    expect(result1.stdout).toContain("https://github.com/example/no-deps");
    expect(result1.exitCode).toBe(0);

    // Second run (warm cache) — should still show URLs
    const result2 = await runOutdatedChangelog(String(dir), testEnv);
    expect(result2.stdout).toContain("Changelogs:");
    expect(result2.stdout).toContain("https://github.com/example/no-deps");
    expect(result2.exitCode).toBe(0);
  });
});
