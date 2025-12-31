import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { WebSocketServer } from "ws";

// These tests verify that upgrade and unexpected-response events work correctly
// Tests that need to verify "no warnings" use Bun.spawn to capture stderr

test("ws WebSocket should not emit warnings for upgrade event", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as any).port;

  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import WebSocket from "ws";
        const ws = new WebSocket("ws://localhost:${port}");
        ws.on("upgrade", () => {});
        ws.on("open", () => ws.close());`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const stderr = await proc.stderr.text();
    expect(stderr).not.toContain("'upgrade' event is not implemented");
  } finally {
    server.close();
  }
});

test("ws WebSocket should not emit warnings for unexpected-response event", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as any).port;

  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import WebSocket from "ws";
        const ws = new WebSocket("ws://localhost:${port}");
        ws.on("unexpected-response", () => {});
        ws.on("open", () => ws.close());`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const stderr = await proc.stderr.text();
    expect(stderr).not.toContain("'unexpected-response' event is not implemented");
  } finally {
    server.close();
  }
});

test("ws WebSocket should emit upgrade event before open event", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as any).port;

  try {
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:${port}`);

    let upgradeEmitted = false;
    let openEmitted = false;

    ws.on("upgrade", () => {
      upgradeEmitted = true;
      expect(openEmitted).toBe(false);
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        openEmitted = true;
        expect(upgradeEmitted).toBe(true);
        ws.close();
        resolve();
      });
      ws.on("error", reject);
    });
  } finally {
    server.close();
  }
});

test("ws WebSocket upgrade event should provide response object with status code", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as any).port;

  try {
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      ws.on("upgrade", response => {
        expect(response.statusCode).toBe(101);
        expect(response.statusMessage).toBe("Switching Protocols");
        expect(typeof response.headers).toBe("object");
      });
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", reject);
    });
  } finally {
    server.close();
  }
});

test("ws WebSocket should work without upgrade listener", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as any).port;

  try {
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", reject);
    });
  } finally {
    server.close();
  }
});

test("native WebSocket should expose upgradeStatusCode property", async () => {
  const server = new WebSocketServer({ port: 0 });
  const port = (server.address() as any).port;

  try {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => {
        expect(ws.upgradeStatusCode).toBe(101);
        expect(typeof ws.upgradeStatusCode).toBe("number");
        ws.close();
        resolve();
      });
      ws.addEventListener("error", reject);
    });
  } finally {
    server.close();
  }
});
