import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const { minifyTest } = cssInternals;

// Regression test for an out-of-bounds read in the An+B (`:nth-child()`)
// parser. The `<ident>` branch compares the user-supplied ident against the
// keywords "even" / "odd" / "n" / "-n" / "n-" / "-n-" with a case-insensitive
// helper backed by `strncasecmp(a, b, a.len)`. When the ident is longer than
// the keyword (e.g. `Nn` vs `n`) the comparison read past the end of the
// keyword literal, which AddressSanitizer reports as a global-buffer-overflow.
// Found by fuzzing with the minimized input `:nth-child(Nn`.

test("An+B idents longer than the keyword literals parse deterministically", () => {
  // `n-<digits>` idents start with the same bytes as the "n" / "n-" keywords
  // but are longer than both; they must fall through to the `<ident> =
  // n-<digits>` production instead of reading past the keyword literals.
  expect(minifyTest(":nth-child(n-3) {width: 20px}", ":nth-child(n-3){width:20px}")).toBe(
    ":nth-child(n-3){width:20px}",
  );
  expect(minifyTest(":nth-child(N-3) {width: 20px}", ":nth-child(n-3){width:20px}")).toBe(
    ":nth-child(n-3){width:20px}",
  );
  expect(minifyTest(":nth-last-child(n- 42) {width: 20px}", ":nth-last-child(n-42){width:20px}")).toBe(
    ":nth-last-child(n-42){width:20px}",
  );
  // Still matches the keywords exactly (case-insensitively).
  expect(minifyTest(":nth-child(N) {width: 20px}", ":nth-child(n){width:20px}")).toBe(":nth-child(n){width:20px}");
  // An ident that starts like a keyword but is not a valid An+B is a parse
  // error, not a crash.
  expect(() => minifyTest(":nth-child(NN) {width: 20px}", "")).toThrow("Unexpected token");
});

test("fuzzer-minimized input: unterminated :nth-child( with an `Nn` ident", async () => {
  // Exact fuzz input. Run in a child process so a crash in the parser shows up
  // as a failed assertion here instead of killing the test runner.
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
