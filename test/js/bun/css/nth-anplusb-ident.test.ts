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

// Each row is an argument that the An+B grammar rejects, and the token that the parser reports.
test.each([
  // `even`, `odd`, `n`, `-n`, `n-` and `-n-` match a whole ident, not a prefix of it. `\-` is the ident `-`.
  ["e", "e"],
  ["ev", "ev"],
  ["eve", "eve"],
  ["o", "o"],
  ["od", "od"],
  ["\\-", "\\-"],
  ["\\- + 3", "\\-"],
  // Only `+` is a sign token. A `-` sign is part of the ident (`-n`), so a `-` token before `n` is not a sign.
  ["*n-3", "*"],
  ["~n", "~"],
  ["/n", "/"],
  [".n", "."],
  ["-/**/n", "-"],
  ["-/**/n-3", "-"],
  // The ident after the `+` has no sign of its own.
  ["+-n 5", "-n"],
])(":nth-child(%s) is a parse error", (arg, token) => {
  expect(() => minifyTest(`:nth-child(${arg}) {width: 20px}`, "")).toThrow(`Unexpected token: ${token}`);
});

test.each([
  // The keywords match in any case.
  ["EVEN", "2n"],
  ["eVeN", "2n"],
  ["ODD", "odd"],
  ["-N", "-n"],
  ["-N- 5", "-n-5"],
  // `'+'? n- <signless-integer>`: the ident after the `+` is `n-`, and the integer is a separate token.
  ["+n- 5", "n-5"],
  ["+N- 5", "n-5"],
  ["+n", "n"],
  ["+n-7", "n-7"],
  ["+n+5", "n+5"],
  ["+n - 5", "n-5"],
])(":nth-child(%s) prints as :nth-child(%s)", (arg, printed) => {
  expect(minifyTest(`:nth-child(${arg}) {width: 20px}`, "")).toBe(`:nth-child(${printed}){width:20px}`);
});

test("class and id selectors inside an of-list keep their escapes when printed", () => {
  expect(minifyTest(":nth-child(2n of .a\\{b) {width: 20px}", "")).toBe(":nth-child(2n of .a\\{b){width:20px}");
  expect(minifyTest(":nth-child(2n of .md\\:flex) {width: 20px}", "")).toBe(":nth-child(2n of .md\\:flex){width:20px}");
  expect(minifyTest(":nth-last-child(1 of #a\\}b) {width: 20px}", "")).toBe(":nth-last-child(1 of #a\\}b){width:20px}");
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
