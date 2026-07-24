/**
 * This test must also pass in Node.js.
 */
import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";

test("aborted request body emits 'error' ECONNRESET and res 'close' before req 'close'", async () => {
  // Like Node.js's socketOnClose → abortIncoming: the aborted request is
  // destroyed with ConnResetException after res 'close' has been scheduled.
  const events: string[] = [];
  const { promise: gotRequest, resolve: resolveRequest } = Promise.withResolvers<void>();
  const { promise: reqClosed, resolve: resolveReqClosed } = Promise.withResolvers<void>();
  const { promise: resClosed, resolve: resolveResClosed } = Promise.withResolvers<void>();

  const server = createServer((req, res) => {
    req.on("aborted", () => events.push("req.aborted"));
    req.on("error", e => events.push("req.error:" + (e as NodeJS.ErrnoException).code));
    req.on("close", () => {
      events.push("req.close");
      resolveReqClosed();
    });
    res.on("close", () => {
      events.push("res.close");
      resolveResClosed();
    });
    req.on("data", () => {});
    resolveRequest();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect(port, "127.0.0.1");
    client.on("error", () => {});
    await once(client, "connect");
    client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial");
    await gotRequest;
    client.destroy();
    await Promise.all([reqClosed, resClosed]);

    expect(events).toEqual(["req.aborted", "res.close", "req.error:ECONNRESET", "req.close"]);
  } finally {
    server.close();
  }
});

test("res.write()/end() after req.socket.destroy() inside the handler", async () => {
  // The request handler destroys its own socket before writing: write() must
  // report false (Node.js's OutgoingMessage._writeRaw returns false for a
  // destroyed socket) and end() must still transition to `finished` /
  // `writableEnded` and emit 'prefinish', without emitting 'finish'.
  const events: string[] = [];
  const { promise: resClosed, resolve: resolveResClosed } = Promise.withResolvers<void>();
  let writeResult: boolean | undefined;
  let endReturnedSelf: boolean | undefined;
  let finishedAfterEnd: boolean | undefined;
  let writableEndedAfterEnd: boolean | undefined;
  let writeCbCalled = false;
  let endCbCalled = false;

  const server = createServer((req, res) => {
    res.on("prefinish", () => events.push("res.prefinish"));
    res.on("finish", () => events.push("res.finish"));
    res.on("close", () => {
      events.push("res.close");
      resolveResClosed();
    });

    req.socket.destroy();
    writeResult = res.write("body", () => (writeCbCalled = true));
    endReturnedSelf = res.end("done", () => (endCbCalled = true)) === res;
    finishedAfterEnd = res.finished;
    writableEndedAfterEnd = res.writableEnded;
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect(port, "127.0.0.1");
    client.on("error", () => {});
    await once(client, "connect");
    client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await resClosed;

    expect({
      writeResult,
      endReturnedSelf,
      finishedAfterEnd,
      writableEndedAfterEnd,
      writeCbCalled,
      endCbCalled,
      events,
    }).toEqual({
      writeResult: false,
      endReturnedSelf: true,
      finishedAfterEnd: true,
      writableEndedAfterEnd: true,
      writeCbCalled: false,
      endCbCalled: false,
      events: ["res.prefinish", "res.close"],
    });
  } finally {
    server.close();
  }
});
