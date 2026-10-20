/**
 * A ClientHttp2Session queues a request that it cannot submit yet: one made before the session
 * connects, or while the peer's SETTINGS_MAX_CONCURRENT_STREAMS leaves no stream slot. The session
 * submits it later: when it connects, when another request's stream closes, or when a SETTINGS
 * frame raises the limit. What the submission starts runs in the async context of the request()
 * caller, not of whatever drained the queue.
 *
 * node gives the same stores. Before the connect it binds the submission to the request's async
 * resource: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L1912-L1926
 * At the stream limit it submits inside request(), and nghttp2 holds the HEADERS frame.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-pending-request-async-context.test.ts
 *   node --test test/js/node/http2/node-http2-pending-request-async-context.test.ts
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import dc from "node:diagnostics_channel";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { duplexPair } from "node:stream";
import { describe, test } from "node:test";

// setNextStreamID() is not in @types/node.
type Client = http2.ClientHttp2Session & { setNextStreamID(id: number): void };
type Stores = Record<string, string>;
type OnStream = (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void;

const als = new AsyncLocalStorage<string>();
const store = () => als.getStore() ?? "no store";
const users = ["alice", "bob", "carol"];

function respondAfterEnd(stream: http2.ServerHttp2Stream) {
  stream.resume();
  stream.on("end", () => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
}
async function listen(settings?: http2.Settings, onStream: OnStream = respondAfterEnd) {
  const server = http2.createServer({ settings });
  server.on("stream", onStream);
  await once(server.listen(0, "127.0.0.1"), "listening");
  return server;
}
// The connect and the SETTINGS frames of the session run in the "session" store.
function connect(server: http2.Http2Server, onConnect?: () => void) {
  const { port } = server.address() as AddressInfo;
  return als.run("session", () => http2.connect(`http://127.0.0.1:${port}`, {}, onConnect)) as Client;
}

// Records the store that the start and body channels publish in, for requests with an x-user header.
function subscribe(seen: Record<string, Stores>) {
  const unsubscribes = ["start", "bodyChunkSent", "bodySent"].map(name => {
    const onMessage = (message: unknown) => {
      const { stream } = message as { stream: http2.ClientHttp2Stream };
      const stores = seen[stream.sentHeaders["x-user"] as string];
      if (stores) stores[name] = store();
    };
    dc.subscribe(`http2.client.stream.${name}`, onMessage);
    return () => dc.unsubscribe(`http2.client.stream.${name}`, onMessage);
  });
  return () => unsubscribes.forEach(unsubscribe => unsubscribe());
}
// Uploads a body and records the store that each callback and event of the request runs in.
function upload(client: Client, user: string, stores: Stores) {
  const req = client.request({ ":method": "POST", ":path": "/", "x-user": user });
  // On a connected session node emits 'ready' inside request(), before a listener can be added.
  if (client.connecting) req.on("ready", () => (stores.ready = store()));
  req.write("chunk", () => (stores["write()"] = store()));
  req.end(() => (stores["end()"] = store()));
  for (const event of ["finish", "response", "data", "end", "close"]) req.on(event, () => (stores[event] = store()));
  return once(req, "close");
}
const recorded = [
  "start",
  "bodyChunkSent",
  "write()",
  "bodySent",
  "end()",
  "finish",
  "response",
  "data",
  "end",
  "close",
];
const all = (value: string): Stores => Object.fromEntries(recorded.map(key => [key, value]));

// Records the events that end a request, with the store of each.
function watchFailure(req: http2.ClientHttp2Stream) {
  const failure = { code: undefined as string | undefined, events: [] as [string, string][] };
  const { promise, resolve } = Promise.withResolvers<typeof failure>();
  req.on("aborted", () => failure.events.push(["aborted", store()]));
  req.on("error", (err: NodeJS.ErrnoException) => {
    failure.code = err.code;
    failure.events.push(["error", store()]);
  });
  req.on("close", () => {
    failure.events.push(["close", store()]);
    resolve(failure);
  });
  return promise;
}
const inStore = (value: string, ...events: string[]) => events.map(event => [event, value]);

describe("a request that waited for a stream slot or for the connect", () => {
  test("uploads in the store of its request() caller after another request freed the slot", async () => {
    const seen: Record<string, Stores> = { alice: {}, bob: {}, carol: {} };
    const unsubscribe = subscribe(seen);
    const server = await listen({ maxConcurrentStreams: 1 });
    const client = connect(server);
    try {
      await once(client, "remoteSettings");
      await Promise.all(users.map(user => als.run(user, () => upload(client, user, seen[user]))));
      assert.deepStrictEqual(seen, { alice: all("alice"), bob: all("bob"), carol: all("carol") });
    } finally {
      unsubscribe();
      client.close();
      server.close();
    }
  });

  test("uploads in the store of its request() caller after the peer raised its stream limit", async () => {
    const seen: Record<string, Stores> = { alice: {}, bob: {}, carol: {} };
    const unsubscribe = subscribe(seen);
    // alice's response waits for all three request bodies, so only the new SETTINGS frame can
    // submit the requests of bob and carol.
    let ended = 0;
    let answerAlice = () => {};
    const server = await listen({ maxConcurrentStreams: 1 }, (stream, headers) => {
      stream.resume();
      stream.on("end", () => {
        const answer = () => {
          stream.respond({ ":status": 200 });
          stream.end("ok");
        };
        if (headers["x-user"] === "alice") answerAlice = answer;
        else answer();
        if (++ended === 3) answerAlice();
      });
    });
    const serverSession = once(server, "session");
    const client = connect(server);
    try {
      await once(client, "remoteSettings");
      const uploads = users.map(user => als.run(user, () => upload(client, user, seen[user])));
      const [session] = (await serverSession) as [http2.ServerHttp2Session];
      session.settings({ maxConcurrentStreams: 3 });
      await Promise.all(uploads);
      assert.deepStrictEqual(seen, { alice: all("alice"), bob: all("bob"), carol: all("carol") });
    } finally {
      unsubscribe();
      client.close();
      server.close();
    }
  });

  test("uploads in the store of its request() caller after the session connected", async () => {
    const seen: Record<string, Stores> = { alice: {}, bob: {}, nobody: {}, session: {} };
    const unsubscribe = subscribe(seen);
    const server = await listen();
    const client = connect(server, () => (seen.session.listener = store()));
    try {
      const uploads = [
        als.run("alice", () => upload(client, "alice", seen.alice)),
        als.run("bob", () => upload(client, "bob", seen.bob)),
        upload(client, "nobody", seen.nobody),
      ];
      client.once("connect", () => (seen.session.connect = store()));
      await Promise.all(uploads);
      assert.deepStrictEqual(seen, {
        alice: { ready: "alice", ...all("alice") },
        bob: { ready: "bob", ...all("bob") },
        nobody: { ready: "no store", ...all("no store") },
        // The session's own listeners keep the session's store.
        session: { listener: "session", connect: "session" },
      });
    } finally {
      unsubscribe();
      client.close();
      server.close();
    }
  });

  test("ends in the store of its request() caller when end() is called from the write() callback", async () => {
    const server = await listen();
    const client = connect(server);
    try {
      const stores: Stores = {};
      await als.run("alice", () => {
        const req = client.request({ ":method": "POST", ":path": "/" });
        req.write("chunk", () => {
          stores["write()"] = store();
          req.end(() => (stores["end()"] = store()));
        });
        req.resume();
        return once(req, "close");
      });
      assert.deepStrictEqual(stores, { "write()": "alice", "end()": "alice" });
    } finally {
      client.close();
      server.close();
    }
  });

  test("sends the header values that its request() caller's store gives", async () => {
    const received: Record<string, unknown> = {};
    const server = await listen({ maxConcurrentStreams: 1 }, (stream, headers) => {
      received[headers[":path"]!] = headers["x-user"];
      respondAfterEnd(stream);
    });
    const client = connect(server);
    try {
      await once(client, "remoteSettings");
      // A header value that is not a string is converted with String().
      const currentUser = { toString: store } as unknown as string;
      await Promise.all(
        users.map(user =>
          als.run(user, () => {
            const req = client.request({ ":path": `/${user}`, "x-user": currentUser });
            req.resume();
            return once(req, "close");
          }),
        ),
      );
      assert.deepStrictEqual(received, { "/alice": "alice", "/bob": "bob", "/carol": "carol" });
    } finally {
      client.close();
      server.close();
    }
  });

  test("leaves the events of the request that freed the slot in the store of that request", async () => {
    const seen: Record<string, Stores> = { bob: {} };
    const unsubscribe = subscribe(seen);
    // The peer resets alice's stream. That frees the slot for bob.
    const server = await listen({ maxConcurrentStreams: 1 }, (stream, headers) => {
      stream.on("error", () => {});
      if (headers["x-user"] === "alice") stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
      else respondAfterEnd(stream);
    });
    const client = connect(server);
    try {
      await once(client, "remoteSettings");
      const alice = als.run("alice", () => client.request({ ":method": "POST", ":path": "/", "x-user": "alice" }));
      const [reset] = await Promise.all([watchFailure(alice), als.run("bob", () => upload(client, "bob", seen.bob))]);
      assert.deepStrictEqual(reset, {
        code: "ERR_HTTP2_STREAM_ERROR",
        events: inStore("alice", "aborted", "error", "close"),
      });
      assert.deepStrictEqual(seen, { bob: all("bob") });
    } finally {
      unsubscribe();
      client.close();
      server.close();
    }
  });
});

// Over a JS transport the session completes a write on an immediate of its own. The callbacks of
// the write still run in the store of the writer.
describe("a request over a Duplex transport", () => {
  test("uploads in the store of its request() caller", async () => {
    const seen: Record<string, Stores> = { alice: {}, bob: {}, carol: {} };
    const unsubscribe = subscribe(seen);
    const server = http2.createServer();
    server.on("stream", respondAfterEnd);
    const [clientSide, serverSide] = duplexPair();
    server.emit("connection", serverSide);
    const client = als.run("session", () => http2.connect("http://localhost", { createConnection: () => clientSide }));
    try {
      await once(client, "remoteSettings");
      await Promise.all(users.map(user => als.run(user, () => upload(client as Client, user, seen[user]))));
      assert.deepStrictEqual(seen, { alice: all("alice"), bob: all("bob"), carol: all("carol") });
    } finally {
      unsubscribe();
      client.close();
      server.close();
    }
  });
});

describe("a request that the session cannot submit after the wait", () => {
  // alice holds the only stream slot. bob's request fails when the session tries to submit it.
  async function failAfterSlotWait(prepare: (client: Client) => void, headers: http2.OutgoingHttpHeaders) {
    const server = await listen({ maxConcurrentStreams: 1 });
    const client = connect(server);
    try {
      await once(client, "remoteSettings");
      prepare(client);
      const alice = als.run("alice", () => client.request({ ":method": "POST", ":path": "/" }));
      // This listener runs after the one of the session, which submits bob's request.
      let holder: string | undefined;
      alice.on("close", () => (holder = store()));
      const failed = als.run("bob", () => watchFailure(client.request(headers)));
      alice.resume();
      alice.end("chunk");
      const [failure] = await Promise.all([failed, once(alice, "close")]);
      return { ...failure, holder };
    } finally {
      client.close();
      server.close();
    }
  }

  test("fails in the store of its request() caller when no stream id is left", async () => {
    // alice takes the last stream id.
    const failure = await failAfterSlotWait(client => client.setNextStreamID(2 ** 31 - 1), { ":path": "/" });
    assert.deepStrictEqual(failure, {
      code: "ERR_HTTP2_OUT_OF_STREAMS",
      events: inStore("bob", "error", "close"),
      holder: "alice",
    });
  });

  test("fails in the store of its request() caller when a header value cannot be sent", async () => {
    const { code, ...failure } = await failAfterSlotWait(() => {}, { ":path": "/", "x-bad": "a\0b" });
    // The code is not compared: node reports a stream error from nghttp2, Bun the header value.
    assert.deepStrictEqual(failure, { events: inStore("bob", "error", "close"), holder: "alice" });
  });

  test("fails in the store of its request() caller when close() rejects it before the connect", async () => {
    const server = await listen();
    const client = connect(server);
    try {
      const request = () => client.request({ ":method": "POST", ":path": "/" });
      const failed = [als.run("bob", () => watchFailure(request())), watchFailure(request())];
      als.run("closer", () => client.close());
      assert.deepStrictEqual(await Promise.all(failed), [
        { code: "ERR_HTTP2_GOAWAY_SESSION", events: inStore("bob", "aborted", "error", "close") },
        { code: "ERR_HTTP2_GOAWAY_SESSION", events: inStore("no store", "aborted", "error", "close") },
      ]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  // destroy() cancels a queued request from its own call, as it does for the open streams of the
  // session, so this one is not the request() caller's store.
  test("fails in the store of the destroy() caller when destroy() cancels it before the connect", async () => {
    const server = await listen();
    const client = connect(server);
    try {
      const failed = als.run("bob", () => watchFailure(client.request({ ":method": "POST", ":path": "/" })));
      als.run("destroyer", () => client.destroy());
      assert.deepStrictEqual(await failed, {
        code: "ERR_HTTP2_STREAM_CANCEL",
        events: inStore("destroyer", "aborted", "error", "close"),
      });
    } finally {
      client.destroy();
      server.close();
    }
  });
});

if (typeof Bun !== "undefined") {
  // A Bun.ModuleGraph has an async context of its own, and dispose() drops what was armed in it.
  // The session here is the host's, and the peer allows one stream.
  describe("a request that waited, made by a Bun.ModuleGraph on a session of the host", () => {
    // The peer answers /held when the test says so, and it never answers /never: only an
    // RST_STREAM from the client ends that stream.
    function peer() {
      const held = Promise.withResolvers<() => void>();
      const onStream: OnStream = (stream, headers) => {
        stream.on("error", () => {});
        stream.resume();
        if (headers[":path"] === "/never") return;
        stream.on("end", () => {
          const answer = () => {
            stream.respond({ ":status": 200 });
            stream.end("ok");
          };
          if (headers[":path"] === "/held") held.resolve(answer);
          else answer();
        });
      };
      return { onStream, held: held.promise };
    }
    // A request that waits, and that its graph closes: the RST_STREAM is parked until it has an id.
    function closeWhileItWaits(client: Client, graph: Bun.ModuleGraph) {
      graph.run(() => {
        const req = client.request({ ":method": "POST", ":path": "/never" });
        req.on("error", () => {});
        req.resume();
        req.close();
      });
    }
    async function hostGetsTheSlot(client: Client) {
      const req = client.request({ ":path": "/" });
      req.resume();
      const [headers] = await once(req, "response");
      assert.strictEqual(headers[":status"], 200);
    }

    for (const [disposed, { waits, holds }] of Object.entries({
      "the graph that waits": { waits: "during the wait", holds: false },
      "the graph that holds the slot": { waits: "", holds: true },
      "both graphs": { waits: "during the wait", holds: true },
      "the graph that waits, right after the session submitted its request": { waits: "after it", holds: false },
    })) {
      test(`frees its slot with the RST_STREAM of its close() when dispose() stops ${disposed}`, async () => {
        const { onStream, held } = peer();
        const server = await listen({ maxConcurrentStreams: 1 }, onStream);
        const client = connect(server);
        const holder = new Bun.ModuleGraph();
        const waiter = new Bun.ModuleGraph();
        try {
          await once(client, "remoteSettings");
          const first = holder.run(() => client.request({ ":method": "POST", ":path": "/held" }).end("chunk"));
          first.on("error", () => {});
          first.resume();
          closeWhileItWaits(client, waiter);
          const host = hostGetsTheSlot(client);
          const release = await held;
          // This listener runs after the one of the session, which submits the queue.
          if (waits === "after it") first.on("close", () => waiter.dispose());
          if (waits === "during the wait") waiter.dispose();
          if (holds) holder.dispose();
          release();
          await host;
        } finally {
          holder.dispose();
          waiter.dispose();
          client.destroy();
          server.close();
        }
      });
    }

    test("frees its slot with the RST_STREAM of its close() when dispose() stops its graph before the connect", async () => {
      const server = await listen({ maxConcurrentStreams: 1 }, peer().onStream);
      const client = connect(server);
      const waiter = new Bun.ModuleGraph();
      try {
        closeWhileItWaits(client, waiter);
        waiter.dispose();
        await once(client, "remoteSettings");
        await hostGetsTheSlot(client);
      } finally {
        waiter.dispose();
        client.destroy();
        server.close();
      }
    });

    // Over a JS transport a write completes on an immediate. The session arms it, so dispose() of
    // the writer's graph does not drop it.
    describe("over a Duplex transport", () => {
      function connectOverDuplex(onStream: OnStream) {
        const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
        server.on("stream", onStream);
        const [clientSide, serverSide] = duplexPair();
        server.emit("connection", serverSide);
        return { server, client: http2.connect("http://localhost", { createConnection: () => clientSide }) as Client };
      }
      // An upload whose end() waits for the callback of its first write.
      function upload(client: Client, graph: Bun.ModuleGraph) {
        return graph.run(() => {
          const req = client.request({ ":method": "POST", ":path": "/" });
          req.on("error", () => {});
          req.resume();
          req.write("chunk", () => req.end("chunk"));
          return req;
        });
      }

      for (const when of ["while its request waits", "in the middle of the upload"]) {
        test(`finishes its upload when dispose() stops its graph ${when}`, async () => {
          const { onStream, held } = peer();
          const { server, client } = connectOverDuplex(onStream);
          const graph = new Bun.ModuleGraph();
          try {
            await once(client, "remoteSettings");
            client.request({ ":method": "POST", ":path": "/held" }).end("chunk").resume();
            const req = upload(client, graph);
            const host = hostGetsTheSlot(client);
            const release = await held;
            // The first write is parked on 'ready' by now, so this listener runs after it.
            if (when === "in the middle of the upload") req.once("ready", () => graph.dispose());
            else graph.dispose();
            release();
            await host;
          } finally {
            graph.dispose();
            client.destroy();
            server.close();
          }
        });
      }

      test("finishes an upload that did not wait when dispose() stops its graph", async () => {
        const { server, client } = connectOverDuplex(peer().onStream);
        const graph = new Bun.ModuleGraph();
        try {
          await once(client, "remoteSettings");
          upload(client, graph);
          graph.dispose();
          await hostGetsTheSlot(client);
        } finally {
          graph.dispose();
          client.destroy();
          server.close();
        }
      });
    });

    for (const stopped of [false, true]) {
      const name = stopped
        ? "fails into the onError of its graph after dispose() stopped that graph"
        : "fails into the onError of its own graph";
      test(`${name}, not of the graph that held the slot`, async () => {
        const failed = Promise.withResolvers<[string, string | undefined]>();
        const onError = (graph: string) => (error: unknown) =>
          failed.resolve([graph, (error as NodeJS.ErrnoException).code]);
        const holder = new Bun.ModuleGraph({ onError: onError("holder") });
        const waiter = new Bun.ModuleGraph({ onError: onError("waiter") });
        const server = await listen({ maxConcurrentStreams: 1 });
        const client = connect(server);
        try {
          await once(client, "remoteSettings");
          // The holder's request takes the last stream id, so the session cannot submit the next one.
          client.setNextStreamID(2 ** 31 - 1);
          const first = holder.run(() => client.request({ ":method": "POST", ":path": "/" }));
          first.resume();
          // No 'error' listener: the failure is an uncaught exception of the graph it is raised in.
          waiter.run(() => client.request({ ":path": "/" }));
          if (stopped) waiter.dispose();
          first.end("chunk");
          assert.deepStrictEqual(await failed.promise, ["waiter", "ERR_HTTP2_OUT_OF_STREAMS"]);
        } finally {
          holder.dispose();
          waiter.dispose();
          client.destroy();
          server.close();
        }
      });
    }

    test("uploads in the store of its request() caller when the callers share one graph", async () => {
      const seen: Record<string, Stores> = { alice: {}, bob: {}, carol: {} };
      const unsubscribe = subscribe(seen);
      const graph = new Bun.ModuleGraph();
      const server = await listen({ maxConcurrentStreams: 1 });
      const client = connect(server);
      try {
        await once(client, "remoteSettings");
        await Promise.all(users.map(user => graph.run(() => als.run(user, () => upload(client, user, seen[user])))));
        assert.deepStrictEqual(seen, { alice: all("alice"), bob: all("bob"), carol: all("carol") });
      } finally {
        unsubscribe();
        graph.dispose();
        client.destroy();
        server.close();
      }
    });
  });

  // The stores above are node v26's, and the macOS CI hosts can have an older node. Alpine's node
  // crashes at random (see node-http2-client-close.test.ts), and CI fails a file for any core dump.
  const node = Bun.which("node");
  const nodeMajor = node
    ? parseInt(Bun.spawnSync({ cmd: [node, "-p", "process.versions.node"] }).stdout.toString(), 10)
    : 0;
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  describe("Node.js compatibility", () => {
    test("tests should run on node.js", { skip: !(nodeMajor >= 26) || isMusl }, async () => {
      await using proc = Bun.spawn({
        cmd: [node as string, "--test", import.meta.filename],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      assert.strictEqual(await proc.exited, 0);
    });
  });
}
