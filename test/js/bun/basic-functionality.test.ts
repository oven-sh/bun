import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("Basic Bun functionality", () => {
  test("Bun.version is available", () => {
    expect(typeof Bun.version).toBe("string");
    expect(Bun.version.length).toBeGreaterThan(0);
  });

  test("Bun.revision is available", () => {
    expect(typeof Bun.revision).toBe("string");
    expect(Bun.revision.length).toBeGreaterThan(0);
  });

  test("process.isBun is true", () => {
    expect(process.isBun).toBe(true);
  });

  test("Bun.main is the current file", () => {
    expect(typeof Bun.main).toBe("string");
    expect(Bun.main.endsWith(".test.ts")).toBe(true);
  });

  test("Bun.argv includes the script path", () => {
    expect(Array.isArray(Bun.argv)).toBe(true);
    expect(Bun.argv.length).toBeGreaterThanOrEqual(1);
    expect(typeof Bun.argv[0]).toBe("string");
  });

  test("Bun.env has environment variables", () => {
    expect(typeof Bun.env).toBe("object");
    expect(Bun.env).not.toBeNull();
    // PATH should exist on all platforms
    expect(typeof Bun.env.PATH).toBe("string");
  });

  test("Bun.hash function works", () => {
    const input = "hello world";
    const hash1 = Bun.hash(input);
    const hash2 = Bun.hash(input);
    
    expect(typeof hash1).toBe("number");
    expect(hash1).toBe(hash2); // Same input should produce same hash
    
    const hash3 = Bun.hash("different input");
    expect(hash3).not.toBe(hash1); // Different input should produce different hash
  });

  test("Bun.which finds executables", () => {
    // Test finding a common executable
    const nodeExists = Bun.which("node");
    if (nodeExists) {
      expect(typeof nodeExists).toBe("string");
      expect(nodeExists.length).toBeGreaterThan(0);
    }
    
    // Test non-existent executable
    const nonExistent = Bun.which("definitely-not-a-real-executable-12345");
    expect(nonExistent).toBeNull();
  });

  test("Bun.sleep works", async () => {
    const start = Date.now();
    await Bun.sleep(10); // Sleep for 10ms
    const end = Date.now();
    
    expect(end - start).toBeGreaterThanOrEqual(8); // Allow some tolerance
    expect(end - start).toBeLessThan(100); // But not too much
  });

  test("Bun can run simple JavaScript files", async () => {
    const dir = tempDirWithFiles("bun-basic-test", {
      "hello.js": `console.log("Hello from Bun!");`,
    });

    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "hello.js")],
      env: bunEnv,
      cwd: dir,
    });

    expect(exitCode).toBe(0);
    expect(String(stderr || "")).toBe("");
    expect(stdout.toString().trim()).toBe("Hello from Bun!");
  });

  test("Bun can run TypeScript files", async () => {
    const dir = tempDirWithFiles("bun-ts-test", {
      "hello.ts": `
        interface Greeting {
          message: string;
        }
        
        const greeting: Greeting = { message: "Hello from TypeScript!" };
        console.log(greeting.message);
      `,
    });

    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "hello.ts")],
      env: bunEnv,
      cwd: dir,
    });

    expect(exitCode).toBe(0);
    expect(String(stderr || "")).toBe("");
    expect(stdout.toString().trim()).toBe("Hello from TypeScript!");
  });

  test("Bun can handle imports", async () => {
    const dir = tempDirWithFiles("bun-import-test", {
      "math.js": `
        export function add(a, b) {
          return a + b;
        }
        
        export function multiply(a, b) {
          return a * b;
        }
      `,
      "main.js": `
        import { add, multiply } from "./math.js";
        
        console.log(add(2, 3));
        console.log(multiply(4, 5));
      `,
    });

    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "main.js")],
      env: bunEnv,
      cwd: dir,
    });

    expect(exitCode).toBe(0);
    expect(String(stderr || "")).toBe("");
    expect(stdout.toString().trim()).toBe("5\n20");
  });

  test("Bun can handle top-level await", async () => {
    const dir = tempDirWithFiles("bun-await-test", {
      "async.js": `
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        await delay(1);
        console.log("Async operation completed");
      `,
    });

    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "async.js")],
      env: bunEnv,
      cwd: dir,
    });

    expect(exitCode).toBe(0);
    expect(String(stderr || "")).toBe("");
    expect(stdout.toString().trim()).toBe("Async operation completed");
  });

  test("Bun can handle JSX", async () => {
    const dir = tempDirWithFiles("bun-jsx-test", {
      "react.jsx": `
        const element = <div>Hello JSX!</div>;
        console.log(element.type);
        console.log(element.props.children);
      `,
    });

    const { stdout, stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "react.jsx")],
      env: bunEnv,
      cwd: dir,
    });

    expect(exitCode).toBe(0);
    expect(String(stderr || "")).toBe("");
    expect(stdout.toString().trim()).toBe("div\nHello JSX!");
  });
});