import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/26669
// WebSocket client crashes when binaryType = "blob" and ping frames are received
// without a "ping" event listener attached.
test("WebSocket with binaryType blob should not crash on ping frames", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const server = Bun.serve({
  port: 0,
  fetch(req, server) {
    const success = server.upgrade(req);
    if (success) return undefined;
    return new Response("Hello world");
  },
  websocket: {
    idleTimeout: 1, // Triggers ping frames quickly
    open(ws) {
      console.log("[Server] Connection opened");
    },
    message(ws, message) {
      console.log("[Server] Received:", message);
      ws.send("Echo: " + message);
    },
    close(ws, code, message) {
      console.log("[Server] Closed:", code);
    },
  },
});

const socket = new WebSocket("ws://localhost:" + server.port);
socket.binaryType = "blob"; // This was causing the crash

socket.addEventListener("open", () => {
  console.log("[Client] Connected");
  socket.send("Hello!");
});

socket.addEventListener("message", (event) => {
  console.log("[Client] Received:", event.data);
  // Close after receiving the echo to end the test
  socket.close();
});

socket.addEventListener("close", (event) => {
  console.log("[Client] Disconnected");
  server.stop();
  process.exit(0);
});

// Safety timeout - if we get here without crashing, the fix works
setTimeout(() => {
  console.log("[Test] Timeout reached without crash - test passed");
  socket.close();
  server.stop();
  process.exit(0);
}, 3000);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The bug caused a crash with "Pure virtual function called!" error
  expect(stderr).not.toContain("Pure virtual function called");
  expect(stderr).not.toContain("SIGABRT");

  // Should see normal WebSocket communication
  expect(stdout).toContain("[Client] Connected");
  expect(stdout).toContain("[Server] Connection opened");

  expect(exitCode).toBe(0);
});
