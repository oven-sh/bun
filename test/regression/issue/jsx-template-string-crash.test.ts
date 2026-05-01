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
    error: Unexpected >
        at <cwd>/[eval]:1:37"
  `);
  expect(normalizeBunSnapshot(stdout.toString())).toMatchInlineSnapshot(`""`);
});
