import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bun outdated --changelog", () => {
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

  test("shows repository URLs for outdated packages", async () => {
    const t1 = createMinimalTarball("no-deps", "1.0.0");
    const t2 = createMinimalTarball("no-deps", "2.0.0");

    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/no-deps")
          return Response.json({
            name: "no-deps",
            repository: { type: "git", url: "git+https://github.com/example/no-deps.git" },
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
          });
        if (url.pathname.includes("1.0.0") && url.pathname.endsWith(".tgz")) return new Response(t1);
        if (url.pathname.includes("2.0.0") && url.pathname.endsWith(".tgz")) return new Response(t2);
        return new Response("Not found", { status: 404 });
      },
    });

    using dir = tempDir("outdated-changelog", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({ name: "test-project", dependencies: { "no-deps": "1.0.0" } }),
    });

    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, installErr, installExit] = await Promise.all([
      install.stdout.text(),
      install.stderr.text(),
      install.exited,
    ]);
    expect(installErr).not.toContain("error:");
    expect(installExit).toBe(0);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "outdated", "--changelog"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("no-deps");
    expect(stdout).toContain("Changelogs:");
    expect(stdout).toContain("https://github.com/example/no-deps");
    expect(exitCode).toBe(0);
  });

  test("omits changelog section when no repository field", async () => {
    const t1 = createMinimalTarball("no-deps", "1.0.0");
    const t2 = createMinimalTarball("no-deps", "2.0.0");

    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/no-deps")
          return Response.json({
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
          });
        if (url.pathname.includes("1.0.0") && url.pathname.endsWith(".tgz")) return new Response(t1);
        if (url.pathname.includes("2.0.0") && url.pathname.endsWith(".tgz")) return new Response(t2);
        return new Response("Not found", { status: 404 });
      },
    });

    using dir = tempDir("outdated-no-changelog", {
      "bunfig.toml": `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"`,
      "package.json": JSON.stringify({ name: "test-project", dependencies: { "no-deps": "1.0.0" } }),
    });

    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , installExit] = await Promise.all([install.stdout.text(), install.stderr.text(), install.exited]);
    expect(installExit).toBe(0);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "outdated", "--changelog"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("no-deps");
    expect(stdout).not.toContain("Changelogs:");
    expect(exitCode).toBe(0);
  });
});
