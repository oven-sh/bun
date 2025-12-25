/**
 * Regression test for issue #25675
 * Dead code with switch-case is not eliminated
 *
 * @see https://github.com/oven-sh/bun/issues/25675
 */
import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Dead code elimination for switch statements", () => {
  test("switch after return should be eliminated", async () => {
    using dir = tempDir("dce-switch-test", {
      "input.ts": `
const a = 1;

const f1 = () => {
  return;

  switch (a) {
    case 2: {
      console.log('should be removed');
      break;
    }
  }
}

f1();
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "input.ts", "--minify"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    // The switch statement should be eliminated
    expect(stdout).not.toContain("switch");
    expect(stdout).not.toContain("should be removed");
    expect(exitCode).toBe(0);
  });

  test("if statement after return is also eliminated (baseline)", async () => {
    using dir = tempDir("dce-if-test", {
      "input.ts": `
const a = 1;

const f2 = () => {
  return;

  if (a === 2) {
    console.log('should be removed');
  }
}

f2();
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "input.ts", "--minify"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    // The if statement should be eliminated
    expect(stdout).not.toContain("should be removed");
    expect(exitCode).toBe(0);
  });

  test("switch with side effects in dead code should be eliminated", async () => {
    using dir = tempDir("dce-switch-sideeffects-test", {
      "input.ts": `
function test() {
  return "early";

  switch (Math.random()) {
    case 0:
      console.log("dead");
      break;
    default:
      console.log("also dead");
  }
}

test();
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "input.ts", "--minify"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout).not.toContain("switch");
    expect(stdout).not.toContain("dead");
    expect(exitCode).toBe(0);
  });
});
