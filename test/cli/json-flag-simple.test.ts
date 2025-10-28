import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("--json flag simple tests", () => {
  test("--print with --json outputs JSON", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "--print", "42", "--json"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output.trim()).toBe("42");
    proc.unref();
  });

  test("--eval with --json outputs JSON", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "--eval", "({x: 1, y: 2})", "--json"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(output.trim());
    expect(parsed).toEqual({ x: 1, y: 2 });
    proc.unref();
  });
});
