import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("--json flag", () => {
  describe("with --print", () => {
    test("primitive values", async () => {
      // Number
      {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--print", "42", "--json"],
          env: bunEnv,
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        expect(exitCode).toBe(0);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe("42");
      }

      // String
      {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--print", '"hello world"', "--json"],
          env: bunEnv,
          stderr: "pipe",
        });
        const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        expect(stdout.trim()).toBe('"hello world"');
      }

      // Boolean
      {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--print", "true", "--json"],
          env: bunEnv,
          stderr: "pipe",
        });
        const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        expect(stdout.trim()).toBe("true");
      }

      // null
      {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--print", "null", "--json"],
          env: bunEnv,
          stderr: "pipe",
        });
        const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        expect(stdout.trim()).toBe("null");
      }

      // undefined (should output nothing)
      {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--print", "undefined", "--json"],
          env: bunEnv,
          stderr: "pipe",
        });
        const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        expect(stdout.trim()).toBe("");
      }
    });

    test("complex objects", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "({x: 1, y: 'test', z: [1,2,3], nested: {a: true}})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({
        x: 1,
        y: "test",
        z: [1, 2, 3],
        nested: { a: true },
      });
    });

    test("arrays", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "[1, 'two', {three: 3}, [4,5]]", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual([1, "two", { three: 3 }, [4, 5]]);
    });

    test("dates", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", 'new Date("2024-01-15T12:30:00.000Z")', "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(stdout.trim()).toBe('"2024-01-15T12:30:00.000Z"');
    });

    test("promises", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "Promise.resolve({resolved: true})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ resolved: true });
    });

    test("circular references show error message", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "(() => { const obj = {}; obj.circular = obj; return obj; })()", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      // Error is printed to stdout, not stderr
      expect(stdout).toContain("JSON.stringify cannot serialize cyclic structures");
    });

    test("functions are undefined in JSON", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "({fn: () => {}, value: 42})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ value: 42 }); // fn should be omitted
    });

    test("--print without --json uses console formatter", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "({x: 1, y: 2})"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      // Console formatter includes spaces and formatting
      expect(stdout.trim()).toContain("x:");
      expect(stdout.trim()).toContain("y:");
      expect(stdout.trim()).not.toBe('{"x":1,"y":2}');
    });
  });

  describe("with --eval", () => {
    test("--eval without --json doesn't print", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--eval", "42"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(stdout.trim()).toBe("");
    });

    test("--eval with --json prints result as JSON", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--eval", "({result: 'success'})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ result: "success" });
    });

    test("expressions with side effects", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--eval", "console.log('side effect'); ({value: 123})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const lines = stdout.trim().split("\n");
      expect(lines[0]).toBe("side effect"); // console.log output
      expect(JSON.parse(lines[1])).toEqual({ value: 123 }); // JSON output
    });
  });

  describe("--json with regular script files", () => {
    test("regular script files do not output JSON (only --print and --eval do)", async () => {
      const dir = tempDirWithFiles("json-flag-script", {
        "script.js": `
          console.log("This will show");
          const data = { value: 123 };
          data; // This won't be captured - regular scripts don't have return values
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--json", "script.js"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      // Only console.log output appears, no JSON
      expect(stdout.trim()).toBe("This will show");
    });

    test("--json flag is primarily for --print and --eval", async () => {
      // Test to document that --json is meant for use with --print and --eval
      // Regular script files don't have a meaningful return value to capture
      const dir = tempDirWithFiles("json-flag-doc", {
        "data.js": `module.exports = { value: 42 };`,
      });

      // This shows the intended usage - evaluating the module
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--eval", "require('./data.js')", "--json"],
        env: bunEnv,
        cwd: dir,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ value: 42 });
    });
  });

  describe("edge cases", () => {
    test("BigInt serialization", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "({bigint: 123n})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ]);
      // BigInt error is printed to stdout
      expect(stdout).toContain("JSON.stringify cannot serialize BigInt");
    });

    test("Symbol serialization", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "({sym: Symbol('test'), value: 1})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      // Symbols are omitted in JSON
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ value: 1 });
    });

    test("NaN and Infinity", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "({nan: NaN, inf: Infinity, negInf: -Infinity})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({
        nan: null,
        inf: null,
        negInf: null,
      });
    });

    test("deeply nested objects", async () => {
      const deepObj = "({a: {b: {c: {d: {e: {f: {g: {h: 'deep'}}}}}}}})";
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", deepObj, "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.a.b.c.d.e.f.g.h).toBe("deep");
    });

    test("large arrays", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--print", "Array.from({length: 1000}, (_, i) => i)", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.length).toBe(1000);
      expect(parsed[0]).toBe(0);
      expect(parsed[999]).toBe(999);
    });
  });

  describe("flag combinations", () => {
    test("--json can appear before --print", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--json", "--print", "({order: 'reversed'})"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ order: "reversed" });
    });

    test("--json can appear before --eval", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--json", "--eval", "({order: 'eval-reversed'})"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ order: "eval-reversed" });
    });

    test("multiple --json flags are idempotent", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--json", "--print", "({multiple: true})", "--json"],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const parsed = JSON.parse(stdout.trim());
      expect(parsed).toEqual({ multiple: true });
    });
  });
});