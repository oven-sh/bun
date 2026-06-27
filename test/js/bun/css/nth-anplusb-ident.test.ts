import * as internals from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

const { cssInternals, mimallocHeapNewCount } = internals;
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

// The `even`/`odd`/`n`/... keyword checks must be exact-length, not prefix
// matches: `e` is not `even`, `o` is not `odd`.
test("An+B idents shorter than a keyword are rejected, not prefix-matched", () => {
  for (const sel of ["e", "ev", "eve", "o", "od"]) {
    expect(() => minifyTest(`:nth-child(${sel}) {width: 20px}`, "")).toThrow("Unexpected token");
  }
  // Exact matches (any case) still work.
  expect(minifyTest(":nth-child(EVEN) {width: 20px}", ":nth-child(2n){width:20px}")).toBe(":nth-child(2n){width:20px}");
  expect(minifyTest(":nth-child(ODD) {width: 20px}", ":nth-child(odd){width:20px}")).toBe(
    ":nth-child(odd){width:20px}",
  );
});

// Only `'+'` may precede the `n...` ident in An+B. Any other leading delimiter
// is a parse error, and after `+` the `n-` form (not `-n`) takes a signless B.
test("An+B explicit leading sign is '+' only", () => {
  expect(() => minifyTest(":nth-child(*n-3) {width: 20px}", "")).toThrow("Unexpected token");
  expect(() => minifyTest(":nth-child(~n) {width: 20px}", "")).toThrow("Unexpected token");
  // `+ -n 5` is two consecutive signs: invalid.
  expect(() => minifyTest(":nth-child(+-n 5) {width: 20px}", "")).toThrow("Unexpected token");
  // `+n- 5` is the `'+'? n- <signless-integer>` production: valid, equals n-5.
  expect(minifyTest(":nth-child(+n- 5) {width: 20px}", ":nth-child(n-5){width:20px}")).toBe(
    ":nth-child(n-5){width:20px}",
  );
  expect(minifyTest(":nth-child(+n) {width: 20px}", ":nth-child(n){width:20px}")).toBe(":nth-child(n){width:20px}");
});

// `parse_number_saturate` builds a temporary Parser to tokenize the `-B` part
// of `An-B`. That Parser must borrow the outer parser's arena, not create a
// fresh mimalloc heap per selector. The counter is debug-only.
test.skipIf(!isDebug)("An-B parse does not create a mimalloc heap per selector", () => {
  const N = 2000;
  let css = "";
  for (let i = 0; i < N; i++) css += `.x${i}:nth-child(2n-${(i % 9) + 1}){color:red}`;
  // Warm the code path once so any one-time lazy heaps are already counted.
  minifyTest(":nth-child(2n-1){color:red}", ":nth-child(2n-1){color:red}");

  const before = mimallocHeapNewCount();
  const out = minifyTest(css, "");
  const after = mimallocHeapNewCount();

  expect(out.startsWith(".x0:nth-child(2n-1),")).toBe(true);
  // O(1) heaps for the whole parse, not O(N). Without the fix this is N+1.
  expect(after - before).toBeLessThan(N);
  expect(after - before).toBeLessThan(100);
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
