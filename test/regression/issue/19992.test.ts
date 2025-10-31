import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("console.log %j formatter", () => {
  it("should format strings with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j", "abc")`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe('"abc"\n');
  });

  it("should format numbers with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j", 123)`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe("123\n");
  });

  it("should format objects with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j", { a: 1, b: 2 })`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe('{"a":1,"b":2}\n');
  });

  it("should format arrays with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j", [1, 2, 3])`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe("[1,2,3]\n");
  });

  it("should format null with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j", null)`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe("null\n");
  });

  it("should format undefined with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j", undefined)`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    // JSON.stringify(undefined) returns undefined
    // Node.js prints "undefined" for undefined values
    expect(proc.stdout.toString("utf8")).toBe("undefined\n");
  });

  it("should handle circular references with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `const a = {}; a.self = a; console.log("%j", a)`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe("[Circular]\n");
  });

  it("should format multiple values with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j %j", "abc", 123)`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe('"abc" 123\n');
  });

  it("should append remaining args after format string", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j", "abc", "extra")`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe('"abc" extra\n');
  });

  it("should handle %% escape sequence", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%%j", "abc")`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe("%j abc\n");
  });

  it("should format booleans with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j %j", true, false)`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe("true false\n");
  });

  it("should format nested objects with %j", () => {
    const proc = Bun.spawnSync({
      cmd: [bunExe(), "-e", `console.log("%j", { a: { b: { c: 1 } } })`],
      env: bunEnv,
      stdio: ["inherit", "pipe", "pipe"],
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stderr.toString("utf8")).toBeEmpty();
    expect(proc.stdout.toString("utf8")).toBe('{"a":{"b":{"c":1}}}\n');
  });
});
