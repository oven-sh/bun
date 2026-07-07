import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("JSX lexer should not crash with slice bounds issues", async () => {
  // This used to crash with: "panic: start index N is larger than end index M"
  // due to invalid slice bounds in js_lexer.zig:767 when calculating string literal content
  // The issue occurred when suffix_len > lexer.end, causing end_pos < base

  // Test JSX with empty template strings that could trigger slice bounds issues
  const { stderr, exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "-e", "export function x(){return<div a=``/>}"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(exitCode).toBe(1);
  expect(normalizeBunSnapshot(stderr.toString().replace(/(Bun v.*)$/gm, ""))).toMatchInlineSnapshot(`
    "1 | export function x(){return<div a=\`\`/>}
                                         ^
    error: Expected "{" but found "\`"
        at <cwd>/[eval]:1:34

    1 | export function x(){return<div a=\`\`/>}
                                          ^
    error: Unterminated string literal
        at <cwd>/[eval]:1:35"
  `);
  expect(normalizeBunSnapshot(stdout.toString())).toMatchInlineSnapshot(`""`);
});

test.concurrent("#30959 JSX attribute with invalid '(' value parses cleanly in debug builds", async () => {
  // Previously, parsing `<r L=((` in a debug build panicked with
  // `Scope location must be greater than previous 6 must be greater than 6`
  // in push_scope_for_parse_pass. `next_inside_jsx_element`'s TSyntaxError
  // branch set `end = current` on the first `(` without stepping past it,
  // so the recovery `next()` (called via `expect(TOpenBrace).next()` inside
  // `parse_jsx_prop_value_identifier`) re-dispatched on the still-in-
  // `code_point` byte and synthesised a zero-length `TOpenParen` at the
  // same offset as the real `(` that followed. `parse_paren_expr` then
  // pushed two FunctionArgs scopes at offset 6 and tripped the
  // strict-monotonicity debug assertion.
  //
  // Release builds already reported the two parse errors and recovered;
  // the lexer now calls `step()` after setting TSyntaxError so debug
  // matches release. We assert the expected release-mode error messages
  // rather than the absence of a panic, so the test fails cleanly both
  // when the panic returns (exit code / hang) and when the error output
  // regresses.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "export function x(){return<r L=((}"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr.replace(/(Bun v.*)$/gm, ""))).toMatchInlineSnapshot(`
    "1 | export function x(){return<r L=((}
                                       ^
    error: Expected "{" but found "("
        at <cwd>/[eval]:1:32

    1 | export function x(){return<r L=((}
                                         ^
    error: Unexpected }
        at <cwd>/[eval]:1:34"
  `);
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});
