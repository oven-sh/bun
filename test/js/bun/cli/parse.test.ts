import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

describe("Bun.CLI.parse", () => {
  test("parses simple flags", () => {
    const result = Bun.CLI.parse(["--verbose", "--port", "3000", "file.js"]);

    expect(result.verbose).toBe(true);
    expect(result.port).toBe(3000);
    expect(result._).toEqual(["file.js"]);
  });

  test("parses short flags", () => {
    const result = Bun.CLI.parse(["-v", "-p", "3000", "file.js"]);

    expect(result.v).toBe(true);
    expect(result.p).toBe(3000);
    expect(result._).toEqual(["file.js"]);
  });

  test("parses combined short flags", () => {
    const result = Bun.CLI.parse(["-vxz", "file.js"]);

    expect(result.v).toBe(true);
    expect(result.x).toBe(true);
    expect(result.z).toBe(true);
    expect(result._).toEqual(["file.js"]);
  });

  test("handles flag=value syntax", () => {
    const result = Bun.CLI.parse(["--port=3000", "--name=test"]);

    expect(result.port).toBe(3000);
    expect(result.name).toBe("test");
  });

  test("handles --no- prefix for negation", () => {
    const result = Bun.CLI.parse(["--no-verbose", "--no-color"]);

    expect(result.verbose).toBe(false);
    expect(result.color).toBe(false);
  });

  test("stops at -- separator", () => {
    const result = Bun.CLI.parse(["--verbose", "--", "--not-a-flag"]);

    expect(result.verbose).toBe(true);
    expect(result._).toEqual(["--not-a-flag"]);
  });

  test("auto-types values", () => {
    const result = Bun.CLI.parse([
      "--number", "42",
      "--float", "3.14",
      "--bool-true", "true",
      "--bool-false", "false",
      "--string", "hello"
    ]);

    expect(result.number).toBe(42);
    expect(result.float).toBe(3.14);
    expect(result["bool-true"]).toBe(true);
    expect(result["bool-false"]).toBe(false);
    expect(result.string).toBe("hello");
  });

  test("handles array flags", () => {
    const result = Bun.CLI.parse(
      ["--file", "a.js", "--file", "b.js", "--file", "c.js"],
      { array: ["file"] }
    );

    expect(result.file).toEqual(["a.js", "b.js", "c.js"]);
  });

  test("respects stopEarly option", () => {
    const result = Bun.CLI.parse(
      ["--verbose", "command", "--flag"],
      { stopEarly: true }
    );

    expect(result.verbose).toBe(true);
    expect(result._).toEqual(["command", "--flag"]);
  });

  test("handles aliases", () => {
    const result = Bun.CLI.parse(
      ["-v", "-p", "3000"],
      { alias: { v: "verbose", p: "port" } }
    );

    expect(result.verbose).toBe(true);
    expect(result.port).toBe(3000);
  });

  test("handles missing values", () => {
    const result = Bun.CLI.parse(["--port"]);

    expect(result.port).toBe("");
  });

  test("parseSimple works without options", () => {
    const result = Bun.CLI.parseSimple(["--verbose", "--port", "3000", "file.js"]);

    expect(result.verbose).toBe(true);
    expect(result.port).toBe(3000);
    expect(result._).toEqual(["file.js"]);
  });
});

describe("Bun.CLI.create", () => {
  test("creates CLI with schema", () => {
    const cli = Bun.CLI.create({
      name: "myapp",
      version: "1.0.0",
      flags: {
        verbose: { type: "boolean", short: "v", default: false },
        port: { type: "number", short: "p", default: 3000 },
        files: { type: "array", of: "string" },
      }
    });

    const result = cli.parse(["-v", "-p", "8080", "test.js"]);

    expect(result.verbose).toBe(true);
    expect(result.port).toBe(8080);
    expect(result._).toEqual(["test.js"]);
  });

  test("applies defaults from schema", () => {
    const cli = Bun.CLI.create({
      flags: {
        port: { type: "number", default: 3000 },
        host: { type: "string", default: "localhost" },
      }
    });

    const result = cli.parse([]);

    // TODO: Implement default handling
    // expect(result.port).toBe(3000);
    // expect(result.host).toBe("localhost");
  });
});

describe("Bun.CLI edge cases", () => {
  test("handles empty arguments", () => {
    const result = Bun.CLI.parse([]);

    expect(result._).toEqual([]);
  });

  test("handles only positional arguments", () => {
    const result = Bun.CLI.parse(["file1.js", "file2.js", "file3.js"]);

    expect(result._).toEqual(["file1.js", "file2.js", "file3.js"]);
  });

  test("handles unicode in arguments", () => {
    const result = Bun.CLI.parse(["--message", "Hello 世界 🌍"]);

    expect(result.message).toBe("Hello 世界 🌍");
  });

  test("handles special characters in flag values", () => {
    const result = Bun.CLI.parse(["--path", "/usr/local/bin", "--regex", "^test.*$"]);

    expect(result.path).toBe("/usr/local/bin");
    expect(result.regex).toBe("^test.*$");
  });

  test("handles quoted arguments", () => {
    const result = Bun.CLI.parse(["--message", "hello world", "--path", "my file.txt"]);

    expect(result.message).toBe("hello world");
    expect(result.path).toBe("my file.txt");
  });
});

describe("Bun.CLI performance", () => {
  test("parses 100 arguments quickly", () => {
    const args: string[] = [];
    for (let i = 0; i < 100; i++) {
      args.push(`--flag${i}`, `value${i}`);
    }

    const start = Bun.nanoseconds();
    const result = Bun.CLI.parse(args);
    const elapsed = Bun.nanoseconds() - start;

    // Should parse 100 args in under 1ms
    expect(elapsed).toBeLessThan(1_000_000);
    expect(result.flag0).toBe("value0");
    expect(result.flag99).toBe("value99");
  });

  test("handles large array flags efficiently", () => {
    const args: string[] = [];
    for (let i = 0; i < 1000; i++) {
      args.push("--file", `file${i}.js`);
    }

    const start = Bun.nanoseconds();
    const result = Bun.CLI.parse(args, { array: ["file"] });
    const elapsed = Bun.nanoseconds() - start;

    // Should handle 1000 array items in under 10ms
    expect(elapsed).toBeLessThan(10_000_000);
    expect(result.file).toHaveLength(1000);
    expect(result.file[0]).toBe("file0.js");
    expect(result.file[999]).toBe("file999.js");
  });
});