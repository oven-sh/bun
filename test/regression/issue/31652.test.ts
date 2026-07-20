import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { join } from "path";

// Build a minimal gzipped npm tarball containing a single package.json.
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
  buf.write("0", 156); // typeflag: regular file
  buf.write("ustar\0", 257);
  buf.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(octal(sum, 8), 148); // checksum
  return buf;
}
function pad512(len: number) {
  return Buffer.alloc((512 - (len % 512)) % 512, 0);
}
function buildTarball(pkgJson: object) {
  const body = Buffer.from(JSON.stringify(pkgJson) + "\n");
  const tar = Buffer.concat([
    tarHeader("package/package.json", body.length),
    body,
    pad512(body.length),
    Buffer.alloc(1024, 0), // two zero blocks = end-of-archive
  ]);
  const tgz = gzipSync(tar);
  return { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") };
}

// Regression test for https://github.com/oven-sh/bun/issues/31652
//
// `bun install -g @openai/codex` (and similar) aborted with
// `error: Invalid dependency name ""`. The trigger is an *optional* dependency
// declared with an empty key (`"optionalDependencies": { "": "..." }`) whose
// target does not resolve on the current platform. An optional dependency that
// fails to resolve keeps its empty name (the resolved-package name is never
// substituted), and the hoisting tree builder then rejected that empty name
// instead of skipping it — so the whole install failed.
//
// A dependency with an empty name has no `node_modules/<name>` folder to
// escape, so it must be tolerated the same way the lockfile parser and
// isolated installer already handle it. Previously this worked (Bun 1.3.x);
// it broke on 1.4.0-canary.
test("install does not abort on an unresolved optional dependency with an empty name (#31652)", async () => {
  // `top@1.0.0` declares an optional dependency under an empty key whose target
  // (a package literally named "") cannot be resolved.
  const top = buildTarball({ name: "top", version: "1.0.0" });

  let emptyNameManifestRequested = false;

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const base = `http://127.0.0.1:${server.port}`;
      if (url.pathname === "/top") {
        return Response.json({
          name: "top",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "top",
              version: "1.0.0",
              optionalDependencies: { "": "1.0.0" },
              dist: { integrity: top.integrity, tarball: `${base}/top/-/top-1.0.0.tgz` },
            },
          },
        });
      }
      if (url.pathname === "/top/-/top-1.0.0.tgz") {
        return new Response(top.tgz, { headers: { "content-length": String(top.tgz.length) } });
      }
      // The empty-name dependency resolves to a request for a package named "",
      // i.e. the registry root. Make it 404 so the optional dep fails to resolve.
      if (url.pathname === "/") {
        emptyNameManifestRequested = true;
      }
      return new Response("Not found", { status: 404 });
    },
  });

  using dir = tempDir("issue-31652", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { top: "1.0.0" },
    }),
    "bunfig.toml": `[install]\ncache = false\nregistry = "http://127.0.0.1:${server.port}/"\n`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The empty-name optional dependency must not abort the install.
  expect(stderr).not.toContain('Invalid dependency name ""');
  // An invalid (empty) package name is now dropped before any manifest
  // request; for an optional dependency that must be silent.
  expect(stderr).not.toContain("Invalid package name");
  expect(emptyNameManifestRequested).toBe(false);
  // The requested package must still be installed.
  expect(await Bun.file(join(String(dir), "node_modules", "top", "package.json")).exists()).toBe(true);
  // Assert the exit code last for a more useful message if a behavioral check fails.
  expect(exitCode).toBe(0);
});
