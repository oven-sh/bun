import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

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
  expect(exitCode).not.toBe(0);
  expect(output).toContain("error:");
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
  expect(exitCode).not.toBe(0);
  expect(output).toContain("error:");
});
