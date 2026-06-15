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

// `An-B` without spaces reaches `parse_n_dash_digits` via three different token
// shapes. All three reuse the outer parser's arena for the inner number parse.
test("An-B without spaces parses via all three token shapes", () => {
  // Dimension{value:2, unit:"n-3"}
  expect(minifyTest(":nth-child(2n-3) {width: 20px}", ":nth-child(2n-3){width:20px}")).toBe(
    ":nth-child(2n-3){width:20px}",
  );
  // Ident("n-5") / Ident("-n-5")
  expect(minifyTest(":nth-child(n-5) {width: 20px}", ":nth-child(n-5){width:20px}")).toBe(
    ":nth-child(n-5){width:20px}",
  );
  expect(minifyTest(":nth-child(-n-5) {width: 20px}", ":nth-child(-n-5){width:20px}")).toBe(
    ":nth-child(-n-5){width:20px}",
  );
  // Delim('+') then Ident("n-7")
  expect(minifyTest(":nth-child(+n-7) {width: 20px}", ":nth-child(n-7){width:20px}")).toBe(
    ":nth-child(n-7){width:20px}",
  );
});

test("fuzzer-minimized input: unterminated :nth-child( with an `Nn` ident", async () => {
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
