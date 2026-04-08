// https://github.com/oven-sh/bun/issues/28976
//
// When a client aborts an in-flight POST request that had a body, the
// server-side `res.on('close')`, `req.socket.on('close')`, and
// `req.socket.on('end')` listeners never fired — the handler kept running
// to completion on a dead socket. Code that relied on those events to
// cancel downstream work (LLM streams, DB queries, upstream fetches) had
// no way to detect the disconnect.
//
// The bug was specific to bodies being present: without a body (e.g. a
// bare POST or GET), the events fired. The test runs the server as a
// subprocess so the internal "Premature close" error that fires on the
// abort (a side-effect, not the bug under test) doesn't pollute the
// outer test runner.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const SCRIPT = /* js */ `
const http = require("node:http");
const net = require("node:net");

const events = [];
let handlerEntered = false;
let bodyReceived = false;

const server = http.createServer((req, res) => {
  handlerEntered = true;
  const socket = req.socket;

  req.on("error", () => {});
  res.on("error", () => {});
  socket.on("error", () => {});

  // Consume the body so it is fully drained BEFORE the client aborts.
  // This is the exact scenario the bug was about: body done, req.complete
  // already true by the time the abort is observed.
  req.on("data", () => {});
  req.on("end", () => { bodyReceived = true; });

  res.on("close", () => {
    events.push("res close");
    maybeDone();
  });
  socket.on("close", () => {
    events.push("socket close");
    maybeDone();
  });
  socket.on("end", () => {
    events.push("socket end");
    maybeDone();
  });

  // Long-running work we would otherwise hang on a dead socket.
  const t = setTimeout(() => {
    if (!res.writableEnded) res.end("ok");
  }, 60_000);
  t.unref?.();
  res.on("close", () => clearTimeout(t));
});

function maybeDone() {
  if (
    events.includes("res close") &&
    events.includes("socket close") &&
    events.includes("socket end")
  ) {
    console.log("EVENTS=" + events.slice().sort().join(","));
    server.close();
    process.exit(0);
  }
}

server.listen(0, () => {
  const { port } = server.address();

  // Raw TCP client so we can send the body in full and wait for the
  // server to finish reading it before destroying — no dependency on
  // http.request's abort semantics, which don't guarantee the body is
  // fully drained on the server before the reset lands.
  const client = net.createConnection({ host: "127.0.0.1", port }, () => {
    const body = '{"hello":"world"}';
    client.write(
      "POST /test HTTP/1.1\\r\\n" +
      "Host: localhost\\r\\n" +
      "Content-Type: application/json\\r\\n" +
      "Content-Length: " + body.length + "\\r\\n" +
      "Connection: close\\r\\n" +
      "\\r\\n" +
      body
    );
    // Wait until the server actually finished reading the body, then
    // destroy to simulate a client abort on an in-flight request whose
    // body was already drained.
    const check = setInterval(() => {
      if (bodyReceived) {
        clearInterval(check);
        client.destroy();
      }
    }, 10);
  });
  client.on("error", () => {});
});

// Safety net: if the close events never fire (bug still present) or
// the handler never runs, bail with a deterministic failure line.
setTimeout(() => {
  console.log("EVENTS=" + events.slice().sort().join(","));
  console.log("HANDLER_ENTERED=" + handlerEntered);
  console.log("BODY_RECEIVED=" + bodyReceived);
  process.exit(1);
}, 15_000);
`;

test("res.on('close') / socket.on('close') / socket.on('end') fire after client abort on POST with body (#28976)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", SCRIPT],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const line = stdout
    .split("\n")
    .map(l => l.trim())
    .find(l => l.startsWith("EVENTS="));

  expect({ exitCode, line, stderr }).toEqual({
    exitCode: 0,
    line: "EVENTS=res close,socket close,socket end",
    stderr: expect.any(String),
  });
}, 30_000);
