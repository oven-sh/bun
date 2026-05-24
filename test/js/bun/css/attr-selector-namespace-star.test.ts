import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const { minifyTest } = cssInternals;

// A `*` local name inside an attribute selector (e.g. `[|*`, `[*|*]`, `[ns|*]`) used to hit
// `unreachable!()` in the selector parser instead of being rejected as an invalid qualified name
// (found by fuzzing `[|*`).

test("`*` local name in an attribute selector is a parse error, not a panic", () => {
  expect(() => minifyTest("[|*] {color: red}", "")).toThrow("Invalid qualified name in attribute selector");
  expect(() => minifyTest("[*|*] {color: red}", "")).toThrow("Invalid qualified name in attribute selector");
  expect(() => minifyTest("@namespace svg url(http://www.w3.org/2000/svg); [svg|*] {color: red}", "")).toThrow(
    "Invalid qualified name in attribute selector",
  );

  // Namespace prefixes in attribute selectors and `*` local names outside of them still parse.
  expect(minifyTest("[*|attr] {color: red}", "[*|attr]{color:red}")).toBe("[*|attr]{color:red}");
  expect(minifyTest("[|attr] {color: red}", "[attr]{color:red}")).toBe("[attr]{color:red}");
  expect(minifyTest("*|* {color: red}", "*|*{color:red}")).toBe("*|*{color:red}");
});

test("fuzzer-minimized input: unterminated `[|*` attribute selector", async () => {
  // Run in a child process so a crash doesn't take down the test runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try {
        require("bun:internal-for-testing").cssInternals.minifyTest("[|*", "");
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

  // The unterminated rule is skipped once the selector is rejected, so the surfaced error is EOF.
  expect(stdout.trim()).toBe("error: parsing failed: Unexpected end of input");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
