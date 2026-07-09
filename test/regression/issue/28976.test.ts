// https://github.com/oven-sh/bun/issues/28976
import { expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

test("res/socket 'close' and socket 'end' fire after client abort on POST with body (#28976)", async () => {
  const seen = new Set<string>();
  const { promise: bodyReceived, resolve: onBody } = Promise.withResolvers<void>();
  const { promise: allEvents, resolve: onAllEvents } = Promise.withResolvers<void>();

  const check = () => {
    if (seen.has("res close") && seen.has("socket close") && seen.has("socket end")) onAllEvents();
  };

  await using server = http.createServer((req, res) => {
    const socket = req.socket!;

    // Swallow the benign "aborted"/premature-close errors that the abort
    // produces; they are a side effect, not the behavior under test.
    req.on("error", () => {});
    res.on("error", () => {});
    socket.on("error", () => {});

    // Consume the body so it is fully drained BEFORE the client aborts.
    // This is the exact scenario the bug was about: body done, req.complete
    // already true by the time the abort is observed.
    req.on("data", () => {});
    req.on("end", () => onBody());

    res.on("close", () => {
      seen.add("res close");
      check();
    });
    socket.on("close", () => {
      seen.add("socket close");
      check();
    });
    socket.on("end", () => {
      seen.add("socket end");
      check();
    });

    // Never respond: the test asserts the close events fire from the abort,
    // not from a completed response.
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const { port } = server.address() as net.AddressInfo;

  // Raw TCP client so we can send the body in full and wait for the server
  // to finish reading it before aborting — no dependency on http.request's
  // abort semantics, which don't guarantee the body is drained server-side
  // before the reset lands.
  const client = net.connect(port);
  client.on("error", () => {});
  const body = '{"hello":"world"}';
  client.write(
    "POST /test HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${body.length}\r\n` +
      "Connection: close\r\n" +
      "\r\n" +
      body,
  );

  // Wait for the server to fully read the body, then abort. If the fix is
  // absent the close events never fire and the test times out (the default
  // bun:test timeout is the failure signal here).
  await bodyReceived;
  client.destroy();
  await allEvents;

  expect([...seen].sort()).toEqual(["res close", "socket close", "socket end"]);
});

// Companion guard for the fix above: teaching the socket's 'close' event to
// drive the internal one-shot setCloseCallback path (so res.on('close') fires
// on a peer abort) must not make res emit 'close' twice when res.destroy() is
// called asynchronously — e.g. from a timer or error handler — while the
// socket is still attached. ServerResponse.prototype.destroy marks the
// response closed before emitting, so emitCloseNT's `!_closed` guard gates out
// the later socket-close path.
test("res.destroy() from a later tick emits 'close' exactly once (#28976)", async () => {
  let resCloseCount = 0;
  const { promise: socketClosed, resolve: onSocketClose } = Promise.withResolvers<void>();

  await using server = http.createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    req.socket!.on("error", () => {});

    res.on("close", () => {
      resCloseCount++;
    });
    // The emit() override drives any second res-'close' during the socket's
    // own close emission, which runs before the socket's 'close' listeners,
    // so resCloseCount is final by the time this resolves. No timer needed.
    req.socket!.on("close", () => onSocketClose());

    res.writeHead(200);
    // Defer the destroy out of the synchronous request handler — that's the
    // path that used to emit 'close' twice.
    setImmediate(() => res.destroy());
  });

  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const { port } = server.address() as net.AddressInfo;

  const client = net.connect(port);
  client.on("error", () => {});
  client.write("GET /test HTTP/1.1\r\nHost: localhost\r\n\r\n");

  await socketClosed;
  expect(resCloseCount).toBe(1);
});
