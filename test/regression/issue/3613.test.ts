import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/3613
// WebSocketServer handleProtocols option should set the selected protocol in the upgrade response
test("ws WebSocketServer handleProtocols sets selected protocol", async () => {
  using dir = tempDir("ws-handle-protocols", {
    "server.js": `
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({
  port: 0,
  handleProtocols: (protocols, request) => {
    return 'selected-protocol';
  }
});

wss.on('listening', async () => {
  const port = wss.address().port;
  console.log('PORT:' + port);

  // Test using fetch to verify the actual response headers
  try {
    const res = await fetch('http://127.0.0.1:' + port, {
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": "custom-protocol, selected-protocol"
      }
    });
    console.log("STATUS:" + res.status);
    console.log("PROTOCOL:" + res.headers.get("sec-websocket-protocol"));
  } catch (e) {
    console.log("ERROR:" + e.message);
  }

  wss.close();
  process.exit(0);
});

wss.on('connection', (ws) => {
  console.log('SERVER_WS_PROTOCOL:' + ws.protocol);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The server should respond with the protocol selected by handleProtocols
  expect(stdout).toContain("STATUS:101");
  expect(stdout).toContain("PROTOCOL:selected-protocol");
  expect(stdout).toContain("SERVER_WS_PROTOCOL:selected-protocol");
  expect(exitCode).toBe(0);
});

test("ws WebSocketServer handleProtocols with no protocol", async () => {
  using dir = tempDir("ws-handle-protocols-empty", {
    "server.js": `
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({
  port: 0,
  handleProtocols: (protocols, request) => {
    // Return empty string - should not set a protocol header
    return '';
  }
});

wss.on('listening', async () => {
  const port = wss.address().port;
  console.log('PORT:' + port);

  try {
    const res = await fetch('http://127.0.0.1:' + port, {
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": "custom-protocol"
      }
    });
    console.log("STATUS:" + res.status);
    // When handleProtocols returns empty, Bun falls back to client's first protocol
    console.log("PROTOCOL:" + res.headers.get("sec-websocket-protocol"));
  } catch (e) {
    console.log("ERROR:" + e.message);
  }

  wss.close();
  process.exit(0);
});

wss.on('connection', (ws) => {
  console.log('SERVER_WS_PROTOCOL:' + JSON.stringify(ws.protocol));
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The server should respond with 101 status
  expect(stdout).toContain("STATUS:101");
  expect(exitCode).toBe(0);
});

test("ws WebSocketServer without handleProtocols uses first client protocol", async () => {
  using dir = tempDir("ws-no-handle-protocols", {
    "server.js": `
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({
  port: 0,
  // No handleProtocols - should default to first client protocol
});

wss.on('listening', async () => {
  const port = wss.address().port;
  console.log('PORT:' + port);

  try {
    const res = await fetch('http://127.0.0.1:' + port, {
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": "first-protocol, second-protocol"
      }
    });
    console.log("STATUS:" + res.status);
    console.log("PROTOCOL:" + res.headers.get("sec-websocket-protocol"));
  } catch (e) {
    console.log("ERROR:" + e.message);
  }

  wss.close();
  process.exit(0);
});

wss.on('connection', (ws) => {
  console.log('SERVER_WS_PROTOCOL:' + ws.protocol);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Without handleProtocols, should default to first client protocol
  expect(stdout).toContain("STATUS:101");
  expect(stdout).toContain("PROTOCOL:first-protocol");
  expect(stdout).toContain("SERVER_WS_PROTOCOL:first-protocol");
  expect(exitCode).toBe(0);
});
