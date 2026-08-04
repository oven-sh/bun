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

  test("carried excludes do not count against the dir's 2/3 threshold", () => {
    // 4 files, 1 carried exclude, 1 fresh flake. If the carried exclude counted
    // against the threshold, good=2 of 4 < ceil(4*2/3)=3 would drop the dir and
    // lose the carried exclude. With the threshold over the 3 fresh files only,
    // good=2 of 3 >= ceil(3*2/3)=2 keeps the dir and emits both excludes.
    const files = ["b/a.test.ts", "b/b.test.ts", "b/c.test.ts", "b/d.test.ts"];
    const { dirs, excludeFiles } = computeAllowlist({
      ...base,
      files,
      flaky: new Map([["b/c.test.ts", 1]]),
      previousExcludes: new Set(["b/d.test.ts"]),
    });
    expect({ dirs, excludeFiles }).toEqual({ dirs: ["b"], excludeFiles: ["b/c.test.ts", "b/d.test.ts"] });
  });

  test("a dir still drops when its fresh files fall below the threshold", () => {
    const files = ["b/x.test.ts", "b/y.test.ts", "b/z.test.ts"];
    const { dirs, excludeFiles } = computeAllowlist({
      ...base,
      files,
      flaky: new Map([
        ["b/x.test.ts", 1],
        ["b/y.test.ts", 1],
      ]),
      previousExcludes: new Set(),
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
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });
});
