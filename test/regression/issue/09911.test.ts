import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("ws upgrade and unexpected-response events (#9911)", () => {
  test("ws WebSocket should not emit warnings for upgrade event", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open() {},
        message() {},
        close() {},
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import WebSocket from "ws";
        const ws = new WebSocket("ws://localhost:${server.port}");
        ws.on("upgrade", () => {});
        ws.on("open", () => ws.close());
        ws.on("close", () => process.exit(0));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("'upgrade' event is not implemented");
    expect(exitCode).toBe(0);
  });

  test("ws WebSocket should not emit warnings for unexpected-response event", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open() {},
        message() {},
        close() {},
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import WebSocket from "ws";
        const ws = new WebSocket("ws://localhost:${server.port}");
        ws.on("unexpected-response", () => {});
        ws.on("open", () => ws.close());
        ws.on("close", () => process.exit(0));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("'unexpected-response' event is not implemented");
    expect(exitCode).toBe(0);
  });

  test("ws WebSocket should emit upgrade event with response object", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open() {},
        message() {},
        close() {},
      },
    });

    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:${server.port}`);

    let upgradeReceived = false;
    let upgradeResponse: any = null;

    await new Promise<void>((resolve, reject) => {
      ws.on("upgrade", (response: any) => {
        upgradeReceived = true;
        upgradeResponse = response;
      });
      ws.on("open", () => {
        ws.close();
      });
      ws.on("close", () => {
        resolve();
      });
      ws.on("error", reject);
    });

    expect(upgradeReceived).toBe(true);
    expect(upgradeResponse).not.toBeNull();
    expect(upgradeResponse.statusCode).toBe(101);
    expect(upgradeResponse.statusMessage).toBe("Switching Protocols");
    expect(typeof upgradeResponse.headers).toBe("object");
  });

  test("ws WebSocket upgrade event should be emitted before open event", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open() {},
        message() {},
        close() {},
      },
    });

    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:${server.port}`);

    const events: string[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on("upgrade", () => {
        events.push("upgrade");
      });
      ws.on("open", () => {
        events.push("open");
        ws.close();
      });
      ws.on("close", () => {
        resolve();
      });
      ws.on("error", reject);
    });

    expect(events).toEqual(["upgrade", "open"]);
  });

  test("ws WebSocket should work without upgrade listener (backward compatibility)", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open() {},
        message() {},
        close() {},
      },
    });

    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:${server.port}`);

    let openReceived = false;

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        openReceived = true;
        ws.close();
      });
      ws.on("close", () => {
        resolve();
      });
      ws.on("error", reject);
    });

    expect(openReceived).toBe(true);
  });

  test("native WebSocket should expose upgradeStatusCode property", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open() {},
        message() {},
        close() {},
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`);

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => {
        expect((ws as any).upgradeStatusCode).toBe(101);
        expect(typeof (ws as any).upgradeStatusCode).toBe("number");
        ws.close();
        resolve();
      });
      ws.addEventListener("error", reject);
    });
  });
});
