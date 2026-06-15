// The Rust port of the ExportsMap visitor deep-cloned the entire condition
// subtree for every wildcard key into `expansion_keys`, where the Zig original
// stored a shallow pointer-based copy. Packages with many `./*` exports and
// nested condition maps (next, @mui/material, rxjs) paid roughly 2x the heap
// for their exports map, and that PackageJSON lives in the process-lifetime
// DirInfo cache so the duplicate was never freed.
//
// The fix stores `expansion_keys` as indices into `list`, matching the Zig
// sharing semantics.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// Build an identical condition subtree for every key: many small nested Maps so
// the cloned Entry tree dominates over the JSON source bytes.
function makeExports(wildcard: boolean): string {
  const leaf: Record<string, unknown> = {};
  for (let i = 0; i < 8; i++) leaf["c" + i] = { node: "./a.js", default: "./b.js" };
  const mid: Record<string, unknown> = {};
  for (let i = 0; i < 8; i++) mid["m" + i] = leaf;
  const subtree = { import: mid, require: mid, default: "./d.js" };
  const exportsObj: Record<string, unknown> = {};
  const suffix = wildcard ? "/*" : "";
  for (let i = 0; i < 1000; i++) exportsObj["./p" + i + suffix] = subtree;
  return JSON.stringify({ name: wildcard ? "pkg-wild" : "pkg-flat", exports: exportsObj });
}

test(
  "exports map with wildcard keys does not duplicate condition subtrees in memory",
  { timeout: 60_000 },
  async () => {
    using dir = tempDir("exports-map-memory", {
      "node_modules/pkg-flat/package.json": makeExports(false),
      "node_modules/pkg-wild/package.json": makeExports(true),
      "probe.js": `
      Bun.gc(true);
      const before = process.memoryUsage().rss;
      try { Bun.resolveSync(process.argv[2], import.meta.dir); } catch {}
      Bun.gc(true);
      process.stdout.write(String(process.memoryUsage().rss - before));
    `,
    });

    async function measure(spec: string): Promise<number> {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "probe.js", spec],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const delta = parseInt(stdout.trim(), 10);
      if (exitCode !== 0 || !Number.isFinite(delta)) {
        throw new Error(`probe '${spec}' failed: exit=${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`);
      }
      return delta;
    }

    const flat = await measure("pkg-flat/p0");
    const wild = await measure("pkg-wild/p0/x");

    // Sanity: resolving a ~5.5MB package.json with ~260k Entry nodes must show
    // up in RSS; if it doesn't, the probe didn't exercise the exports map.
    expect(flat).toBeGreaterThan(4 << 20);

    // Both packages hold byte-identical condition subtrees; the only structural
    // difference is the "/*" suffix on each key. With expansion_keys as indices
    // the wildcard package costs `flat + O(keys * sizeof(u32))`, so the diff is
    // noise. Before the fix it cost `flat + (full deep copy of every subtree)`,
    // which measured at (wild-flat)/flat of ~0.26 on release and ~0.17 on
    // debug+ASAN (ASAN's fixed overhead on the JSON AST dilutes the ratio).
    expect(wild - flat).toBeLessThan(flat * 0.1);
  },
);

// After switching expansion_keys to indices, wildcard + pattern resolution and
// the PATTERN_KEY_COMPARE specificity ordering must be unchanged.
test("exports map wildcard resolution still works", async () => {
  using dir = tempDir("exports-map-memory-resolve", {
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      exports: {
        // Declared in non-specific order; PATTERN_KEY_COMPARE must sort so
        // "./feature/*" (longer base) wins over "./*" for "pkg/feature/x".
        "./*": { default: "./catchall.js" },
        "./feature/*": { import: { default: "./feat.js" } },
        "./exact": "./exact.js",
        "./trailing/": "./dir/",
      },
    }),
    "node_modules/pkg/catchall.js": "module.exports = 'catchall';",
    "node_modules/pkg/feat.js": "module.exports = 'feat';",
    "node_modules/pkg/exact.js": "module.exports = 'exact';",
    "node_modules/pkg/dir/thing.js": "module.exports = 'dir';",
  });

  const base = String(dir);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const dir = ${JSON.stringify(base + path.sep)};
        const r = s => Bun.resolveSync(s, dir).slice(dir.length).replaceAll("\\\\", "/");
        console.log(JSON.stringify({
          exact: r("pkg/exact"),
          feature: r("pkg/feature/x"),
          other: r("pkg/other"),
          trailing: r("pkg/trailing/thing"),
        }));
      `,
    ],
    env: bunEnv,
    cwd: base,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exit=${exitCode}\n${stderr}`);

  expect(JSON.parse(stdout)).toEqual({
    exact: "node_modules/pkg/exact.js",
    feature: "node_modules/pkg/feat.js",
    other: "node_modules/pkg/catchall.js",
    trailing: "node_modules/pkg/dir/thing.js",
  });
  expect(exitCode).toBe(0);
});
