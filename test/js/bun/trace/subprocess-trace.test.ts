import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("subprocess tracing", () => {
  test("trace Bun.spawn", async () => {
    using dir = tempDir("trace-bun-spawn", {
      "test.js": `
        const proc = Bun.spawn(["echo", "hello", "world"]);
        const text = await new Response(proc.stdout).text();
        console.log("output:", text);
        const exitCode = await proc.exited;
        console.log("exit:", exitCode);
      `,
    });

    const traceFile = join(String(dir), "trace.jsonl");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("output: hello world");

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    // Should have subprocess namespace entries
    const subprocessTraces = traces.filter(t => t.ns === "subprocess");
    expect(subprocessTraces.length).toBeGreaterThan(0);

    // Check for spawn
    const spawnCalls = subprocessTraces.filter(t => t.data.call === "spawn");
    expect(spawnCalls.length).toBeGreaterThan(0);
    expect(spawnCalls[0].data.cmd).toBe("echo");
    expect(spawnCalls[0].data).toHaveProperty("pid");
    expect(spawnCalls[0].data).toHaveProperty("cwd");

    // Check for exit
    const exitCalls = subprocessTraces.filter(t => t.data.call === "exit");
    expect(exitCalls.length).toBeGreaterThan(0);
    expect(exitCalls[0].data).toHaveProperty("pid");
    expect(exitCalls[0].data.exit_code).toBe(0);
  });

  test("trace child_process spawn", async () => {
    using dir = tempDir("trace-child-process", {
      "test.js": `
        import { spawn } from "child_process";
        const child = spawn("echo", ["hello"]);
        child.stdout.on("data", (data) => console.log("stdout:", data.toString()));
        child.on("close", (code) => console.log("closed:", code));
        await new Promise(resolve => setTimeout(resolve, 100));
      `,
    });

    const traceFile = join(String(dir), "trace.jsonl");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    const subprocessTraces = traces.filter(t => t.ns === "subprocess");
    expect(subprocessTraces.length).toBeGreaterThan(0);

    // Check for spawn with echo command
    const spawnCalls = subprocessTraces.filter(t => t.data.call === "spawn" && t.data.cmd === "echo");
    expect(spawnCalls.length).toBeGreaterThan(0);
  });

  test("trace subprocess with arguments", async () => {
    using dir = tempDir("trace-subprocess-args", {
      "test.js": `
        const proc = Bun.spawn(["echo", "arg1", "arg2", "arg3"]);
        await proc.exited;
        console.log("done");
      `,
    });

    const traceFile = join(String(dir), "trace.jsonl");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    const subprocessTraces = traces.filter(t => t.ns === "subprocess");
    const spawnCalls = subprocessTraces.filter(t => t.data.call === "spawn");

    expect(spawnCalls.length).toBeGreaterThan(0);
    // Check that args count is tracked (4 args: echo, arg1, arg2, arg3)
    expect(spawnCalls[0].data.args || spawnCalls[0].data.args_count).toBeGreaterThanOrEqual(4);
  });
});
