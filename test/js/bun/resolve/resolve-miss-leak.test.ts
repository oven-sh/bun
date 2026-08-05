import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

// Every failed resolution of a relative/bare specifier used to bust the
// importer directory's cache and re-read it into append-only stores, leaking
// ~190 bytes per directory entry per miss. The entries below make the unfixed
// growth (~100 MB) far exceed the threshold while the fixed build stays well
// under it even with ASAN's quarantine retaining freed allocations.
const ENTRY_COUNT = 512;
const MISS_COUNT = 1000;
const thresholdMB = isASAN ? 70 : 30;

// ASAN's quarantine keeps freed allocations resident, which would count the
// per-miss hashmap churn (allocated and freed every re-read) as RSS growth.
// Shrink it so only memory that is never freed registers; real leaks are
// unaffected because leaked memory never enters the quarantine.
const leakEnv = {
  ...bunEnv,
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=4"].filter(Boolean).join(":"),
};

function importerDirFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < ENTRY_COUNT; i++) {
    files[`filler-${i}.txt`] = "";
  }
  return files;
}

test.concurrent(
  "failed module resolution does not leak the importer directory listing",
  async () => {
    using dir = tempDir("resolve-miss-leak", importerDirFiles());
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--smol",
        "-e",
        /* ts */ `
        const { createRequire } = require("node:module");
        const { join } = require("node:path");
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
        const req = createRequire(join(process.cwd(), "entry.js"));
        const miss = () => {
          try {
            req("./does-not-exist.js");
            throw new Error("expected resolution to fail");
          } catch (e) {
            if (e?.code !== "MODULE_NOT_FOUND" && e?.name !== "ResolveMessage") throw e;
          }
        };
        for (let i = 0; i < 50; i++) miss();
        Bun.gc(true);
        const before = rss();
        for (let i = 0; i < ${MISS_COUNT}; i++) miss();
        Bun.gc(true);
        const growthMB = (rss() - before) / 1024 / 1024;
        if (growthMB > ${thresholdMB}) throw new Error("leaked " + growthMB.toFixed(2) + "MB after ${MISS_COUNT} misses");
      `,
      ],
      cwd: String(dir),
      env: leakEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  60_000,
);

test.concurrent(
  "Bun.resolveSync misses do not leak the importer directory listing",
  async () => {
    using dir = tempDir("resolve-sync-miss-leak", importerDirFiles());
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--smol",
        "-e",
        /* ts */ `
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
        const dir = process.cwd();
        const miss = () => {
          try {
            Bun.resolveSync("./does-not-exist.js", dir);
            throw new Error("expected resolution to fail");
          } catch (e) {
            if (e?.name !== "ResolveMessage") throw e;
          }
        };
        for (let i = 0; i < 50; i++) miss();
        Bun.gc(true);
        const before = rss();
        for (let i = 0; i < ${MISS_COUNT}; i++) miss();
        Bun.gc(true);
        const growthMB = (rss() - before) / 1024 / 1024;
        if (growthMB > ${thresholdMB}) throw new Error("leaked " + growthMB.toFixed(2) + "MB after ${MISS_COUNT} misses");
      `,
      ],
      cwd: String(dir),
      env: leakEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  60_000,
);

// The cache bust that caused the leak exists so that a failed resolution
// retries against fresh directory contents. These guard that contract: files
// (and node_modules packages) created after a miss are found by the next
// attempt in the same process.
test.concurrent("a file created after a failed require is found by the next require", async () => {
  using dir = tempDir("resolve-miss-then-create", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* ts */ `
      const { createRequire } = require("node:module");
      const { writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      const req = createRequire(join(process.cwd(), "entry.js"));
      let threw = false;
      try {
        req("./created-later.js");
      } catch {
        threw = true;
      }
      if (!threw) throw new Error("expected the first require to fail");
      writeFileSync(join(process.cwd(), "created-later.js"), "module.exports = 42;");
      const value = req("./created-later.js");
      if (value !== 42) throw new Error("expected 42, got " + value);
      console.log("found after create");
    `,
    ],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("found after create\n");
  expect(exitCode).toBe(0);
});

test.concurrent("a package installed after a failed require is found by the next require", async () => {
  using dir = tempDir("resolve-pkg-then-create", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* ts */ `
      const { createRequire } = require("node:module");
      const { mkdirSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      const req = createRequire(join(process.cwd(), "entry.js"));
      let threw = false;
      try {
        req("created-later-pkg");
      } catch {
        threw = true;
      }
      if (!threw) throw new Error("expected the first require to fail");
      const pkgDir = join(process.cwd(), "node_modules", "created-later-pkg");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "created-later-pkg", main: "index.js" }));
      writeFileSync(join(pkgDir, "index.js"), "module.exports = 'installed';");
      const value = req("created-later-pkg");
      if (value !== "installed") throw new Error("expected 'installed', got " + value);
      console.log("found after install");
    `,
    ],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("found after install\n");
  expect(exitCode).toBe(0);
});
