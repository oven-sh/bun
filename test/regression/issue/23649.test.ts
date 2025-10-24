import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/23649
test("parser should not crash with assertion error on invalid async function syntax", async () => {
  // This used to cause: panic(main thread): reached unreachable code
  // when parsing invalid syntax where async function appears after missing comma
  const dir = tempDirWithFiles("parser-assertion", {
    "input.js": `
const object = {
  a(el) {
  } // <-- no comma here
  b: async function(first) {

  }
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", join(dir, "input.js")],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stderr + stdout;

  // Should report parse errors, not crash with assertion
  expect(normalizeBunSnapshot(output, dir)).toMatchInlineSnapshot(`
    "5 |   b: async function(first) {
          ^
    error: Expected "}" but found "b"
        at <dir>/input.js:5:3

    5 |   b: async function(first) {
           ^
    error: Expected ";" but found ":"
        at <dir>/input.js:5:4

    5 |   b: async function(first) {
                           ^
    error: Expected identifier but found "("
        at <dir>/input.js:5:20

    5 |   b: async function(first) {
                            ^
    error: Expected "(" but found "first"
        at <dir>/input.js:5:21

    8 | }
        ^
    error: Unexpected }
        at <dir>/input.js:8:1"
  `);
  expect(exitCode).toBe(1);
});

test("parser should not crash with assertion error on labeled async function statement", async () => {
  // Similar case: labeled statement with async function
  const dir = tempDirWithFiles("parser-assertion-label", {
    "input.js": `
b: async function(first) {
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", join(dir, "input.js")],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = stderr + stdout;

  // Should report parse errors, not crash
  expect(normalizeBunSnapshot(output, dir)).toMatchInlineSnapshot(`
    "2 | b: async function(first) {
           ^
    error: Cannot use a declaration in a single-statement context
        at <dir>/input.js:2:4

    2 | b: async function(first) {
                         ^
    error: Expected identifier but found "("
        at <dir>/input.js:2:18

    2 | b: async function(first) {
                          ^
    error: Expected "(" but found "first"
        at <dir>/input.js:2:19"
  `);
  expect(exitCode).toBe(1);
});
