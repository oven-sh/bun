import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// ── minimal gzipped npm tarball builder ───────────────────────────────────
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
  buf.write(octal(sum, 8), 148);
  return buf;
}
function pad512(len: number) {
  return Buffer.alloc((512 - (len % 512)) % 512, 0);
}
function buildTarball(files: Record<string, string>) {
  const chunks: Buffer[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const body = Buffer.from(contents);
    chunks.push(tarHeader("package/" + name, body.length), body, pad512(body.length));
  }
  chunks.push(Buffer.alloc(1024, 0)); // two zero blocks = end-of-archive
  const tgz = gzipSync(Buffer.concat(chunks));
  return { tgz, integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64") };
}

// Regression test for https://github.com/oven-sh/bun/issues/6988
//
// `bun run <file>` auto-install resolved a top-level import into the global
// cache, but then failed to resolve that package's own dependencies when the
// importing file sat under a *nested* package.json inside the cached package.
// The nested package.json's `dependencies` overrode the package root's, so
// auto-install looked for a version constraint that was never installed.
//
// Real-world trigger: `@hiveio/hive-js` ships `lib/auth/ecc/package.json` with
// `"bs58": "^3.0.0"` while the package root declares `"bs58": "^4.0.0"`.
test("auto-install resolves transitive deps through a nested package.json (#6988)", async () => {
  // `inner` only exists at 2.0.0. The nested package.json in `outer` asks for
  // ^1.0.0; if the resolver honors it, resolution fails.
  const inner = buildTarball({
    "package.json": JSON.stringify({ name: "inner", version: "2.0.0", main: "index.js" }),
    "index.js": `module.exports = "inner@2.0.0";\n`,
  });
  // `outer`'s entry point requires `inner` from a file that sits one level
  // *below* a nested package.json whose `dependencies` disagree with the
  // package root, matching the hive-js layout (ecc/src/address.js under
  // ecc/package.json). The extra `src/` level exercises the parent
  // propagation in `dir_info_uncached` as well as the own-package.json gate.
  const outer = buildTarball({
    "package.json": JSON.stringify({
      name: "outer",
      version: "1.0.0",
      main: "lib/sub/src/entry.js",
      dependencies: { inner: "^2.0.0" },
    }),
    "lib/sub/package.json": JSON.stringify({
      name: "sub",
      version: "1.0.0",
      dependencies: { inner: "^1.0.0" },
    }),
    "lib/sub/src/entry.js": `module.exports = require("inner");\n`,
  });

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const base = `http://127.0.0.1:${server.port}`;
      if (url.pathname === "/outer") {
        return Response.json({
          name: "outer",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "outer",
              version: "1.0.0",
              dependencies: { inner: "^2.0.0" },
              dist: { integrity: outer.integrity, tarball: `${base}/outer/-/outer-1.0.0.tgz` },
            },
          },
        });
      }
      if (url.pathname === "/inner") {
        return Response.json({
          name: "inner",
          "dist-tags": { latest: "2.0.0" },
          versions: {
            "2.0.0": {
              name: "inner",
              version: "2.0.0",
              dist: { integrity: inner.integrity, tarball: `${base}/inner/-/inner-2.0.0.tgz` },
            },
          },
        });
      }
      if (url.pathname === "/outer/-/outer-1.0.0.tgz") {
        return new Response(outer.tgz, { headers: { "content-length": String(outer.tgz.length) } });
      }
      if (url.pathname === "/inner/-/inner-2.0.0.tgz") {
        return new Response(inner.tgz, { headers: { "content-length": String(inner.tgz.length) } });
      }
      return new Response("not found", { status: 404 });
    },
  });

  // No package.json, no node_modules: the auto-install path.
  using dir = tempDir("autoinstall-nested-pkgjson-6988", {
    "index.js": `console.log(require("outer"));\n`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${server.port}/"\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Before the fix this prints nothing and stderr carries either
  // "Cannot find package 'inner'" or "ENOENT while resolving package 'inner'".
  expect({ stdout, stderr: stderr.split("\n").filter(l => l.includes("inner")) }).toEqual({
    stdout: "inner@2.0.0\n",
    stderr: [],
  });
  expect(exitCode).toBe(0);
});
