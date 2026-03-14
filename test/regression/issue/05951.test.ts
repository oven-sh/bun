import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";

function createUpgradeServer() {
  return Bun.serve({
    port: 0,
    fetch(req, server) {
      if (
        server.upgrade(req, {
          headers: {
            "X-Upgrade-Test": "upgrade-response",
          },
        })
      ) {
        return;
      }

      return new Response("Expected websocket upgrade", { status: 400 });
    },
    websocket: {
      message() {},
    },
  });
}

function createUnexpectedResponseServer(statusCode = 400) {
  return Bun.serve({
    port: 0,
    fetch() {
      return new Response("Unexpected websocket upgrade", {
        status: statusCode,
        headers: {
          "X-Bun-Test": "unexpected-response",
        },
      });
    },
  });
}

describe("ws upgrade and unexpected-response events", () => {
  test("ws WebSocket should not emit warnings for upgrade event", async () => {
    await using server = createUpgradeServer();

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import WebSocket from "ws";
        const ws = new WebSocket("ws://127.0.0.1:${server.port}");
        ws.on("upgrade", () => {});
        ws.on("open", () => ws.close());
        ws.on("close", () => process.exit(0));
        ws.on("error", error => {
          console.error(error.message);
          process.exit(1);
        });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).not.toContain("'upgrade' event is not implemented");
    expect(exitCode).toBe(0);
  });

  test("ws WebSocket should emit unexpected-response with a real response object", async () => {
    await using server = createUnexpectedResponseServer(400);
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

    await new Promise<void>((resolve, reject) => {
      let sawUnexpectedResponse = false;

      ws.on("unexpected-response", (_request, response) => {
        sawUnexpectedResponse = true;
        expect(response.statusCode).toBe(400);
        expect(response.statusMessage).toBe("Bad Request");
        expect(response.headers["x-bun-test"]).toBe("unexpected-response");
      });

      ws.on("open", () => reject(new Error("Unexpected open event")));
      ws.on("error", () => {});
      ws.on("close", () => {
        if (!sawUnexpectedResponse) {
          reject(new Error("Expected unexpected-response before close"));
          return;
        }

        resolve();
      });
    });
  });

  test("ws WebSocket should emit upgrade before open without changing open listener arguments", async () => {
    await using server = createUpgradeServer();
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const events: string[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on("open", (...args) => {
        events.push("open");
        expect(events).toEqual(["upgrade", "open"]);
        expect(args).toHaveLength(0);
        ws.close();
        resolve();
      });

      ws.on("upgrade", response => {
        events.push("upgrade");
        expect(response.statusCode).toBe(101);
      });

      ws.on("error", reject);
    });
  });

  test("ws WebSocket should keep open once() payload empty when upgrade listeners are active", async () => {
    await using server = createUpgradeServer();
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

    ws.on("upgrade", response => {
      expect(response.statusCode).toBe(101);
    });

    const openArgs = await once(ws, "open");
    expect(openArgs).toEqual([]);

    ws.close();
    await once(ws, "close");
  });

  test("ws WebSocket upgrade event should provide response object with status code", async () => {
    await using server = createUpgradeServer();
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

    await new Promise<void>((resolve, reject) => {
      ws.on("upgrade", response => {
        expect(response.statusCode).toBe(101);
        expect(response.statusMessage).toBe("Switching Protocols");
        expect(response.headers["x-upgrade-test"]).toBe("upgrade-response");
      });
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", reject);
    });
  });

  test("ws WebSocket should work without upgrade listener", async () => {
    await using server = createUpgradeServer();
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", reject);
    });
  });

  test("native WebSocket should work normally without upgradeStatusCode property", async () => {
    await using server = createUpgradeServer();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => {
        expect((ws as any).upgradeStatusCode).toBeUndefined();
        ws.close();
        resolve();
      });
      ws.addEventListener("error", reject);
    });
  });
});
