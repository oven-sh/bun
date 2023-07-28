import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("// @bun", () => {
  beforeEach(() => {
    delete require.cache[require.resolve("./async-transpiler-entry")];
    delete require.cache[require.resolve("./async-transpiler-imported")];
  });

  test("async transpiler", async () => {
    const { default: value } = await import("./async-transpiler-entry");
    expect(value).toBe(42);
  });

  test("require()", async () => {
    const { default: value } = require("./async-transpiler-entry");
    expect(value).toBe(42);
  });

  test("synchronous", async () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./async-transpiler-imported")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
    });
    expect(stdout.toString()).toBe("Hello world!\n");
    expect(exitCode).toBe(0);
  });
});
