import { expect, test } from "bun:test";
import http2 from "node:http2";
import net from "node:net";
import http2utils from "./helpers";

// Client-side handling of server push: refusing a pushed stream with
// close(NGHTTP2_REFUSED_STREAM) and the frames that race the refusal.

// Per-test barriers: a connection-level failure rejects every pending (and later) barrier so the
// test fails at its cause instead of the timeout; beginTeardown() disarms that for the expected
// end-of-test socket closes.
function makeBarriers() {
  const barriers: PromiseWithResolvers<any>[] = [];
  let failure: unknown;
  let failed = false;
  let tearingDown = false;
  const barrier = () => {
    const pending = Promise.withResolvers<any>();
    if (failed) {
      pending.promise.catch(() => {});
      pending.reject(failure);
    } else {
      barriers.push(pending);
    }
    return pending;
  };
  const failTest = (err: unknown) => {
    if (failed || tearingDown) return;
    failed = true;
    failure = err;
    for (const pending of barriers) {
      // A barrier the test is no longer awaiting must not surface as an unhandled rejection.
      pending.promise.catch(() => {});
      pending.reject(err);
    }
    barriers.length = 0;
  };
  const beginTeardown = () => {
    tearingDown = true;
  };
  return { barrier, failTest, beginTeardown };
}

