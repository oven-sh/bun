import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { computeAllowlist } from "../../scripts/update-parallel-allowlist.mjs";

const testDir = join(import.meta.dir, "..");
const scriptPath = join(testDir, "..", "scripts", "update-parallel-allowlist.mjs");
const table = JSON.parse(readFileSync(join(testDir, "parallel-allowlist.json"), "utf8"));

test("test/parallel-allowlist.json has the shape the runner reads", () => {
  expect(table._meta).toBeObject();
  expect(table.dirs).toBeArray();
  expect(table.excludeFiles).toBeArray();
  expect(table.dirs.length).toBeGreaterThan(100);
  for (const p of [...table.dirs, ...table.excludeFiles]) {
    expect(p).not.toContain("\\");
    expect(p).not.toStartWith("test/");
    expect(p).not.toStartWith("/");
  }
});

test("excludeFiles are real files inside listed dirs", () => {
  const dirs = new Set(table.dirs);
  const bad = table.excludeFiles.filter((f: string) => !dirs.has(dirname(f)) || !existsSync(join(testDir, f)));
  expect(bad).toEqual([]);
});

describe("scripts/update-parallel-allowlist.mjs", () => {
  const base = {
    durations: {} as Record<string, { default: number }>,
    dockerPrefixes: [] as string[],
    fastMs: 15000,
  };

  test("carries forward previous excludeFiles even with zero flakes in the scan window", () => {
    // #36585: a file already in excludeFiles never runs in the --parallel batch,
    // so a clean annotation window is not evidence it became batch-safe.
    const files = ["js/bun/util/a.test.ts", "js/bun/util/b.test.ts", "js/bun/util/inspect-error-leak.test.js"];
    const { dirs, excludeFiles } = computeAllowlist({
      ...base,
      files,
      flaky: new Map(),
      previousExcludes: new Set(["js/bun/util/inspect-error-leak.test.js"]),
    });
    expect({ dirs, excludeFiles }).toEqual({
      dirs: ["js/bun/util"],
      excludeFiles: ["js/bun/util/inspect-error-leak.test.js"],
    });
  });

  test("a file removed from excludeFiles by hand is re-evaluated on fresh data", () => {
    const files = ["a/one.test.ts", "a/two.test.ts", "a/three.test.ts"];
    const fresh = computeAllowlist({ ...base, files, flaky: new Map(), previousExcludes: new Set() });
    expect(fresh).toMatchObject({ dirs: ["a"], excludeFiles: [] });
    const flaked = computeAllowlist({
      ...base,
      files,
      flaky: new Map([["a/two.test.ts", 3]]),
      previousExcludes: new Set(),
    });
    expect(flaked).toMatchObject({ dirs: ["a"], excludeFiles: ["a/two.test.ts"] });
  });

  test("previous exclude whose dir drops below the threshold is not emitted", () => {
    // 1 good of 3 is < 2/3, so the dir is not listed and nothing is emitted for it.
    const files = ["b/x.test.ts", "b/y.test.ts", "b/z.test.ts"];
    const { dirs, excludeFiles } = computeAllowlist({
      ...base,
      files,
      flaky: new Map([["b/y.test.ts", 1]]),
      previousExcludes: new Set(["b/z.test.ts"]),
    });
    expect({ dirs, excludeFiles }).toEqual({ dirs: [], excludeFiles: [] });
  });

  test("stress-named and docker-prefixed files never qualify", () => {
    const files = ["c/ok.test.ts", "c/ok2.test.ts", "c/foo-stress.test.ts", "js/sql/sql.test.ts"];
    const { dirs, excludeFiles } = computeAllowlist({
      ...base,
      files,
      flaky: new Map(),
      previousExcludes: new Set(),
      dockerPrefixes: ["js/sql/"],
    });
    expect(excludeFiles).toContain("c/foo-stress.test.ts");
    expect(excludeFiles).not.toContain("c/ok.test.ts");
    expect(dirs).not.toContain("js/sql");
  });

  test("importing the script does not run its CLI (no token check, no network)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `await import(${JSON.stringify(scriptPath)})`],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
