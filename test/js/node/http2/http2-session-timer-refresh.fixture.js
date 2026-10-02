// Counts how often each step of an HTTP/2 exchange refreshes the idle timer of the client session
// and the idle timer of the server session. Run as a script, this file prints the counts as one
// JSON line. Node.js and Bun must give the same counts.
const http2 = require("node:http2");
const fs = require("node:fs");
const { once } = require("node:events");

// The Timeout of session.setTimeout().
function idleTimer(session) {
  if (typeof Bun !== "undefined") return session[Symbol.for("::buntimeout::")];
  const symbols = Object.getOwnPropertySymbols(session);
  return session[symbols.find(symbol => symbol.description === "kTimeout" || symbol.description === "timeout")];
}

// Returns a function that gives the refresh() calls on the idle timer since its last call.
function refreshCounter(session) {
  const timer = idleTimer(session);
  const refresh = timer.refresh;
  let count = 0;
  timer.refresh = function () {
    count++;
    return refresh.call(this);
  };
  return () => {
    const n = count;
    count = 0;
    return n;
  };
}

// `server` is an HTTP/2 server without a session. `connect()` starts a client session to it.
async function countTimerRefreshes(server, connect) {
  // The timers must not expire by themselves.
  const never = 2 ** 30;
  const seen = {};
  const fd = fs.openSync(__filename, "r");
  let client;
  let serverSession;
  let clientRefreshes;
  let serverRefreshes;
  const record = step => {
    seen[step] = { client: clientRefreshes(), server: serverRefreshes() };
  };
  const nextStream = () => once(server, "stream").then(([stream]) => stream);

  // Each step starts to wait for its last event before it acts: with a transport that delivers
  // in the same tick, the event can come before the call returns.
  try {
    const sessionOpened = new Promise(resolve => {
      server.once("session", session => {
        session.setTimeout(never);
        serverRefreshes = refreshCounter(session);
        serverSession = session;
        resolve();
      });
    });
    client = connect();
    client.setTimeout(never);
    clientRefreshes = refreshCounter(client);
    await Promise.all([once(client, "connect"), sessionOpened]);
    record("connect");

    // A request with a body, informational headers, a push, a response with a body and trailers.
    let pending = nextStream();
    const req = client.request({ ":method": "POST", ":path": "/" });
    const stream = await pending;
    record("request()");

    let arrived = once(stream, "data");
    await new Promise(resolve => req.write("ping", resolve));
    await arrived;
    record("write() on the client");

    arrived = once(req, "headers");
    stream.additionalHeaders({ ":status": 103 });
    await arrived;
    record("additionalHeaders()");

    // ORIGIN refreshes the receiver. ALTSVC refreshes it only while it listens for the event.
    // The informational headers that follow a frame tell when the client has read that frame.
    arrived = once(req, "headers");
    serverSession.origin("https://example.org");
    stream.additionalHeaders({ ":status": 103 });
    await arrived;
    record("origin() and additionalHeaders()");
    arrived = once(req, "headers");
    serverSession.altsvc('h2=":8000"', "https://example.org:8000");
    stream.additionalHeaders({ ":status": 103 });
    await arrived;
    record("altsvc() and additionalHeaders(), no 'altsvc' listener");
    arrived = once(client, "altsvc");
    serverSession.altsvc('h2=":8000"', "https://example.org:8000");
    await arrived;
    record("altsvc(), 'altsvc' listener");

    const pushReceived = new Promise(resolve => {
      client.once("stream", pushed => {
        pushed.once("push", resolve);
        pushed.resume();
      });
    });
    await new Promise((resolve, reject) => {
      stream.pushStream({ ":path": "/pushed" }, (err, pushed) => {
        if (err) return reject(err);
        pushed.respond({ ":status": 200 }, { endStream: true });
        resolve();
      });
    });
    await pushReceived;
    record("pushStream() and respond() on the pushed stream");

    arrived = once(req, "response");
    stream.respond({ ":status": 200 }, { waitForTrailers: true });
    await arrived;
    record("respond()");

    arrived = once(req, "data");
    await new Promise(resolve => stream.write("pong", resolve));
    await arrived;
    record("write() on the server");

    arrived = once(req, "trailers");
    stream.once("wantTrailers", () => stream.sendTrailers({ "x-trailer": "1" }));
    stream.end();
    await arrived;
    record("end() and sendTrailers()");

    arrived = once(stream, "end");
    stream.resume();
    req.end();
    await arrived;
    record("end() on the client");

    // A response that ends with data. The server has not read the request, and it responds one
    // turn of the event loop later.
    pending = nextStream();
    const unreadRequest = client.request({ ":path": "/" });
    arrived = once(unreadRequest, "end");
    unreadRequest.resume();
    const unread = await pending;
    await new Promise(resolve => setImmediate(resolve));
    unread.respond({ ":status": 200 });
    await new Promise(resolve => unread.end("pong", resolve));
    await arrived;
    record("end() with data, request not read");

    // The same, after the server has read the request to its end. Node.js has destroyed that
    // stream when the write completes, and a destroyed stream does not refresh the timer.
    pending = nextStream();
    const readRequest = client.request({ ":method": "POST", ":path": "/" });
    arrived = once(readRequest, "end");
    readRequest.resume();
    const sent = new Promise(resolve => readRequest.end("ping", resolve));
    const read = await pending;
    read.resume();
    await once(read, "end");
    await sent;
    read.respond({ ":status": 200 });
    await new Promise(resolve => read.end("pong", resolve));
    await arrived;
    record("end() with data, request read to its end");

    // The same for a request without a body, when a consumer is attached before the response.
    pending = new Promise(resolve => {
      server.once("stream", consumed => {
        consumed.resume();
        consumed.respond({ ":status": 200 });
        consumed.end("pong", resolve);
      });
    });
    const consumedRequest = client.request({ ":path": "/" });
    arrived = once(consumedRequest, "end");
    consumedRequest.resume();
    await pending;
    await arrived;
    record("resume(), respond() and end() with data in the 'stream' event");

    // END_STREAM on a DATA frame with no data ends the request, which the server does not read.
    // Node.js emits 'end' for it with no consumer, so that stream is destroyed too.
    pending = nextStream();
    const emptyRequest = client.request({ ":method": "POST", ":path": "/" });
    arrived = once(emptyRequest, "end");
    emptyRequest.resume();
    const emptied = await pending;
    let ended = once(emptied, "end");
    emptyRequest.end();
    await ended;
    emptied.respond({ ":status": 200 });
    await new Promise(resolve => emptied.end("pong", resolve));
    await arrived;
    record("end() with data, request ended by an empty DATA frame and not read");

    // The same on the client: the response ends that way and the client does not read it.
    pending = nextStream();
    const lateRequest = client.request({ ":method": "POST", ":path": "/" });
    ended = once(lateRequest, "end");
    const late = await pending;
    arrived = once(late, "end");
    late.resume();
    late.respond({ ":status": 200 });
    late.end();
    await ended;
    await new Promise(resolve => lateRequest.end("ping", resolve));
    await arrived;
    record("end() with data on the client, response ended by an empty DATA frame and not read");

    // File responses. The call refreshes, also when the file is not sent.
    for (const method of ["respondWithFD", "respondWithFile"]) {
      pending = nextStream();
      const fileRequest = client.request({ ":path": "/file" });
      arrived = once(fileRequest, "end");
      fileRequest.resume();
      const fileStream = await pending;
      fileStream[method](method === "respondWithFD" ? fd : __filename, {}, { length: 100 });
      await arrived;
      record(`${method}()`);
    }
    pending = nextStream();
    const uncheckedRequest = client.request({ ":path": "/file" });
    arrived = once(uncheckedRequest, "response");
    const unchecked = await pending;
    unchecked.respondWithFD(
      fd,
      {},
      {
        statCheck() {
          unchecked.respond({ ":status": 304 }, { endStream: true });
          return false;
        },
      },
    );
    await arrived;
    record("respondWithFD(), statCheck responds and returns false");
    pending = nextStream();
    const missingRequest = client.request({ ":path": "/file" });
    arrived = once(missingRequest, "response");
    const missing = await pending;
    missing.respondWithFile(
      `${__filename}.missing`,
      {},
      { onError: () => missing.respond({ ":status": 404 }, { endStream: true }) },
    );
    await arrived;
    record("respondWithFile() of a missing file, onError responds");

    // A write that waits for flow-control window, on a stream that the server then resets. The
    // write is dropped, not completed.
    ended = once(client, "localSettings");
    client.settings({ initialWindowSize: 0 });
    await ended;
    pending = nextStream();
    const blockedRequest = client.request({ ":path": "/" });
    blockedRequest.on("error", () => {});
    arrived = once(blockedRequest, "response");
    const blocked = await pending;
    blocked.on("error", () => {});
    blocked.respond({ ":status": 200 });
    blocked.write("pong");
    await arrived;
    arrived = once(blockedRequest, "close");
    blocked.close(http2.constants.NGHTTP2_CANCEL);
    await arrived;
    ended = once(client, "localSettings");
    client.settings({ initialWindowSize: 65535 });
    await ended;
    record("close() with a code, on a stream with a write that waits for window");

    // SETTINGS and PING refresh the receiver only while it listens for the event.
    for (const [sender, from, to] of [
      ["server", serverSession, client],
      ["client", client, serverSession],
    ]) {
      const settingsAcked = () => {
        const acked = once(from, "localSettings");
        from.settings({ maxConcurrentStreams: 50 });
        return acked;
      };
      const pingAcked = () => new Promise(resolve => from.ping(resolve));
      await settingsAcked();
      record(`settings() on the ${sender}, no 'remoteSettings' listener`);
      to.on("remoteSettings", () => {});
      await settingsAcked();
      record(`settings() on the ${sender}, 'remoteSettings' listener`);
      await pingAcked();
      record(`ping() on the ${sender}, no 'ping' listener`);
      to.on("ping", () => {});
      await pingAcked();
      record(`ping() on the ${sender}, 'ping' listener`);
    }

    // close() sends a GOAWAY. The server answers that frame with its own close().
    arrived = once(serverSession, "goaway");
    client.close();
    await arrived;
    record("close()");
    return seen;
  } finally {
    fs.closeSync(fd);
    client?.destroy();
    serverSession?.destroy();
  }
}

module.exports = { countTimerRefreshes };

if (require.main === module) {
  const server = http2.createServer();
  server.listen(0, "127.0.0.1", async () => {
    try {
      const connect = () => http2.connect(`http://127.0.0.1:${server.address().port}`);
      console.log(JSON.stringify(await countTimerRefreshes(server, connect)));
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });
}
