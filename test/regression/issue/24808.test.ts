import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/24808
// When multiple server-side sockets have their remote clients disconnect while the server
// is actively writing data, ALL sockets should eventually emit the `close` event.
// Previously, only one socket would complete the full event lifecycle while the rest
// would stall after `end`, never emitting `close`.
test("all server sockets emit close when clients disconnect during active writes", async () => {
  const NUM_CLIENTS = 4;

  using dir = tempDir("24808", {
    "server.js": `
const net = require('net');
const buffer = Buffer.allocUnsafeSlow(1024 * 128);
const NUM = ${NUM_CLIENTS};
let socketId = 0;
const closedSet = new Set();

const server = net.createServer((c) => {
  const id = ++socketId;
  let canwrite = true;

  function write() {
    if (!c.writable) return;
    if (c.writableLength > 1024 * 1024 || !canwrite) return;
    canwrite = c.write(buffer, (err) => {
      if (err) return;
      canwrite = true;
      // Recursively write to keep the writable stream busy
      write();
    });
  }

  write();
  const tt = setInterval(write, 1);
  c.on("drain", write);

  c.on("end", () => { clearInterval(tt); });
  c.on("error", () => { clearInterval(tt); });
  c.on("close", () => {
    closedSet.add(id);
    c.removeAllListeners("drain");
    clearInterval(tt);
    if (closedSet.size === NUM) {
      console.log("CLOSED:" + JSON.stringify([...closedSet].sort()));
      clearTimeout(failTimer);
      server.close();
    }
  });
});

const failTimer = setTimeout(() => {
  console.log("TIMEOUT");
  console.log("CLOSED:" + JSON.stringify([...closedSet].sort()));
  process.exit(1);
}, 10000);

server.listen(0, () => {
  console.log("PORT:" + server.address().port);
});
`,
  });

  await using serverProc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read port from server stdout
  const reader = serverProc.stdout.getReader();
  let portLine = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    portLine += new TextDecoder().decode(value);
    if (portLine.includes("\n")) break;
  }

  const portMatch = portLine.match(/PORT:(\d+)/);
  expect(portMatch).not.toBeNull();
  const port = parseInt(portMatch![1]);

  // Create clients that connect, don't read data (to build up server backpressure), then disconnect
  await using clientProc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const net = require('net');
const sockets = [];
for (let i = 0; i < ${NUM_CLIENTS}; i++) {
  const s = net.connect({ port: ${port}, host: '127.0.0.1' });
  s.on('error', () => {});
  sockets.push(s);
}
setTimeout(() => {
  sockets.forEach(s => s.destroy());
  setTimeout(() => process.exit(0), 500);
}, 2000);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for server to finish
  let remaining = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    remaining += new TextDecoder().decode(value);
  }
  reader.releaseLock();

  const fullOutput = portLine + remaining;

  const [stdout, stderr, exitCode] = await Promise.all([
    Promise.resolve(fullOutput),
    serverProc.stderr.text(),
    serverProc.exited,
  ]);

  await clientProc.exited;

  const closedMatch = fullOutput.match(/CLOSED:(\[.*?\])/);
  expect(closedMatch).not.toBeNull();

  const closed = JSON.parse(closedMatch![1]);

  // All sockets should have received the close event
  expect(closed).toEqual([1, 2, 3, 4]);
  expect(exitCode).toBe(0);
}, 15000);
