// Preloaded into the verdaccio process forked by VerdaccioRegistry (test/harness.ts).
//
// The harness starts verdaccio with `-l 127.0.0.1:0` so the kernel assigns the
// port, but verdaccio's own `{ verdaccio_started: true }` IPC message does not
// say which port it got and its startup log line prints the configured `0`.
// verdaccio builds its listener with `http.createServer(app)`, so wrap that and
// report the port once the server is actually listening.
import http from "node:http";

const { createServer } = http;
http.createServer = function (...args: Parameters<typeof createServer>) {
  const server = createServer(...args);
  server.once("listening", () => {
    const address = server.address();
    if (typeof address === "object" && address !== null) {
      process.send!({ verdaccio_port: address.port });
    }
  });
  return server;
} as typeof createServer;
