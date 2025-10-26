import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "path";

describe("process.on", () => {
  it("when called from the main thread", () => {
    const result = Bun.spawnSync({
      cmd: [bunExe(), path.join(__dirname, "process-on-fixture.ts")],
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(result.exitCode).toBe(0);
  });

  it("should work inside --compile", () => {
    const dir = tempDirWithFiles("process-on-test", {
      "process-on-fixture.ts": require("fs").readFileSync(require.resolve("./process-on-fixture.ts"), "utf-8"),
      "package.json": `{
        "name": "process-on-test",
        "type": "module",
        "scripts": {
          "start": "bun run process-on-fixture.ts"
        }
      }`,
    });
    const result1 = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", path.join(dir, "./process-on-fixture.ts"), "--outfile=./out"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(result1.exitCode).toBe(0);

    const result2 = Bun.spawnSync({
      cmd: ["./out"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(result2.exitCode).toBe(0);
  });

  it("should work inside a macro", () => {
    const dir = tempDirWithFiles("process-on-test", {
      "process-on-fixture.ts": require("fs").readFileSync(require.resolve("./process-on-fixture.ts"), "utf-8"),
      "entry.ts": `import { initialize } from "./process-on-fixture.ts" with {type: "macro"};
      initialize();`,
      "package.json": `{
        "name": "process-on-test",
        "type": "module",
        "scripts": {
          "start": "bun run entry.ts"
        }
      }`,
    });

    expect(
      Bun.spawnSync({
        cmd: [bunExe(), "build", "--target=bun", path.join(dir, "entry.ts"), "--outfile=./out.ts"],
        env: bunEnv,
        cwd: dir,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).exitCode,
    ).toBe(0);

    const result2 = Bun.spawnSync({
      cmd: [bunExe(), "run", "./out.ts"],
      env: bunEnv,
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(result2.exitCode).toBe(0);
  });

  it("should handle exceptions in uncaughtException handlers without panic", () => {
    const dir = tempDirWithFiles("uncaught-exception-test", {
      "test.ts": `
// Throw an error in an uncaughtException handler
// This should exit with code 7 without panicking
process.on('uncaughtException', (err) => {
  // This will throw a TypeError
  err instanceof undefined;
});

// Trigger the uncaughtException handler
throw new Error("Test error");
`,
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), path.join(dir, "test.ts")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const stderr = result.stderr.toString();

    // Should not panic
    expect(stderr).not.toContain("panic:");
    expect(stderr).not.toContain("SHOULD NEVER BE REACHED");

    // Should show the TypeError
    expect(stderr).toContain("TypeError");
    expect(stderr).toContain("Right hand side of instanceof is not an object");

    // Should exit with code 7 (nested exception in uncaught handler)
    expect(result.exitCode).toBe(7);
  });
});
