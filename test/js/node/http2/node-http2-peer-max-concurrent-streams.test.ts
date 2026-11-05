/**
 * A client session does not know the peer's SETTINGS_MAX_CONCURRENT_STREAMS until the peer's
 * first SETTINGS frame arrives. nghttp2 (node) starts every session with a limit of 100, or the
 * `peerMaxConcurrentStreams` session option, and queues the requests over it. Requests made
 * before the session connects are submitted in that window, so the limit must already hold.
 */
import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

type Server = ReturnType<typeof http2.createServer>;

function listen(server: Server | net.Server): Promise<number> {
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

/**
 * Server that advertises `limit` and answers its streams in batches: it holds every stream until
 * `limit` of them are open, then answers them all. The first batch waits for `onFirstBatch` too,
 * so the test can look at the client while the server holds `limit` streams. A client that
 * ignores the limit sends every request at once and the server refuses the excess with
 * RST_STREAM(REFUSED_STREAM).
 */
function batchServer(limit: number, total: number, onFirstBatch: () => Promise<void>) {
  const server = http2.createServer({ settings: { maxConcurrentStreams: limit } });
  let held: http2.ServerHttp2Stream[] = [];
  let answered = 0;
  server.on("stream", stream => {
    held.push(stream);
    const batch = Math.min(limit, total - answered);
    if (held.length < batch) return;
    const ready = held;
    held = [];
    answered += ready.length;
    const answer = () => {
      for (const s of ready) s.respond({ ":status": 200 }, { endStream: true });
    };
    if (answered === ready.length) onFirstBatch().then(answer);
    else answer();
  });
  return server;
}

async function requestAll(client: http2.ClientHttp2Session, total: number) {
  const reqs: http2.ClientHttp2Stream[] = [];
  const results: Promise<number>[] = [];
  for (let i = 0; i < total; i++) {
    const req = client.request({ ":method": "POST", ":path": `/${i}` });
    reqs.push(req);
    const result = new Promise<number>((resolve, reject) => {
      let status = 0;
      req.on("response", headers => (status = headers[":status"] as number));
      req.on("end", () => resolve(status));
      req.on("error", reject);
      req.resume();
      req.end("{}");
    });
    // An assertion before `await Promise.all(results)` leaves these rejections unobserved.
    result.catch(() => {});
    results.push(result);
  }
  return { reqs, results };
}

test("requests made before connect wait for a slot when the server advertises fewer than 100 streams", async () => {
  const LIMIT = 100;
  const TOTAL = 130;
  const firstBatch = Promise.withResolvers<void>();
  const inspected = Promise.withResolvers<void>();
  const server = batchServer(LIMIT, TOTAL, () => {
    firstBatch.resolve();
    return inspected.promise;
  });
  const port = await listen(server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  try {
    const { reqs, results } = await requestAll(client, TOTAL);
    await firstBatch.promise;
    // The server has LIMIT streams open and has answered none. The rest wait in the client.
    expect(reqs.filter(req => req.pending).length).toBe(TOTAL - LIMIT);
    inspected.resolve();
    expect(await Promise.all(results)).toEqual(Array(TOTAL).fill(200));
  } finally {
    client.destroy();
    server.close();
  }
});

test("peerMaxConcurrentStreams caps the requests sent before the peer's SETTINGS arrive", async () => {
  const LIMIT = 3;
  const TOTAL = 8;
  const firstBatch = Promise.withResolvers<void>();
  const inspected = Promise.withResolvers<void>();
  const server = batchServer(LIMIT, TOTAL, () => {
    firstBatch.resolve();
    return inspected.promise;
  });
  const port = await listen(server);
  const client = http2.connect(`http://127.0.0.1:${port}`, { peerMaxConcurrentStreams: LIMIT });
  try {
    const { reqs, results } = await requestAll(client, TOTAL);
    await firstBatch.promise;
    expect(reqs.filter(req => req.pending).length).toBe(TOTAL - LIMIT);
    inspected.resolve();
    expect(await Promise.all(results)).toEqual(Array(TOTAL).fill(200));
  } finally {
    client.destroy();
    server.close();
  }
});

test("the peer's first SETTINGS frame releases the requests queued behind the 100-stream seed", async () => {
  // A server with default settings advertises no maxConcurrentStreams, so its SETTINGS lifts the
  // seed to unlimited. The server holds every stream until all of them arrived: only the
  // 'remoteSettings' dispatch can submit the requests over 100, a freed slot never does.
  const TOTAL = 150;
  const server = http2.createServer();
  const held: http2.ServerHttp2Stream[] = [];
  const allArrived = Promise.withResolvers<void>();
  server.on("stream", stream => {
    held.push(stream);
    if (held.length === TOTAL) allArrived.resolve();
  });
  const port = await listen(server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  try {
    const { reqs, results } = await requestAll(client, TOTAL);
    await allArrived.promise;
    expect(reqs.filter(req => req.pending).length).toBe(0);
    expect(client.remoteSettings.maxConcurrentStreams).toBe(4294967295);
    for (const stream of held) stream.respond({ ":status": 200 }, { endStream: true });
    expect(await Promise.all(results)).toEqual(Array(TOTAL).fill(200));
  } finally {
    client.destroy();
    server.close();
  }
});

test("a slot is freed when the stream closes on the wire, not when the response body is read", async () => {
  // nghttp2 counts a stream until both sides sent END_STREAM. A response body that nothing reads
  // keeps the Duplex open, but the peer already freed the slot, so the next request can go out.
  const LIMIT = 100;
  const TOTAL = 130;
  const server = http2.createServer({ settings: { maxConcurrentStreams: LIMIT } });
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("x");
  });
  const port = await listen(server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  try {
    const responses: Promise<number>[] = [];
    for (let i = 0; i < TOTAL; i++) {
      const req = client.request({ ":path": `/${i}` });
      responses.push(
        new Promise((resolve, reject) => {
          req.on("response", headers => resolve(headers[":status"] as number));
          req.on("error", reject);
          req.end();
        }),
      );
    }
    expect(await Promise.all(responses)).toEqual(Array(TOTAL).fill(200));
  } finally {
    client.destroy();
    server.close();
  }
});

// The peer counts a stream until it sees the RST_STREAM. A request that waited for that slot must
// send its HEADERS after the reset, or a server at its limit refuses it.
for (const [how, cancel] of [
  ["close(NGHTTP2_CANCEL)", (req: http2.ClientHttp2Stream) => req.close(http2.constants.NGHTTP2_CANCEL)],
  ["an AbortSignal", (req: http2.ClientHttp2Stream, controller: AbortController) => controller.abort()],
] as const) {
  test(`a request queued behind a slot goes out after the RST_STREAM of ${how}`, async () => {
    const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
    const streams: http2.ServerHttp2Stream[] = [];
    const secondArrived = Promise.withResolvers<void>();
    server.on("stream", stream => {
      streams.push(stream);
      if (streams.length === 2) secondArrived.resolve();
    });
    const port = await listen(server);
    const client = http2.connect(`http://127.0.0.1:${port}`);
    try {
      await once(client, "remoteSettings");
      const controller = new AbortController();
      const first = client.request({ ":path": "/1" }, { signal: controller.signal });
      first.on("error", () => {});
      first.end();
      const second = client.request({ ":path": "/2" });
      const answered = new Promise<number>((resolve, reject) => {
        second.on("response", headers => resolve(headers[":status"] as number));
        second.on("error", reject);
        second.resume();
        second.end();
      });
      expect(second.pending).toBe(true);
      await once(first, "ready");
      cancel(first, controller);
      await secondArrived.promise;
      streams[1].respond({ ":status": 200 }, { endStream: true });
      expect(await answered).toBe(200);
    } finally {
      client.destroy();
      server.close();
    }
  });
}

test("an abort shared by an active and a queued request cancels both and keeps the session", async () => {
  // The signal's native listener frees the active request's slot before its JS listener runs
  // for the queued one. The queued request must not go out as a reset of a stream the peer
  // never saw (a connection error for a conforming server).
  const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
  const streams: http2.ServerHttp2Stream[] = [];
  server.on("stream", stream => {
    streams.push(stream);
    if (streams.length === 2) stream.respond({ ":status": 200 }, { endStream: true });
  });
  const port = await listen(server);
  const client = http2.connect(`http://127.0.0.1:${port}`);
  const sessionError = Promise.withResolvers<never>();
  client.on("error", sessionError.reject);
  try {
    await once(client, "remoteSettings");
    const controller = new AbortController();
    const first = client.request({ ":path": "/1" }, { signal: controller.signal });
    const firstError = once(first, "error").then(([e]) => e.name);
    first.end();
    const second = client.request({ ":path": "/2" }, { signal: controller.signal });
    const secondError = once(second, "error").then(([e]) => e.name);
    second.end();
    expect(second.pending).toBe(true);
    await once(first, "ready");
    controller.abort();
    expect(await Promise.all([firstError, secondError])).toEqual(["AbortError", "AbortError"]);
    const third = client.request({ ":path": "/3" });
    const answered = new Promise<number>((resolve, reject) => {
      third.on("response", headers => resolve(headers[":status"] as number));
      third.on("error", reject);
      third.resume();
      third.end();
    });
    expect(await Promise.race([answered, sessionError.promise])).toBe(200);
    expect(streams.length).toBe(2);
  } finally {
    client.destroy();
    server.close();
  }
});

test("remoteSettings reports the pre-SETTINGS limit like node", async () => {
  // A raw peer that never sends SETTINGS, so the session stays in the pre-SETTINGS window.
  const server = net.createServer(socket => socket.on("data", () => {}));
  const port = await listen(server);
  try {
    for (const [options, expected] of [
      [undefined, 100],
      [{ peerMaxConcurrentStreams: 7 }, 7],
      [{ peerMaxConcurrentStreams: 1.5 }, 1],
      [{ peerMaxConcurrentStreams: "7" }, 100],
    ] as const) {
      const client = http2.connect(`http://127.0.0.1:${port}`, options as http2.ClientSessionOptions);
      client.on("error", () => {});
      try {
        await once(client, "connect");
        expect(client.remoteSettings.maxConcurrentStreams).toBe(expected);
      } finally {
        client.destroy();
      }
    }
  } finally {
    server.close();
  }
});

test("a server session reports the pre-SETTINGS limit like node", async () => {
  // 'session' fires before the client's preface is parsed, so its SETTINGS are not known yet.
  for (const [options, expected] of [
    [undefined, 100],
    [{ peerMaxConcurrentStreams: 7 }, 7],
  ] as const) {
    const server = http2.createServer(options as http2.ServerOptions);
    const seen = Promise.withResolvers<number>();
    server.on("session", session => seen.resolve(session.remoteSettings.maxConcurrentStreams));
    const port = await listen(server);
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    try {
      expect(await seen.promise).toBe(expected);
    } finally {
      socket.destroy();
      server.close();
    }
  }
});
