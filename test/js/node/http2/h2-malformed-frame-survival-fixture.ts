// A bare node:http2 server for the malformed-frame survival test. It handles session-level errors
// (sessionError + per-session 'error') exactly like a production server would, but leaves the
// default uncaughtException behavior alone so a stray throw terminates the process — the test
// parent observes that as a non-zero exit instead of a liveness probe succeeding.
import http2 from "node:http2";

const server = http2.createServer();

server.on("sessionError", () => {});
server.on("session", session => {
  session.on("error", () => {});
});
server.on("stream", stream => {
  stream.on("error", () => {});
  stream.respond({ ":status": 200 });
  stream.end("ok");
});

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    process.stdout.write(`PORT:${addr.port}\n`);
  }
});

process.stdin.on("data", d => {
  if (d.toString().includes("quit")) {
    server.close();
    process.exit(0);
  }
});
process.stdin.resume();
