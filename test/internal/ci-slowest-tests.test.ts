import { describe, expect, test } from "bun:test";
import { parseLog } from "../../scripts/ci-slowest-tests";

// Buildkite prefixes each line with an APC timestamp: ESC `_bk;t=<ms>` BEL.
const bk = (ts: number, body: string) => `\x1b_bk;t=${ts}\x07${body}`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;

describe("scripts/ci-slowest-tests.ts parseLog", () => {
  test("does not charge the parallel-safe phase to the last serial test", () => {
    // runner.node.mjs prints serial headers via startGroup (`--- [N/M] path`)
    // and parallel-safe headers via plain console.log (`[N/M] path`). A regex
    // that insists on `--- ` treats the first parallel header as invisible and
    // the last serial test swallows the whole phase (79.5s observed for a
    // 4.8s test on build #79247).
    const log = [
      bk(1000, `--- ${gray("[1/6]")} test/a.test.ts`),
      bk(2000, "Ran 1 test across 1 file."),
      bk(2000, `--- ${gray("[2/6]")} test/last-serial.test.ts`),
      bk(6800, "Ran 1 test across 1 file."),
      bk(6800, `--- Running 3 parallel-safe tests (4-wide)`),
      bk(6801, `${gray("[3/6]")} test/js/node/test/parallel/p1.js`),
      bk(6803, `${gray("[4/6]")} test/js/node/test/parallel/p2.js`),
      bk(6810, `${gray("[5/6]")} test/js/node/test/parallel/p3.js`),
      bk(86800, `--- ${gray("[6/6]")} vendor/x/package.json`),
      bk(87000, `--- End`),
    ].join("\r\r\n");

    const out = parseLog(log);
    expect(out.get("test/last-serial.test.ts")).toBe(4800);
    // p3 is the last dispatch before an 80s tail; header-gap timing would
    // charge it 79_990 ms. Parallel-safe spans are clamped.
    expect(out.get("test/js/node/test/parallel/p3.js")).toBeLessThanOrEqual(500);
    expect(out.get("test/a.test.ts")).toBe(1000);
    expect(out.get("vendor/x/package.json")).toBe(200);
  });

  test("sums retry attempts and normalizes Windows path separators", () => {
    const log = [
      bk(0, `--- ${gray("[1/2]")} test\\cli\\install\\flaky.test.ts`),
      bk(3000, `--- \x1b[33m[1/2] test\\cli\\install\\flaky.test.ts - code 1\x1b[0m`),
      bk(10000, `--- ${gray("[1/2]")} test\\cli\\install\\flaky.test.ts ${gray("[attempt #2]")}`),
      bk(14000, `--- ${gray("[2/2]")} test\\next.test.ts`),
      bk(15000, `--- End`),
    ].join("\n");

    const out = parseLog(log);
    // First attempt 3s + second attempt 4s; the retry backoff between the
    // failure label and attempt #2 is not the test's wall clock.
    expect(out.get("test/cli/install/flaky.test.ts")).toBe(7000);
    expect(out.get("test/next.test.ts")).toBe(1000);
  });

  test("closes the last serial test at the parallel-phase group header when no parallel headers follow", () => {
    // Shard with zero parallel-safe tests: the group header never prints, but
    // `--- End` still terminates the open span.
    const noParallel = [bk(100, `--- ${gray("[1/1]")} test/only.test.ts`), bk(900, `--- End`)].join("\n");
    expect(parseLog(noParallel).get("test/only.test.ts")).toBe(800);

    // Shard where the parallel phase prints its group header but (e.g. via a
    // filter) runs nothing: the open serial span must close there, not at the
    // next `[N/M]` header an arbitrary distance later.
    const emptyParallel = [
      bk(100, `--- ${gray("[1/2]")} test/last.test.ts`),
      bk(1100, `--- Running 0 parallel-safe tests (4-wide)`),
      bk(60000, `--- ${gray("[2/2]")} vendor/x/package.json`),
      bk(60100, `--- End`),
    ].join("\n");
    expect(parseLog(emptyParallel).get("test/last.test.ts")).toBe(1000);
  });
});
