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
    error: Expecting Unicode escape sequence \\uXXXX
        at <cwd>/[eval]:1:34

    1 | export function x(){return<div a=\`\`/>}
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
  // in push_scope_for_parse_pass. `nextInsideJSXElement`'s syntax-error
  // branch set `end = current` on the first `(` without stepping past it,
  // causing re-dispatch on the same byte and duplicate scope offsets.
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
