import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards the checked-in table that drives LPT shard bin-packing in
// scripts/runner.node.mjs. Regenerate via scripts/update-test-durations.mjs.
const table = JSON.parse(readFileSync(join(import.meta.dir, "..", "expected-durations.json"), "utf8"));

describe("test/expected-durations.json", () => {
  test("has a _meta block with the lanes the runner selects", () => {
    expect(table._meta).toBeObject();
    expect(table._meta.lanes).toBeObject();
    // runner.node.mjs lane selection: asan / musl / windows / default.
    for (const lane of ["default", "asan", "musl", "windows"]) {
      expect(table._meta.lanes[lane]).toBeString();
    }
  });

  test("keys are test paths, not runner retry/error labels", () => {
    // A broken parseLog() captures `[N/M] <path> - code 1` and
    // `[N/M] <path> [attempt #2]` headers as if they were file paths.
    const bad = Object.keys(table).filter(k => k !== "_meta" && (k.includes(" - ") || k.includes("[attempt")));
    expect(bad).toEqual([]);
  });

  test("covers the parallel-safe phase", () => {
    // js/{node,bun}/test/parallel/ run N-wide and log without a `--- ` group
    // prefix; a parser that only matches `--- [N/M]` drops ~3k entries here.
    const parallelSafe = Object.keys(table).filter(
      k => k.startsWith("js/node/test/parallel/") || k.startsWith("js/bun/test/parallel/"),
    );
    expect(parallelSafe.length).toBeGreaterThan(1000);
  });

  test("every entry is {lane: positive ms}", () => {
    const lanes = Object.keys(table._meta.lanes);
    let count = 0;
    for (const [key, entry] of Object.entries(table)) {
      if (key === "_meta") continue;
      count++;
      expect(typeof entry).toBe("object");
      let hasLane = false;
      for (const [lane, ms] of Object.entries(entry as Record<string, unknown>)) {
        expect(lanes).toContain(lane);
        expect(ms).toBeNumber();
        expect(ms).toBeGreaterThanOrEqual(0);
        hasLane = true;
      }
      expect(hasLane).toBe(true);
    }
    // Loose lower bound: the runner currently shards ~5k files.
    expect(count).toBeGreaterThan(3000);
  });
});
