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

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build", String(dir) + "/input.js"],
    env: bunEnv,
    cwd: String(dir),
  });

  const output = result.stderr.toString() + result.stdout.toString();

  // Should report parse errors, not crash with assertion
  expect(result.exitCode).not.toBe(0);
  expect(output).not.toContain("panic");
  expect(output).not.toContain("unreachable");
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

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build", String(dir) + "/input.js"],
    env: bunEnv,
    cwd: String(dir),
  });

  const output = result.stderr.toString() + result.stdout.toString();

  // Should report parse errors, not crash
  expect(result.exitCode).not.toBe(0);
  expect(output).not.toContain("panic");
  expect(output).not.toContain("unreachable");
  expect(output).toContain("error:");
});
