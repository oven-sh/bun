import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Worker permission inheritance", () => {
  test("Worker inherits read permission from parent", async () => {
    using dir = tempDir("perm-worker-read", {
      "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = (e) => {
          console.log("RESULT:", e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          console.log("ERROR:", e.message);
          worker.terminate();
        };
      `,
      "worker.ts": `
        import { readFileSync } from "fs";
        try {
          const content = readFileSync("./data.txt", "utf8");
          postMessage("READ:" + content);
        } catch (e) {
          postMessage("DENIED:" + e.message);
        }
      `,
      "data.txt": "secret content",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-read", "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RESULT: READ:secret content");
    expect(exitCode).toBe(0);
  });

  test("Worker inherits permission denial from parent", async () => {
    using dir = tempDir("perm-worker-denied", {
      "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = (e) => {
          console.log("RESULT:", e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          console.log("ERROR:", e.message);
          worker.terminate();
        };
      `,
      "worker.ts": `
        import { readFileSync } from "fs";
        try {
          const content = readFileSync("./data.txt", "utf8");
          postMessage("READ:" + content);
        } catch (e) {
          postMessage("DENIED:" + e.message);
        }
      `,
      "data.txt": "secret content",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout + stderr).toContain("DENIED");
    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).toBe(0);
  });

  test("Worker inherits write permission from parent", async () => {
    using dir = tempDir("perm-worker-write", {
      "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = (e) => {
          console.log("RESULT:", e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          console.log("ERROR:", e.message);
          worker.terminate();
        };
      `,
      "worker.ts": `
        import { writeFileSync, readFileSync } from "fs";
        try {
          writeFileSync("./output.txt", "written by worker");
          const content = readFileSync("./output.txt", "utf8");
          postMessage("WROTE:" + content);
        } catch (e) {
          postMessage("DENIED:" + e.message);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-read", "--allow-write", "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RESULT: WROTE:written by worker");
    expect(exitCode).toBe(0);
  });

  test("Worker inherits net permission from parent", async () => {
    using dir = tempDir("perm-worker-net", {
      "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = (e) => {
          console.log("RESULT:", e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          console.log("ERROR:", e.message);
          worker.terminate();
        };
      `,
      "worker.ts": `
        try {
          // Just try to create a server on port 0 (random)
          const server = Bun.serve({
            port: 0,
            fetch() { return new Response("ok"); }
          });
          const port = server.port;
          server.stop();
          postMessage("SERVED:" + port);
        } catch (e) {
          postMessage("DENIED:" + e.message);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-net", "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RESULT: SERVED:");
    expect(exitCode).toBe(0);
  });

  test("Worker inherits env permission from parent", async () => {
    using dir = tempDir("perm-worker-env", {
      "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = (e) => {
          console.log("RESULT:", e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          console.log("ERROR:", e.message);
          worker.terminate();
        };
      `,
      "worker.ts": `
        try {
          const home = Bun.env.HOME || Bun.env.USERPROFILE || "unknown";
          postMessage("ENV:" + (home ? "found" : "empty"));
        } catch (e) {
          postMessage("DENIED:" + e.message);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-env", "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RESULT: ENV:found");
    expect(exitCode).toBe(0);
  });

  test("Worker inherits granular path permissions from parent", async () => {
    using dir = tempDir("perm-worker-granular", {
      "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = (e) => {
          console.log("RESULT:", e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          console.log("ERROR:", e.message);
          worker.terminate();
        };
      `,
      "worker.ts": `
        import { readFileSync } from "fs";
        const results = [];

        // Try to read allowed file
        try {
          readFileSync("./allowed.txt", "utf8");
          results.push("allowed:ok");
        } catch (e) {
          results.push("allowed:denied");
        }

        // Try to read forbidden file
        try {
          readFileSync("./forbidden.txt", "utf8");
          results.push("forbidden:ok");
        } catch (e) {
          results.push("forbidden:denied");
        }

        postMessage(results.join(","));
      `,
      "allowed.txt": "allowed content",
      "forbidden.txt": "forbidden content",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}/allowed.txt`, "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("allowed:ok");
    expect(stdout).toContain("forbidden:denied");
    expect(exitCode).toBe(0);
  });

  test("-A grants all permissions to Worker", async () => {
    using dir = tempDir("perm-worker-all", {
      "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = (e) => {
          console.log("RESULT:", e.data);
          worker.terminate();
        };
        worker.onerror = (e) => {
          console.log("ERROR:", e.message);
          worker.terminate();
        };
      `,
      "worker.ts": `
        import { readFileSync, writeFileSync } from "fs";
        const results = [];

        try {
          const content = readFileSync("./data.txt", "utf8");
          results.push("read:ok");
        } catch (e) {
          results.push("read:denied");
        }

        try {
          writeFileSync("./output.txt", "test");
          results.push("write:ok");
        } catch (e) {
          results.push("write:denied");
        }

        try {
          const home = Bun.env.HOME || Bun.env.USERPROFILE;
          results.push("env:" + (home ? "ok" : "empty"));
        } catch (e) {
          results.push("env:denied");
        }

        postMessage(results.join(","));
      `,
      "data.txt": "test data",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "-A", "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("read:ok");
    expect(stdout).toContain("write:ok");
    expect(stdout).toContain("env:ok");
    expect(exitCode).toBe(0);
  });
});
