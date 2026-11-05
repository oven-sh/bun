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
      req.on("response", headers => resolve(headers[":status"] as number));
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
      await once(client, "connect");
      expect(client.remoteSettings.maxConcurrentStreams).toBe(expected);
      client.destroy();
    }
  } finally {
    server.close();
  }
});
