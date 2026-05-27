import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.JSONC exists", () => {
  expect(Bun.JSONC).toBeDefined();
  expect(typeof Bun.JSONC).toBe("object");
  expect(typeof Bun.JSONC.parse).toBe("function");
});

test("Bun.JSONC.parse handles basic JSON", () => {
  const result = Bun.JSONC.parse('{"name": "test", "value": 42}');
  expect(result).toEqual({ name: "test", value: 42 });
});

test("Bun.JSONC.parse handles comments", () => {
  const jsonc = `{
    // This is a comment
    "name": "test",
    /* This is a block comment */
    "value": 42
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({ name: "test", value: 42 });
});

test("Bun.JSONC.parse handles trailing commas", () => {
  const jsonc = `{
    "name": "test",
    "value": 42,
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({ name: "test", value: 42 });
});

test("Bun.JSONC.parse handles arrays with trailing commas", () => {
  const jsonc = `[
    1,
    2,
    3,
  ]`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual([1, 2, 3]);
});

test("Bun.JSONC.parse handles complex JSONC", () => {
  const jsonc = `{
    // Configuration object
    "name": "my-app",
    "version": "1.0.0",
    /* Dependencies section */
    "dependencies": {
      "react": "^18.0.0",
      "typescript": "^5.0.0", // Latest TypeScript
    },
    "scripts": [
      "build",
      "test",
      "lint", // Code formatting
    ],
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({
    name: "my-app",
    version: "1.0.0",
    dependencies: {
      react: "^18.0.0",
      typescript: "^5.0.0",
    },
    scripts: ["build", "test", "lint"],
  });
});

test("Bun.JSONC.parse handles nested objects", () => {
  const jsonc = `{
    "outer": {
      // Nested comment
      "inner": {
        "value": 123,
      }
    },
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({
    outer: {
      inner: {
        value: 123,
      },
    },
  });
});

test("Bun.JSONC.parse handles boolean and null values", () => {
  const jsonc = `{
    "enabled": true, // Boolean true
    "disabled": false, // Boolean false
    "nothing": null, // Null value
  }`;

  const result = Bun.JSONC.parse(jsonc);
  expect(result).toEqual({
    enabled: true,
    disabled: false,
    nothing: null,
  });
});

test("Bun.JSONC.parse throws on invalid JSON", () => {
  expect(() => {
    Bun.JSONC.parse("{ invalid json }");
  }).toThrow();
});

test("Bun.JSONC.parse handles empty object", () => {
  const result = Bun.JSONC.parse("{}");
  expect(result).toEqual({});
});

test("Bun.JSONC.parse handles empty array", () => {
  const result = Bun.JSONC.parse("[]");
  expect(result).toEqual([]);
});

test("Bun.JSONC.parse throws on deeply nested arrays instead of crashing", () => {
  // Calibrated to exhaust the 18 MB main-thread stack (largest of any
  // platform) at the smallest expected per-recursion frame size (~100 B in
  // release builds). Previously 25_000, which was sized for Zig's larger
  // frames (no LLVM lifetime annotations → frame is the union of all locals).
  const depth = 200_000;
  const deepJson = Buffer.alloc(depth, "[").toString() + Buffer.alloc(depth, "]").toString();
  expect(() => Bun.JSONC.parse(deepJson)).toThrow(RangeError);
});

test("Bun.JSONC.parse throws on deeply nested objects instead of crashing", () => {
  const depth = 200_000;
  const deepJson = Buffer.alloc(depth * 5, '{"a":').toString() + "1" + Buffer.alloc(depth, "}").toString();
  expect(() => Bun.JSONC.parse(deepJson)).toThrow(RangeError);
});

// The lenient JSONC parser recovers from errors, so a large malformed input
// can produce a diagnostic for nearly every token. Computing each
// diagnostic's line/column used to rescan the source from byte 0, which made
// error reporting quadratic — a ~250 KB input hung for minutes (found by
// fuzzing). Positions are now computed incrementally, so these inputs must
// parse (or fail) in linear time.
test("Bun.JSONC.parse handles pathological inputs in linear time", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // A number in object-key position desyncs the parser, after which the
        // object-property recovery loop walks the remaining ~250 KB logging
        // errors as it goes.
        {
          const input = "[{" + "-1" + Buffer.alloc(5 * 50_000, '"":[{').toString();
          let threw;
          try {
            Bun.JSONC.parse(input);
          } catch (e) {
            threw = e;
          }
          if (threw?.name !== "AggregateError") throw new Error("expected AggregateError, got " + threw);
          console.log("OK malformed flood");
        }
        // Duplicate-key warnings compute a position per warning the same way;
        // a valid object with ~40k duplicate keys used to take >10 seconds.
        {
          const input = "{" + Buffer.alloc(6 * 40_000, '"a":1,').toString() + '"a":1}';
          const result = Bun.JSONC.parse(input);
          if (result.a !== 1) throw new Error("unexpected parse result");
          console.log("OK duplicate key flood");
        }
        console.log("DONE");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Generous kill switch: the fixed parser finishes in a few seconds even in
    // debug+ASAN builds, while the quadratic behavior took minutes.
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("OK malformed flood");
  expect(stdout).toContain("OK duplicate key flood");
  expect(stdout).toContain("DONE");
  expect(exitCode).toBe(0);
}, 90_000);
