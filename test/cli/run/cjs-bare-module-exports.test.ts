import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("Loading a bare module.exports CommonJS module with @bun pragma", () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "cjs-bare-module-exports-loader.cjs")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });

  const output = stdout.toString();
  const errors = stderr.toString();

  expect(errors).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(exitCode).toBe(0);
  expect(output).toContain("Type: object");
  expect(output).toContain("Is Array: true");
  expect(output).toContain("Length: 4");
  expect(output).toContain("First element: 1");
  expect(output).toContain("After calling function: world");
  expect(output).toContain("SUCCESS");
});
