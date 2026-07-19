import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards the checked-in table that drives LPT shard bin-packing in
// scripts/runner.node.mjs. Regenerate via scripts/update-test-durations.mjs.
const table = JSON.parse(readFileSync(join(import.meta.dir, "..", "expected-durations.json"), "utf8"));
const entries = Object.entries(table).filter(([k]) => k !== "_meta") as [string, Record<string, number>][];

describe("test/expected-durations.json", () => {
  test("every lane the runner selects is declared and populated", () => {
    expect(table._meta).toBeObject();
    expect(table._meta.lanes).toBeObject();
    // runner.node.mjs lane selection: asan / musl / windows / default.
    for (const lane of ["default", "asan", "musl", "windows"]) {
      expect(table._meta.lanes[lane]).toBeString();
      const populated = entries.filter(([, e]) => typeof e[lane] === "number").length;
      expect(populated).toBeGreaterThan(1000);
    }
  });

  test("keys are relative test paths, not runner retry/error labels", () => {
    // Same predicate parseLog() uses to reject `[N/M] <path> - code 1` /
    // `[N/M] <path> [attempt #2]` headers; anything it lets through must be a
    // forward-slash relative path ending at a test file extension.
    const isTestPath = (k: string) => !k.startsWith("/") && !k.includes("\\") && /\.(?:[cm]?[jt]sx?|json)$/.test(k);
    const bad = entries.map(([k]) => k).filter(k => !isTestPath(k));
    expect(bad).toEqual([]);
  });

  test("covers the parallel-safe phase", () => {
    // js/{node,bun}/test/parallel/ run N-wide and log without a `--- ` group
    // prefix; a parser that only matches `--- [N/M]` drops ~3k entries here.
    const parallelSafe = entries.filter(
      ([k]) => k.startsWith("js/node/test/parallel/") || k.startsWith("js/bun/test/parallel/"),
    );
    expect(parallelSafe.length).toBeGreaterThan(1000);
  });

  test("every entry is {lane: non-negative ms}", () => {
    const lanes = Object.keys(table._meta.lanes);
    for (const [, entry] of entries) {
      expect(typeof entry).toBe("object");
      const entryLanes = Object.keys(entry);
      expect(entryLanes.length).toBeGreaterThan(0);
      for (const lane of entryLanes) {
        expect(lanes).toContain(lane);
        expect(entry[lane]).toBeNumber();
        expect(entry[lane]).toBeGreaterThanOrEqual(0);
      }
    }
    // Loose lower bound: the runner currently shards ~5k files.
    expect(entries.length).toBeGreaterThan(3000);
  });
});
