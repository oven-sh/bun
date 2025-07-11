import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun utilities", () => {
  test("Bun.spawn() can execute commands", async () => {
    const proc = Bun.spawn({
      cmd: ["echo", "Hello from spawn"],
      stdout: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(0);
    expect(output.trim()).toBe("Hello from spawn");
  });

  test("Bun.spawnSync() executes commands synchronously", () => {
    const result = Bun.spawnSync({
      cmd: ["echo", "Hello sync"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("Hello sync");
  });

  test("Bun.spawn() can capture stderr", async () => {
    const dir = tempDirWithFiles("stderr-test", {
      "error.js": `console.error("This is an error message");`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "error.js")],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(stderr.trim()).toBe("This is an error message");
  });

  test("Bun.spawn() can pass environment variables", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(process.env.TEST_VAR)"],
      env: { ...bunEnv, TEST_VAR: "test_value" },
      stdout: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output.trim()).toBe("test_value");
  });

  test("Bun.spawn() can set working directory", async () => {
    const dir = tempDirWithFiles("cwd-test", {
      "test.js": `console.log(process.cwd());`,
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output.trim()).toBe(dir);
  });

  test("Bun.$ template literal works", async () => {
    const result = await Bun.$`echo "Hello from template"`.text();
    expect(result.trim()).toBe("Hello from template");
  });

  test("Bun.$ can handle variables", async () => {
    const message = "Variable message";
    const result = await Bun.$`echo ${message}`.text();
    expect(result.trim()).toBe("Variable message");
  });

  test("Bun.CryptoHasher works", () => {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update("hello");
    hasher.update(" world");
    
    const hash1 = hasher.digest("hex");
    
    // Create another hasher for comparison
    const hasher2 = new Bun.CryptoHasher("sha256");
    hasher2.update("hello world");
    const hash2 = hasher2.digest("hex");
    
    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe("string");
    expect(hash1.length).toBe(64); // SHA256 hex length
  });

  test("Bun.password.hash() and verify() work", async () => {
    const password = "test_password_123";
    const hash = await Bun.password.hash(password);
    
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(20);
    
    const isValid = await Bun.password.verify(password, hash);
    const isInvalid = await Bun.password.verify("wrong_password", hash);
    
    expect(isValid).toBe(true);
    expect(isInvalid).toBe(false);
  });

  test("Bun.escapeHTML() escapes HTML characters", () => {
    const input = '<script>alert("xss")</script>';
    const escaped = Bun.escapeHTML(input);
    
    expect(escaped).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
  });

  test("Bun.FileSystemRouter works", () => {
    const dir = tempDirWithFiles("router-test", {
      "index.js": "export default () => 'Index page'",
      "about.js": "export default () => 'About page'",
      "users/[id].js": "export default () => 'User page'",
    });

    const router = new Bun.FileSystemRouter({
      style: "nextjs",
      dir: dir,
    });

    expect(router.match("/")).toBeTruthy();
    expect(router.match("/about")).toBeTruthy();
    expect(router.match("/users/123")).toBeTruthy();
    expect(router.match("/nonexistent")).toBeFalsy();
  });

  test("Bun.peek() can inspect streams without consuming", async () => {
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Hello"));
        controller.enqueue(new TextEncoder().encode(" World"));
        controller.close();
      }
    });

    const peeked = await Bun.peek(readable);
    expect(peeked).toBeDefined();
    expect(peeked instanceof Uint8Array).toBe(true);
    
    // Stream should still be readable after peeking
    const fullContent = await new Response(readable).text();
    expect(fullContent).toBe("Hello World");
  });

  test("Bun.gc() triggers garbage collection", () => {
    const before = process.memoryUsage();
    
    // Create some garbage
    for (let i = 0; i < 1000; i++) {
      new Array(1000).fill(i);
    }
    
    Bun.gc(true); // Force GC
    
    const after = process.memoryUsage();
    
    // Just verify it doesn't throw and returns undefined
    expect(typeof Bun.gc(false)).toBe("undefined");
  });

  test("Bun.inspect() formats objects", () => {
    const obj = { name: "test", numbers: [1, 2, 3] };
    const inspected = Bun.inspect(obj);
    
    expect(typeof inspected).toBe("string");
    expect(inspected).toContain("name");
    expect(inspected).toContain("test");
    expect(inspected).toContain("numbers");
  });

  test("Bun.deepEquals() compares objects deeply", () => {
    const obj1 = { a: 1, b: { c: 2 } };
    const obj2 = { a: 1, b: { c: 2 } };
    const obj3 = { a: 1, b: { c: 3 } };
    
    expect(Bun.deepEquals(obj1, obj2)).toBe(true);
    expect(Bun.deepEquals(obj1, obj3)).toBe(false);
    expect(Bun.deepEquals([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(Bun.deepEquals([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  test("globalThis contains Bun APIs", () => {
    expect(globalThis.Bun).toBeDefined();
    expect(typeof globalThis.Bun).toBe("object");
    expect(typeof globalThis.Bun.version).toBe("string");
    expect(typeof globalThis.Bun.serve).toBe("function");
    expect(typeof globalThis.Bun.file).toBe("function");
  });
});