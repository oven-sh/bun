import { expect, test } from "bun:test";
import inspector from "node:inspector";
import { WebSocket } from "ws";

type CDPMessage = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};

function wsOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", err => reject(err));
  });
}

function wsMessage(ws: WebSocket) {
  return new Promise<CDPMessage>((resolve, reject) => {
    ws.once("message", data => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
    ws.once("error", err => reject(err));
  });
}

test("node:inspector open/close/url + websocket smoke", async () => {
  // initial
  expect(inspector.url()).toBeUndefined();
  expect(inspector.console).toBeObject();

  inspector.open(0, "127.0.0.1", false);

  const u = inspector.url();
  expect(u).toBeString();
  expect(() => new URL(u!)).not.toThrow();

  const ws = new WebSocket(u!);
  await wsOpen(ws);

  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1 + 1" } }));
  const msg = await wsMessage(ws);

  expect(msg).toMatchObject({
    id: 1,
    result: {
      result: { type: "number", value: 2 },
    },
  });

  ws.close();

  inspector.close();
  expect(inspector.url()).toBeUndefined();
});

test("node:inspector open/close loop (state stability)", () => {
  for (let i = 0; i < 3; i++) {
    inspector.open(0, "127.0.0.1", false);
    expect(inspector.url()).toBeString();
    inspector.close();
    expect(inspector.url()).toBeUndefined();
  }
});

test("node:inspector open error path: port in use throws (and does not exit)", () => {
  using occupied = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });

  expect(() => inspector.open(occupied.port, "127.0.0.1", false)).toThrow();
  expect(inspector.url()).toBeUndefined();
});

test.skip("node:inspector waitForDebugger (no setTimeout, use subprocess connector)", () => {
  // TODO: This test crashes due to a known issue in bun's inspector implementation
  // when the WebSocket connection is closed. The crash occurs in
  // Inspector::FrontendRouter::disconnectFrontend. 
  inspector.open(0, "127.0.0.1", false);
  const u = inspector.url();
  expect(u).toBeString();

  // Spawn another bun process to connect and signal runIfWaitingForDebugger.
  const connector = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `
        const { WebSocket } = require("ws");
        const url = process.argv[1];
        const ws = new WebSocket(url);
        ws.on("open", () => {
          ws.send(JSON.stringify({ id: 1, method: "Runtime.runIfWaitingForDebugger" }));
          ws.close();
        });
        ws.on("error", (e) => {
          console.error(e);
          process.exit(2);
        });
      `,
      u!,
    ],
    stdout: "ignore",
    stderr: "inherit",
  });

  // Should return once the connector attaches.
  inspector.waitForDebugger();

  // Ensure connector exits successfully.
  expect(connector.exitCode).toBe(0);

  inspector.close();
});