test("http2 client refusing a pushed stream with close(NGHTTP2_REFUSED_STREAM) resets only that stream", async () => {
  // Refusing a push must reset only that stream: one RST_STREAM(REFUSED_STREAM), a coded
  // ERR_HTTP2_STREAM_ERROR on the pushed stream, and an untouched session (node behavior).
  const { barrier, failTest, beginTeardown } = makeBarriers();
  const server = http2.createServer();
  const serverPushClosed = barrier();
  server.on("stream", (stream, headers) => {
    stream.pushStream({ ":path": "/pushed" }, (err, push) => {
      if (err) return serverPushClosed.reject(err);
      push.on("error", () => {});
      push.on("close", () => serverPushClosed.resolve(push.rstCode));
      push.respond({ ":status": 200 });
      // Keep the pushed stream open: only the client's RST_STREAM closes it.
      push.write("pushed-chunk");
    });
    stream.respond({ ":status": 200 });
    stream.end("main-data");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const serverPort = server.address().port;

  // TCP proxy recording every HTTP/2 frame the client sends.
  const clientFrames = [];
  const proxySockets = [];
  const proxy = net.createServer(socket => {
    const upstream = net.connect(serverPort, "127.0.0.1");
    proxySockets.push(socket, upstream);
    let buffered = Buffer.alloc(0);
    let sawPreface = false;
    socket.on("data", chunk => {
      upstream.write(chunk);
      buffered = Buffer.concat([buffered, chunk]);
      if (!sawPreface) {
        if (buffered.length < 24) return;
        buffered = buffered.subarray(24);
        sawPreface = true;
      }
      while (buffered.length >= 9) {
        const length = buffered.readUIntBE(0, 3);
        if (buffered.length < 9 + length) break;
        clientFrames.push({
          type: buffered[3],
          streamId: buffered.readUInt32BE(5) & 0x7fffffff,
          payload: Buffer.from(buffered.subarray(9, 9 + length)),
        });
        buffered = buffered.subarray(9 + length);
      }
    });
    upstream.on("data", chunk => socket.write(chunk));
    socket.on("close", () => {
      upstream.destroy();
      failTest(new Error("proxy socket closed before the test finished"));
    });
    upstream.on("close", () => {
      socket.destroy();
      failTest(new Error("proxy upstream closed before the test finished"));
    });
    socket.on("error", failTest);
    upstream.on("error", failTest);
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));

  let client;
  try {
    client = http2.connect(`http://127.0.0.1:${proxy.address().port}`);
    const sessionErrors = [];
    client.on("error", err => {
      sessionErrors.push(err);
      failTest(err);
    });

    const pushEvents = [];
    const pushClosed = barrier();
    const pushSurfaced = barrier();
    client.on("stream", (pushedStream, headers) => {
      pushEvents.push(`stream ${headers[":path"]} writableEnded=${pushedStream.writableEnded}`);
      let localClose;
      try {
        // node: the client can never send on a pushed stream, so its local half reads closed.
        localClose = pushedStream.state.localClose;
      } catch (e) {
        localClose = e;
      }
      pushedStream.on("aborted", () => pushEvents.push("aborted"));
      pushedStream.on("error", err => pushEvents.push(`error ${err.code}: ${err.message}`));
      pushedStream.on("close", () => pushClosed.resolve(pushedStream.rstCode));
      pushedStream.close(http2.constants.NGHTTP2_REFUSED_STREAM);
      pushSurfaced.resolve({ id: pushedStream.id, localClose });
    });

    const reqClosed = barrier();
    const req = client.request({ ":path": "/" });
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => (body += chunk));
    req.on("error", reqClosed.reject);
    req.on("close", reqClosed.resolve);

    const { id: pushedId, localClose } = await pushSurfaced.promise;
    expect(pushEvents).toEqual(["stream /pushed writableEnded=true"]);
    expect(localClose).toBe(1);

    // The refusal closes the pushed stream with the requested code on both ends.
    expect(await pushClosed.promise).toBe(http2.constants.NGHTTP2_REFUSED_STREAM);
    expect(await serverPushClosed.promise).toBe(http2.constants.NGHTTP2_REFUSED_STREAM);
    expect(pushEvents).toEqual([
      "stream /pushed writableEnded=true",
      "error ERR_HTTP2_STREAM_ERROR: Stream closed with error code NGHTTP2_REFUSED_STREAM",
    ]);

    // The request that carried the PUSH_PROMISE (and the session) is untouched.
    await reqClosed.promise;
    expect(body).toBe("main-data");
    expect(req.rstCode).toBe(http2.constants.NGHTTP2_NO_ERROR);
    const againClosed = barrier();
    const again = client.request({ ":path": "/" });
    again.resume();
    again.on("error", againClosed.reject);
    again.on("close", againClosed.resolve);
    await againClosed.promise;
    expect(sessionErrors).toEqual([]);

    // The refusal RST_STREAM(REFUSED_STREAM) goes out exactly once (and first); any later RST is
    // the RFC 9113 5.1 closed-stream answer to pushed-response frames that raced it (next test).
    const pushedRstCodes = clientFrames
      .filter(f => f.type === 3 && f.streamId === pushedId)
      .map(f => f.payload.readUInt32BE(0));
    expect(pushedRstCodes[0]).toBe(http2.constants.NGHTTP2_REFUSED_STREAM);
    expect(pushedRstCodes.filter(code => code !== http2.constants.NGHTTP2_STREAM_CLOSED)).toEqual([
      http2.constants.NGHTTP2_REFUSED_STREAM,
    ]);
    expect(clientFrames.filter(f => (f.type === 0 || f.type === 1) && f.streamId === pushedId)).toEqual([]);

    // Graceful close still reaches 'close': the refused push does not pin the session open.
    const sessionClosed = barrier();
    client.on("close", sessionClosed.resolve);
    beginTeardown();
    client.close();
    await sessionClosed.promise;
  } finally {
    beginTeardown();
    client?.destroy();
    proxy.close();
    for (const socket of proxySockets) socket.destroy();
    server.close();
  }
});

test("http2 client ignores the pushed response that races a push refusal", async () => {
  // HEADERS for an even id the client already reset (the pushed response racing the refusal)
  // must not open a new stream (RFC 9113 5.1): a phantom stream would pin the session open.
  const pushBlock = Buffer.concat([
    // Static-table-only HPACK: :method GET (2), :scheme http (6), then literal-without-indexing
    // :path "/pushed" (name index 4) and :authority "localhost" (name index 1).
    Buffer.from([0x82, 0x86, 0x04, 0x07]),
    Buffer.from("/pushed"),
    Buffer.from([0x01, 0x09]),
    Buffer.from("localhost"),
  ]);
  const pushPromisePayload = Buffer.concat([Buffer.from([0, 0, 0, 2]), pushBlock]);
  const pushPromiseFrame = Buffer.concat([
    new http2utils.Frame(pushPromisePayload.length, 5, 0x4 /* END_HEADERS */, 1).data,
    pushPromisePayload,
  ]);

  const { barrier, failTest, beginTeardown } = makeBarriers();
  const clientFrames = [];
  const gotRequest = barrier();
  const gotPushRst = barrier();
  const gotPingAck = barrier();
  const sockets = [];
  const server = net.createServer(socket => {
    sockets.push(socket);
    let buffered = Buffer.alloc(0);
    let sawPreface = false;
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!sawPreface) {
        if (buffered.length < 24) return;
        buffered = buffered.subarray(24);
        sawPreface = true;
        socket.write(new http2utils.SettingsFrame(false).data);
        socket.write(new http2utils.SettingsFrame(true).data);
      }
      while (buffered.length >= 9) {
        const length = buffered.readUIntBE(0, 3);
        if (buffered.length < 9 + length) break;
        const frame = {
          type: buffered[3],
          flags: buffered[4],
          streamId: buffered.readUInt32BE(5) & 0x7fffffff,
          payload: Buffer.from(buffered.subarray(9, 9 + length)),
        };
        buffered = buffered.subarray(9 + length);
        clientFrames.push(frame);
        if (frame.type === 1 && frame.streamId === 1) gotRequest.resolve();
        if (frame.type === 3 && frame.streamId === 2) gotPushRst.resolve();
        if (frame.type === 6 && (frame.flags & 0x1) !== 0) gotPingAck.resolve();
      }
    });
    socket.on("error", failTest);
    socket.on("close", () => failTest(new Error("socket closed before the test finished")));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  let client;
  try {
    client = http2.connect(`http://127.0.0.1:${server.address().port}`);
    const sessionErrors = [];
    client.on("error", err => {
      sessionErrors.push(err);
      failTest(err);
    });
    const surfacedPushes = [];
    const pushClosed = barrier();
    client.on("stream", (pushedStream, headers) => {
      surfacedPushes.push(headers[":path"]);
      pushedStream.on("error", () => {});
      pushedStream.on("close", () => pushClosed.resolve(pushedStream.rstCode));
      pushedStream.close(http2.constants.NGHTTP2_REFUSED_STREAM);
    });
    const reqClosed = barrier();
    const req = client.request({ ":path": "/" });
    req.resume();
    req.on("error", reqClosed.reject);
    req.on("close", reqClosed.resolve);

    await gotRequest.promise;
    const socket = sockets[0];
    // PUSH_PROMISE reserving stream 2, then the response that ends the main request.
    socket.write(pushPromiseFrame);
    socket.write(new http2utils.HeadersFrame(1, http2utils.kFakeResponseHeaders, 0, true, true).data);

    await gotPushRst.promise;
    expect(await pushClosed.promise).toBe(http2.constants.NGHTTP2_REFUSED_STREAM);
    await reqClosed.promise;

    // The refusal already reached the server, now its response HEADERS for the pushed stream
    // land anyway. The PING ack is the barrier proving the client processed them.
    socket.write(new http2utils.HeadersFrame(2, http2utils.kFakeResponseHeaders, 0, true, false).data);
    socket.write(new http2utils.PingFrame(false).data);
    await gotPingAck.promise;

    // One RST_STREAM for the refusal; the late HEADERS get the RFC 9113 5.1 closed-stream
    // answer (STREAM_CLOSED) instead of being opened as a fresh stream.
    expect(clientFrames.filter(f => f.type === 3 && f.streamId === 2).map(f => f.payload.readUInt32BE(0))).toEqual([
      http2.constants.NGHTTP2_REFUSED_STREAM,
      http2.constants.NGHTTP2_STREAM_CLOSED,
    ]);
    expect(surfacedPushes).toEqual(["/pushed"]);
    expect(sessionErrors).toEqual([]);

    // Nothing is left pinning the session: a graceful close still reaches 'close'.
    const sessionClosed = barrier();
    client.on("close", sessionClosed.resolve);
    beginTeardown();
    client.close();
    await sessionClosed.promise;
  } finally {
    beginTeardown();
    client?.destroy();
    server.close();
    for (const socket of sockets) socket.destroy();
  }
});
