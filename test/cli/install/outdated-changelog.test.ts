import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

describe.concurrent("bun outdated --changelog", () => {
  function createMinimalTarball(name: string, version: string): Buffer {
    const packageJson = JSON.stringify({ name, version });
    const content = Buffer.from(packageJson);
    const header = Buffer.alloc(512);
    header.write("package/package.json", 0, 100);
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
    const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
    content.copy(padded);
    return Buffer.from(Bun.gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)])));
  }

  function integrity(buf: Buffer): string {
    return `sha512-${new Bun.CryptoHasher("sha512").update(buf).digest("base64")}`;
  }

  // Mock registry. `repository` is included only when requested, so the same
  // server exercises both the with-repo and no-repo paths.
  // `repository` accepts the npm object form, a raw string, or undefined to omit it.
  function serveRegistry(repository?: { type: string; url: string } | string) {
    const t1 = createMinimalTarball("no-deps", "1.0.0");
    const t2 = createMinimalTarball("no-deps", "2.0.0");
    return Bun.serve({
      port: 0,
      fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/no-deps") {
          const meta: any = {
            name: "no-deps",
            "dist-tags": { latest: "2.0.0" },
            versions: {
              "1.0.0": {
                name: "no-deps",
                version: "1.0.0",
                dist: {
                  tarball: `http://localhost:${server.port}/no-deps/-/no-deps-1.0.0.tgz`,
                  integrity: integrity(t1),
                },
              },
              "2.0.0": {
                name: "no-deps",
                version: "2.0.0",
                dist: {
                  tarball: `http://localhost:${server.port}/no-deps/-/no-deps-2.0.0.tgz`,
                  integrity: integrity(t2),
                },
              },
            },
          };
          if (repository !== undefined) meta.repository = repository;
          return Response.json(meta);
        }
        if (url.pathname.includes("1.0.0") && url.pathname.endsWith(".tgz")) return new Response(t1);
        if (url.pathname.includes("2.0.0") && url.pathname.endsWith(".tgz")) return new Response(t2);
        return new Response("Not found", { status: 404 });
      },
    });
  }

  async function runInstall(dir: string, env: Record<string, string | undefined>) {
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([install.stdout.text(), install.stderr.text(), install.exited]);
    return { stderr, exitCode };
  }

  async function runOutdatedChangelog(dir: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "outdated", "--changelog"],
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, exitCode };
  }

  test("shows repository URLs for outdated packages", async () => {
    await using server = serveRegistry({ type: "git", url: "git+https://github.com/example/no-deps.git" });
    const env = { ...bunEnv, NO_COLOR: "1" };
    using dir = tempDir("outdated-changelog", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({ name: "test-project", dependencies: { "no-deps": "1.0.0" } }),
    });

    const install = await runInstall(String(dir), env);
    expect(install.stderr).not.toContain("error:");
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = await runOutdatedChangelog(String(dir), env);
    expect(stdout).toContain("no-deps");
    expect(stdout).toContain("Changelogs:");
    expect(stdout).toContain("https://github.com/example/no-deps");
    expect(exitCode).toBe(0);
  });

  test("omits changelog section when no repository field", async () => {
    await using server = serveRegistry();
    const env = { ...bunEnv, NO_COLOR: "1" };
    using dir = tempDir("outdated-no-changelog", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({ name: "test-project", dependencies: { "no-deps": "1.0.0" } }),
    });

    const install = await runInstall(String(dir), env);
    expect(install.stderr).not.toContain("error:");
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = await runOutdatedChangelog(String(dir), env);
    expect(stdout).toContain("no-deps");
    expect(stdout).not.toContain("Changelogs:");
    expect(exitCode).toBe(0);
  });

  // Caching enabled: the second run loads the manifest from the on-disk cache,
  // where repository_url is absent (it is never serialized). This exercises the
  // re-fetch arm in PopulateManifestCache that re-requests the extended manifest
  // when --changelog needs repository_url.
  test("warm cache still shows changelog URLs", async () => {
    await using server = serveRegistry({ type: "git", url: "git+https://github.com/example/no-deps.git" });
    using cacheDir = tempDir("outdated-warm-cache-dir", {});
    using dir = tempDir("outdated-warm-cache", {
      "bunfig.toml": `[install]\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({ name: "test-project", dependencies: { "no-deps": "1.0.0" } }),
    });
    const env = { ...bunEnv, NO_COLOR: "1", BUN_INSTALL_CACHE_DIR: join(String(cacheDir), ".bun-cache") };

    const install = await runInstall(String(dir), env);
    expect(install.stderr).not.toContain("error:");
    expect(install.exitCode).toBe(0);

    // First run (cold cache) — populates the disk cache.
    const first = await runOutdatedChangelog(String(dir), env);
    expect(first.stdout).toContain("Changelogs:");
    expect(first.stdout).toContain("https://github.com/example/no-deps");
    expect(first.exitCode).toBe(0);

    // Second run (warm cache) — repository_url is re-fetched, URL still shown.
    const second = await runOutdatedChangelog(String(dir), env);
    expect(second.stdout).toContain("Changelogs:");
    expect(second.stdout).toContain("https://github.com/example/no-deps");
    expect(second.exitCode).toBe(0);
  });

  // A git:// URL on a non-GitHub host must keep its own host, not be rewritten
  // to github.com.
  test("non-GitHub host keeps its own domain", async () => {
    await using server = serveRegistry("git://gitlab.gnome.org/GNOME/gtk.git");
    const env = { ...bunEnv, NO_COLOR: "1" };
    using dir = tempDir("outdated-nongithub", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({ name: "test-project", dependencies: { "no-deps": "1.0.0" } }),
    });

    const install = await runInstall(String(dir), env);
    expect(install.stderr).not.toContain("error:");
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = await runOutdatedChangelog(String(dir), env);
    expect(stdout).toContain("Changelogs:");
    expect(stdout).toContain("https://gitlab.gnome.org/GNOME/gtk");
    expect(stdout).not.toContain("github.com");
    expect(exitCode).toBe(0);
  });

  // A repository URL carrying userinfo (git@) must be shown without the
  // embedded credentials, not omitted and not printed verbatim.
  test("strips userinfo from repository URL", async () => {
    await using server = serveRegistry({ type: "git", url: "git+https://git@github.com/example/no-deps.git" });
    const env = { ...bunEnv, NO_COLOR: "1" };
    using dir = tempDir("outdated-userinfo", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({ name: "test-project", dependencies: { "no-deps": "1.0.0" } }),
    });

    const install = await runInstall(String(dir), env);
    expect(install.stderr).not.toContain("error:");
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = await runOutdatedChangelog(String(dir), env);
    expect(stdout).toContain("Changelogs:");
    expect(stdout).toContain("https://github.com/example/no-deps");
    expect(stdout).not.toContain("git@");
    expect(exitCode).toBe(0);
  });
});
