import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// Regression test for https://github.com/oven-sh/bun/issues/11032
// CJS exports inside control flow (if/else, while) produced invalid JS:
// - `export {}` clauses nested inside if-bodies (must be top-level)
// - references to undefined `tagSymbol` sentinel
describe("issue #11032: CJS exports inside control flow", () => {
  test("exports inside braceless if/else produces valid output", async () => {
    using dir = tempDir("issue-11032-if", {
      "mod.js": `
        var condition = true;
        if (condition) exports.x = "yes"; else exports.x = "no";
      `,
      "entry.js": `
        import { x } from "./mod.js";
        export { x };
      `,
    });

    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      target: "browser",
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);

    const output = await result.outputs[0].text();

    // The output must not contain invalid nested export clauses or sentinel references
    expect(output).not.toContain("tagSymbol");
    expect(output).not.toContain("__INVALID__REF__");

    // Verify the export clause is not nested inside an if-statement body.
    // A valid export clause should appear at the top level, not inside control flow.
    const lines = output.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("export")) {
        // Export lines should not be indented (i.e., not nested inside control flow)
        expect(line).toBe(trimmed);
      }
    }
  });

  test("exports inside braceless if/else runs correctly", async () => {
    using dir = tempDir("issue-11032-if-run", {
      "mod.js": `
        var condition = true;
        if (condition) exports.x = "yes"; else exports.x = "no";
      `,
      "entry.js": `
        import { x } from "./mod.js";
        console.log(x);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target", "bun", path.join(String(dir), "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildOutput, buildStderr, buildExitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // Write the bundled output and run it
    using runDir = tempDir("issue-11032-if-run-exec", {
      "bundle.js": buildOutput,
    });

    await using run = Bun.spawn({
      cmd: [bunExe(), path.join(String(runDir), "bundle.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout.trim()).toBe("yes");
    expect(exitCode).toBe(0);
  });

  test("exports inside while loop produces valid output", async () => {
    using dir = tempDir("issue-11032-while", {
      "mod.js": `
        var i = 0;
        while (i < 1) { exports.x = "from-loop"; i++; }
      `,
      "entry.js": `
        import { x } from "./mod.js";
        console.log(x);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target", "bun", path.join(String(dir), "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildOutput, buildStderr, buildExitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    expect(buildOutput).not.toContain("tagSymbol");
    expect(buildOutput).not.toContain("__INVALID__REF__");

    using runDir = tempDir("issue-11032-while-exec", {
      "bundle.js": buildOutput,
    });

    await using run = Bun.spawn({
      cmd: [bunExe(), path.join(String(runDir), "bundle.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout.trim()).toBe("from-loop");
    expect(exitCode).toBe(0);
  });

  test("exports inside braced if block produces valid output", async () => {
    using dir = tempDir("issue-11032-braced", {
      "mod.js": `
        var condition = true;
        if (condition) {
          exports.x = "braced";
        }
      `,
      "entry.js": `
        import { x } from "./mod.js";
        console.log(x);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target", "bun", path.join(String(dir), "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildOutput, buildStderr, buildExitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    expect(buildOutput).not.toContain("tagSymbol");
    expect(buildOutput).not.toContain("__INVALID__REF__");

    using runDir = tempDir("issue-11032-braced-exec", {
      "bundle.js": buildOutput,
    });

    await using run = Bun.spawn({
      cmd: [bunExe(), path.join(String(runDir), "bundle.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout.trim()).toBe("braced");
    expect(exitCode).toBe(0);
  });

  test("module.exports object inside braceless if produces valid output", async () => {
    using dir = tempDir("issue-11032-modexp-if", {
      "mod.js": `
        var condition = true;
        if (condition) module.exports = { x: "a", y: "b" };
      `,
      "entry.js": `
        import { x, y } from "./mod.js";
        console.log(x, y);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target", "bun", path.join(String(dir), "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildOutput, buildStderr, buildExitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    expect(buildOutput).not.toContain("tagSymbol");
    expect(buildOutput).not.toContain("__INVALID__REF__");

    using runDir = tempDir("issue-11032-modexp-if-exec", {
      "bundle.js": buildOutput,
    });

    await using run = Bun.spawn({
      cmd: [bunExe(), path.join(String(runDir), "bundle.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout.trim()).toBe("a b");
    expect(exitCode).toBe(0);
  });

  test("module.exports object inside while loop produces valid output", async () => {
    using dir = tempDir("issue-11032-modexp-while", {
      "mod.js": `
        var i = 0;
        while (i < 1) { module.exports = { x: "loop-obj" }; i++; }
      `,
      "entry.js": `
        import { x } from "./mod.js";
        console.log(x);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target", "bun", path.join(String(dir), "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildOutput, buildStderr, buildExitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    expect(buildOutput).not.toContain("tagSymbol");
    expect(buildOutput).not.toContain("__INVALID__REF__");

    using runDir = tempDir("issue-11032-modexp-while-exec", {
      "bundle.js": buildOutput,
    });

    await using run = Bun.spawn({
      cmd: [bunExe(), path.join(String(runDir), "bundle.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout.trim()).toBe("loop-obj");
    expect(exitCode).toBe(0);
  });

  test("top-level CJS exports still work correctly", async () => {
    using dir = tempDir("issue-11032-toplevel", {
      "mod.js": `
        exports.x = "top-level";
        exports.y = 42;
      `,
      "entry.js": `
        import { x, y } from "./mod.js";
        console.log(x, y);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target", "bun", path.join(String(dir), "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildOutput, buildStderr, buildExitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    using runDir = tempDir("issue-11032-toplevel-exec", {
      "bundle.js": buildOutput,
    });

    await using run = Bun.spawn({
      cmd: [bunExe(), path.join(String(runDir), "bundle.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);

    expect(stdout.trim()).toBe("top-level 42");
    expect(exitCode).toBe(0);
  });
});
