import { gzipSync, spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/37830
// Concurrent `bun x <pkg>` processes share one install directory
// (<tmpdir>/bunx-<uid>-<pkg>@<ver>). With a cold cache they all installed
// into it at the same time and raced each other: some died with
// "EEXIST/ENOENT: failed copying files from cache to destination", others
// executed a half-written node_modules ("Cannot find module ...").

/** Minimal ustar + gzip writer: enough for an npm package tarball. */
function makeTarball(files: Record<string, string>): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const [name, contents] of Object.entries(files)) {
    const data = encoder.encode(contents);
    const header = new Uint8Array(512);
    const put = (offset: number, value: string) => header.set(encoder.encode(value), offset);
    put(0, `package/${name}`);
    put(100, "0000755\0"); // mode: executable so bin entries work without chmod
    put(108, "0000000\0"); // uid
    put(116, "0000000\0"); // gid
    put(124, data.length.toString(8).padStart(11, "0") + "\0");
    put(136, "00000000000\0"); // mtime
    header[156] = 0x30; // typeflag: regular file
    put(257, "ustar\0"); // magic
    put(263, "00"); // version
    // checksum: sum of the header with the checksum field filled with spaces
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    put(148, sum.toString(8).padStart(6, "0") + "\0 ");
    blocks.push(header, data);
    const partial = data.length % 512;
    if (partial !== 0) blocks.push(new Uint8Array(512 - partial));
  }
  blocks.push(new Uint8Array(1024)); // end-of-archive
  const flat = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const block of blocks) {
    flat.set(block, offset);
    offset += block.length;
  }
  return gzipSync(flat);
}

// A dependency with many files widens the cache-to-destination copy window
// so the racing processes reliably overlap.
const FILE_COUNT = 300;
const filler = Buffer.alloc(1024, "x").toString();
function manyFilesPackage(name: string): Record<string, string> {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
    "index.js":
      Array.from({ length: FILE_COUNT }, (_, i) => `require("./file${i}.js");`).join("\n") +
      `\nmodule.exports = ${FILE_COUNT};\n`,
  };
  for (let i = 0; i < FILE_COUNT; i++) {
    files[`file${i}.js`] = `module.exports = ${i}; // ${filler}\n`;
  }
  return files;
}

test("concurrent bunx spawns of the same package do not corrupt the shared install dir", async () => {
  const packages: Record<string, { tarball: Uint8Array; meta: object }> = {};
  const registerPackage = (name: string, files: Record<string, string>, extra: object = {}) => {
    packages[name] = {
      tarball: makeTarball(files),
      meta: { name, version: "1.0.0", ...extra },
    };
  };

  registerPackage("dep-a-37830", manyFilesPackage("dep-a-37830"));
  registerPackage("dep-b-37830", manyFilesPackage("dep-b-37830"));
  registerPackage(
    "pkg-37830",
    {
      "package.json": JSON.stringify({
        name: "pkg-37830",
        version: "1.0.0",
        bin: { "pkg-37830": "cli.js" },
        dependencies: { "dep-a-37830": "1.0.0", "dep-b-37830": "1.0.0" },
      }),
      "cli.js": `#!/usr/bin/env node\nconsole.log("OK-37830", require("dep-a-37830") + require("dep-b-37830"));\n`,
    },
    {
      bin: { "pkg-37830": "cli.js" },
      dependencies: { "dep-a-37830": "1.0.0", "dep-b-37830": "1.0.0" },
    },
  );

  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const tarballMatch = path.match(/^\/([^/]+)-1\.0\.0\.tgz$/);
      if (tarballMatch && packages[tarballMatch[1]]) {
        return new Response(packages[tarballMatch[1]].tarball);
      }
      const name = path.slice(1);
      if (packages[name]) {
        return Response.json({
          name,
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              ...packages[name].meta,
              dist: { tarball: `http://localhost:${server.port}/${name}-1.0.0.tgz` },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  // A fresh temp dir gives this run its own bunx install dir
  // (<tmpdir>/bunx-<uid>-pkg-37830@latest) and a cold install cache.
  using tmp = tempDir("bunx-concurrent-tmp", {});
  using cache = tempDir("bunx-concurrent-cache", {});
  using cwd = tempDir("bunx-concurrent-cwd", {});
  const env = {
    ...bunEnv,
    TMPDIR: String(tmp),
    BUN_TMPDIR: String(tmp),
    TEMP: String(tmp),
    BUN_INSTALL_CACHE_DIR: String(cache),
    npm_config_registry: `http://localhost:${server.port}/`,
  };

  const CONCURRENCY = 8;
  const procs = Array.from({ length: CONCURRENCY }, () =>
    spawn({
      cmd: [bunExe(), "x", "pkg-37830"],
      env,
      cwd: String(cwd),
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  const results = await Promise.all(
    procs.map(async proc => {
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }),
  );

  for (const { stdout, stderr, exitCode } of results) {
    expect(stderr).not.toContain("failed copying files from cache to destination");
    expect(stderr).not.toContain("Cannot find module");
    expect(stdout).toContain("OK-37830 600");
    expect(exitCode).toBe(0);
  }
  // Outlier timeout: 8 serialized cold-cache installs of ~600 files each;
  // shrinking the workload loses the repro on unfixed builds.
}, 60_000);
