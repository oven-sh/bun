import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("parser should not crash with assertion error on invalid async function syntax", async () => {
  // This used to cause: panic(main thread): reached unreachable code
  // when parsing invalid syntax where async function appears after missing comma
  using dir = tempDir("parser-assertion", {
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
    cmd: [bunExe(), "build", String(dir) + "/input.js"],
    env: bunEnv,
    cwd: String(dir),
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
  using dir = tempDir("parser-assertion-label", {
    "input.js": `
b: async function(first) {
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", String(dir) + "/input.js"],
    env: bunEnv,
    cwd: String(dir),
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
