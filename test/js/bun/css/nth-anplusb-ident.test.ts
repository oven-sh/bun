import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const { minifyTest } = cssInternals;

// An+B idents longer than the keyword literals ("n", "n-", ...) used to make the
// case-insensitive comparison read past the keyword (found by fuzzing `:nth-child(Nn`).

test("An+B idents longer than the keyword literals parse deterministically", () => {
  expect(minifyTest(":nth-child(n-3) {width: 20px}", ":nth-child(n-3){width:20px}")).toBe(
    ":nth-child(n-3){width:20px}",
  );
  expect(minifyTest(":nth-child(N-3) {width: 20px}", ":nth-child(n-3){width:20px}")).toBe(
    ":nth-child(n-3){width:20px}",
  );
  expect(minifyTest(":nth-last-child(n- 42) {width: 20px}", ":nth-last-child(n-42){width:20px}")).toBe(
    ":nth-last-child(n-42){width:20px}",
  );
  expect(minifyTest(":nth-child(N) {width: 20px}", ":nth-child(n){width:20px}")).toBe(":nth-child(n){width:20px}");
  expect(() => minifyTest(":nth-child(NN) {width: 20px}", "")).toThrow("Unexpected token");
});

test("class and id selectors inside an of-list keep their escapes when printed", () => {
  expect(minifyTest(":nth-child(2n of .a\\{b) {width: 20px}", "")).toBe(":nth-child(2n of .a\\{b){width:20px}");
  expect(minifyTest(":nth-child(2n of .md\\:flex) {width: 20px}", "")).toBe(":nth-child(2n of .md\\:flex){width:20px}");
  expect(minifyTest(":nth-last-child(1 of #a\\}b) {width: 20px}", "")).toBe(":nth-last-child(1 of #a\\}b){width:20px}");
});

// A second tokenizer parses the digits after `n-`. It borrows the stylesheet's arena.
//
// mimalloc adds the heaps a thread created to the process total only when that thread collects or ends. In a process
// that ran `Bun.build` before, the total rises at any moment by the heaps of the bundler's threads, so the count is
// taken in a child process.
test.concurrent(":nth-child(An+B) with digits after `n-` doesn't create an allocator heap per selector", async () => {
  const cases = [
    ["2n-3", "2n-3"],
    ["n-5", "n-5"],
    ["-n-5", "-n-5"],
    ["+n-7", "n-7"],
  ];
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { minifyTest } = require("bun:internal-for-testing").cssInternals;
      const { heapStats } = require("bun:jsc");
      let seen = heapStats().mimalloc.heaps.total;
      const heapsCreatedByRules = (arg, printed, count) => {
        const rules = (arg, separator) =>
          Array.from({ length: count }, (_, i) => ".a" + i + ":nth-child(" + arg + "){width:" + (i + 1) + "px}").join(separator);
        const output = minifyTest(rules(arg, "\\n"), "");
        if (output !== rules(printed, "")) throw new Error("unexpected output: " + output);
        const total = heapStats().mimalloc.heaps.total;
        const heaps = total - seen;
        seen = total;
        return heaps;
      };
      const moreHeapsFor100RulesThanFor1 = {};
      for (const [arg, printed] of ${JSON.stringify(cases)}) {
        moreHeapsFor100RulesThanFor1[arg] = heapsCreatedByRules(arg, printed, 100) - heapsCreatedByRules(arg, printed, 1);
      }
      console.log(JSON.stringify(moreHeapsFor100RulesThanFor1));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ "2n-3": 0, "n-5": 0, "-n-5": 0, "+n-7": 0 });
  expect(exitCode).toBe(0);
});

test.concurrent("fuzzer-minimized input: unterminated :nth-child( with an `Nn` ident", async () => {
  // Run in a child process so a crash doesn't take down the test runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try {
        require("bun:internal-for-testing").cssInternals.minifyTest(":nth-child(Nn", "");
        console.log("no error");
      } catch (e) {
        console.log("error: " + e.message);
      }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("error: parsing failed: Unexpected end of input");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
