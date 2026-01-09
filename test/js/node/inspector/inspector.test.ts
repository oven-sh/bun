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

test("node:inspector websocket disconnect does not crash (PR4 fix)", async () => {
  // This test verifies the fix for the crash in Inspector::FrontendRouter::disconnectFrontend
  // when a WebSocket client disconnects. The crash was caused by calling disconnect on a
  // different InspectorController instance than the one we connected to.
  inspector.open(0, "127.0.0.1", false);
  const u = inspector.url();
  expect(u).toBeString();

  // Connect multiple WebSocket clients and disconnect them rapidly
  const clients: WebSocket[] = [];
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(u!);
    await wsOpen(ws);
    clients.push(ws);
  }

  // Send a message from each client
  for (let i = 0; i < clients.length; i++) {
    clients[i].send(JSON.stringify({ id: i + 1, method: "Runtime.evaluate", params: { expression: `${i}` } }));
  }

  // Close all clients rapidly (this used to crash)
  for (const ws of clients) {
    ws.close();
  }

  // Give time for disconnect to process
  await Bun.sleep(50);

  // Should not crash, and close should work
  inspector.close();
  expect(inspector.url()).toBeUndefined();
});

test("node:inspector waitForDebugger unblocks on debugger connect", async () => {
  // Test that waitForDebugger() blocks until a debugger connects and sends Runtime.runIfWaitingForDebugger.
  // 
  // Flow:
  // 1. Child: inspector.open() -> write URL to file -> waitForDebugger() [blocks]
  // 2. Parent: read URL from file -> WebSocket connect -> send Runtime.runIfWaitingForDebugger
  // 3. Child: waitForDebugger() unblocks -> exit 0
  //
  // The inspector server runs on a separate thread, so it can accept connections
  // even while the main thread is blocked in waitForDebugger().

  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const tmpFile = path.join(os.tmpdir(), `bun-inspector-url-${Date.now()}.txt`);

  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `
      const fs = require("fs");
      const inspector = require("node:inspector");

      inspector.open(0, "127.0.0.1", false);
      const url = inspector.url();
      
      // Write URL synchronously so parent can read it
      fs.writeFileSync(process.argv[1], url, "utf8");
      
      // This blocks until a debugger connects and sends Runtime.runIfWaitingForDebugger
      inspector.waitForDebugger();
      
      // If we reach here, waitForDebugger was successfully unblocked
      inspector.close();
      `,
      tmpFile,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  // Poll for URL file (child writes it before calling waitForDebugger)
  let url = "";
  for (let i = 0; i < 50; i++) {
    await Bun.sleep(100);
    try {
      url = fs.readFileSync(tmpFile, "utf8").trim();
      if (url.startsWith("ws://")) break;
    } catch {}
  }

  expect(url).toMatch(/^ws:\/\//);

  // Connect to the inspector (server runs on separate thread, accepts connections)
  const ws = new WebSocket(url);
  await wsOpen(ws);

  // Send Runtime.runIfWaitingForDebugger to unblock the child's waitForDebugger()
  ws.send(JSON.stringify({ id: 1, method: "Runtime.runIfWaitingForDebugger" }));
  const response = await wsMessage(ws);
  expect(response.id).toBe(1);

  ws.close();

  // Child should now exit successfully
  const exitCode = await child.exited;

  // Cleanup
  try {
    fs.unlinkSync(tmpFile);
  } catch {}

  expect(exitCode).toBe(0);
}, 15000);
