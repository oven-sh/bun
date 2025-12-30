import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("ws WebSocket should handle 'upgrade' event listener without warning", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import WebSocket from "ws";
      
      const ws = new WebSocket("wss://echo.websocket.org");
      
      ws.on("upgrade", (response) => {
        console.log("upgrade event received");
      });
      
      ws.on("open", () => {
        console.log("open event received");
        ws.close();
      });
      
      ws.on("error", (err) => {
        console.error("error:", err.message);
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should not have warnings about unimplemented events
  expect(stderr).not.toContain("'upgrade' event is not implemented");
  expect(stdout).toContain("open event received");
  expect(exitCode).toBe(0);
});

test("ws WebSocket should handle 'unexpected-response' event listener without warning", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import WebSocket from "ws";
      
      // Try to connect to a server that will return non-101 status
      const ws = new WebSocket("wss://httpbin.org/status/404");
      
      ws.on("unexpected-response", (request, response) => {
        console.log("unexpected-response event received");
      });
      
      ws.on("error", (err) => {
        console.log("error event received");
      });
      
      setTimeout(() => {
        process.exit(0);
      }, 2000);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should not have warnings about unimplemented events
  expect(stderr).not.toContain("'unexpected-response' event is not implemented");
  expect(exitCode).toBe(0);
});

test("ws WebSocket with successful connection should emit upgrade event", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import WebSocket from "ws";
      
      const ws = new WebSocket("wss://echo.websocket.org");
      
      let upgradeEmitted = false;
      let openEmitted = false;
      
      ws.on("upgrade", (response) => {
        upgradeEmitted = true;
        console.log("UPGRADE_EMITTED");
      });
      
      ws.on("open", () => {
        openEmitted = true;
        console.log("OPEN_EMITTED");
        
        setTimeout(() => {
          console.log("RESULTS:", upgradeEmitted, openEmitted);
          ws.close();
          process.exit(0);
        }, 100);
      });
      
      ws.on("error", (err) => {
        console.error("ERROR:", err.message);
        process.exit(1);
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("'upgrade' event is not implemented");
  expect(stdout).toContain("UPGRADE_EMITTED");
  expect(stdout).toContain("OPEN_EMITTED");
  expect(stdout).toContain("RESULTS: true true");
  expect(exitCode).toBe(0);
});

test("ws WebSocket upgrade event should provide response object", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import WebSocket from "ws";
      
      const ws = new WebSocket("wss://echo.websocket.org");
      
      ws.on("upgrade", (response) => {
        console.log("Response object:", JSON.stringify({
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          hasHeaders: typeof response.headers === "object"
        }));
      });
      
      ws.on("open", () => {
        ws.close();
      });
      
      ws.on("error", (err) => {
        console.error("ERROR:", err.message);
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("'upgrade' event is not implemented");
  expect(stdout).toContain('"statusCode":101');
  expect(stdout).toContain('"statusMessage":"Switching Protocols"');
  expect(stdout).toContain('"hasHeaders":true');
  expect(exitCode).toBe(0);
});

test("ws WebSocket should work without upgrade listener (backward compatibility)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import WebSocket from "ws";
      
      const ws = new WebSocket("wss://echo.websocket.org");
      
      ws.on("open", () => {
        console.log("Connection opened successfully");
        ws.close();
      });
      
      ws.on("error", (err) => {
        console.error("ERROR:", err.message);
        process.exit(1);
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(stdout).toContain("Connection opened successfully");
  expect(exitCode).toBe(0);
});
