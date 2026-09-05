import * as jsc from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { connect } from "node:net";
import { join } from "node:path";

// The teardown condition, with no timers and no GC: server.stop() resolves
// only once pendingRequests reaches 0 and every connection is gone. On an
// unfixed build a parked context pins the count, so this await never settles
// and the test times out.
async function stopAndAssertDrained(server: ReturnType<typeof Bun.serve>) {
  await server.stop();
  expect(server.pendingRequests).toBe(0);
}

test.each([false, true])(
  "RequestContext is freed when client aborts before Promise<Response> settles (http2: %p)",
  async http2 => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "serve-pending-promise-abort-leak-fixture.ts"),
        ...(http2 ? ["--http2"] : []),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.pending).toBe(0);
    expect(result.abortCount).toBe(result.iterations);
    expect(exitCode).toBe(0);
  },
);

test("Promise<Response> still works normally when not aborted", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise<Response>(resolve => {
        queueMicrotask(() => resolve(new Response("hello")));
      });
    },
  });

  const res = await fetch(server.url);
  expect(await res.text()).toBe("hello");
  expect(res.status).toBe(200);
  expect(server.pendingRequests).toBe(0);
});

test("resolve() inside abort handler is handled safely", async () => {
  let aborted = false;
  const { promise: handlerEntered, resolve: signalHandler } = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      signalHandler();
      return new Promise<Response>(resolve => {
        req.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            // Resolving after abort is safe but the response is dropped
            // since the client is already gone.
            resolve(new Response("too late"));
          },
          { once: true },
        );
      });
    },
  });

  const ac = new AbortController();
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await handlerEntered;
  ac.abort();
  await p;
  await stopAndAssertDrained(server);

  expect(aborted).toBe(true);
});

test("streaming 413 detaches the response so a late resolve/reject is a no-op", async () => {
  // Run in a subprocess: without the fix this is a heap-use-after-free under
  // ASAN (render() corks a uWS socket that was freed when the 413 closed the
  // connection — markDone() cleared onAborted so no abort ever detached
  // ctx.resp).
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-413-streaming-late-resolve-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const lines = stdout
    .trim()
    .split("\n")
    .map(l => JSON.parse(l));
  expect(lines).toEqual([
    {
      case: "resolve",
      status: "HTTP/1.1 413 Payload Too Large",
      bodyErr: "Request body exceeded maxRequestBodySize",
      pendingAfterResolve: 0,
      followUp: { status: 200, text: "follow-up" },
    },
    {
      case: "reject",
      status: "HTTP/1.1 413 Payload Too Large",
      pendingAfterReject: 0,
    },
  ]);
  expect(exitCode).toBe(0);
}, 30_000);

test("chunked request body consumed as a ReadableStream is capped at maxRequestBodySize", async () => {
  // The up-front maxRequestBodySize check only sees Content-Length, and the
  // buffering branch of onBufferedBodyChunk only caps req.text()/.arrayBuffer().
  // A chunked (no Content-Length) body consumed as a ReadableStream goes
  // through the streaming branch, which must also count and cap forwarded
  // bytes — otherwise a single request streams unbounded data past the limit.
  const limit = 1024;

  let streamed = 0;
  let streamError = "";
  let firstChunk = Promise.withResolvers<void>();
  let handlerDone = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    maxRequestBodySize: limit,
    async fetch(req) {
      streamed = 0;
      streamError = "";
      try {
        for await (const chunk of req.body!) {
          streamed += chunk.byteLength;
          firstChunk.resolve();
        }
      } catch (e) {
        streamError = String((e as Error)?.message ?? e);
      } finally {
        firstChunk.resolve();
        handlerDone.resolve();
      }
      return new Response(String(streamed));
    },
  });

  // Sends a chunked POST with no Content-Length. Writes one small chunk,
  // waits until the handler has started pulling from the stream (so later
  // chunks take the streaming branch, not the pre-stream buffer), then
  // writes the rest.
  async function sendChunked(totalBytes: number): Promise<string> {
    firstChunk = Promise.withResolvers<void>();
    handlerDone = Promise.withResolvers<void>();

    const sock = connect(Number(server.port), "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      sock.on("connect", resolve);
      sock.on("error", reject);
    });
    // Once the limit trips the server ends the connection while the client is
    // still writing chunks; EPIPE/ECONNRESET here is the expected outcome.
    sock.removeAllListeners("error");
    sock.on("error", () => {});

    let received = "";
    const { promise: gotResponse, resolve: doneReceiving } = Promise.withResolvers<void>();
    sock.on("data", d => {
      received += d.toString("latin1");
      if (received.includes("\r\n\r\n")) doneReceiving();
    });
    sock.on("close", () => doneReceiving());

    sock.write(
      "POST / HTTP/1.1\r\n" + //
        `Host: 127.0.0.1:${server.port}\r\n` +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n",
    );

    const piece = Buffer.alloc(256, "A").toString("latin1");
    const writeChunk = () =>
      new Promise<void>(resolve => {
        if (sock.destroyed) return resolve();
        sock.write(piece.length.toString(16) + "\r\n" + piece + "\r\n", () => resolve());
      });

    await writeChunk();
    await firstChunk.promise;
    for (let sent = piece.length; sent < totalBytes && !sock.destroyed; sent += piece.length) {
      await writeChunk();
    }
    if (!sock.destroyed) sock.write("0\r\n\r\n");

    await handlerDone.promise;
    await gotResponse;
    sock.destroy();
    return received.split("\r\n")[0];
  }

  // A chunked body under the limit still streams fully to the handler.
  const okStatus = await sendChunked(512);
  expect(streamError).toBe("");
  expect(streamed).toBe(512);
  expect(okStatus).toBe("HTTP/1.1 200 OK");

  // A chunked body over the limit is rejected: the stream read errors, the
  // handler never sees the full payload, and the client gets a 413.
  const overflowTotal = limit * 16;
  const overflowStatus = await sendChunked(overflowTotal);
  expect(overflowStatus).toBe("HTTP/1.1 413 Payload Too Large");
  expect(streamError).toBe("Request body exceeded maxRequestBodySize");
  expect(streamed).toBeLessThan(overflowTotal);

  await stopAndAssertDrained(server);
}, 15_000);

test("client abort frees the context even while the resolve function stays reachable", async () => {
  // The held resolve function keeps the handler Promise (and so the
  // NativePromiseContext cell) alive forever, so GC can never release the
  // cell's ref on the RequestContext. The abort itself must reclaim it.
  let capturedResolve: ((r: Response) => void) | undefined;
  let capturedPromise: Promise<Response> | undefined;
  const { promise: abortObserved, resolve: signalAbort } = Promise.withResolvers<void>();
  const { promise: handlerEntered, resolve: signalHandler } = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      signalHandler();
      capturedPromise = new Promise<Response>(resolve => {
        capturedResolve = resolve;
        req.signal.addEventListener("abort", () => signalAbort(), { once: true });
      });
      return capturedPromise;
    },
  });

  const ac = new AbortController();
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await handlerEntered;
  ac.abort();
  await p;
  await abortObserved;

  // The context is torn down on abort, not when GC collects the promise.
  await stopAndAssertDrained(server);

  // Resolving after the context is gone is a safe no-op: the reaction's
  // take() returns null. Awaiting the handler promise orders the assertion
  // after the native reaction, which was attached first.
  capturedResolve!(new Response("very late"));
  await capturedPromise;
  capturedResolve = undefined;
  expect(server.pendingRequests).toBe(0);
});

// Holding the pull() promise keeps its NativePromiseContext cell alive, so
// only the abort can release the context. Before the fix, on_abort's sink
// branch returned without ending request streaming, so a pending body read on
// the cut-off upload stayed parked (and pendingRequests at 1) until GC.
// req.text() and for-await(req.body) keep the body Locked. req.textStream()
// moves it to Used, whose rejection goes through a stream ref that
// finalize_without_deinit drops without erroring, so the sink branch must end
// request streaming itself.
const bodyConsumers: Array<[string, (req: Request, done: (v: unknown) => void) => void]> = [
  [
    "req.text()",
    (req, done) => {
      req.text().then(() => done("resolved"), done);
    },
  ],
  [
    "for await (req.body)",
    (req, done) => {
      (async () => {
        try {
          for await (const _chunk of req.body!) {
            // keep reading until the upload ends or errors
          }
          done("completed");
        } catch (e) {
          done(e);
        }
      })();
    },
  ],
  [
    "req.textStream()",
    (req, done) => {
      (async () => {
        try {
          for await (const _chunk of req.textStream()) {
            // keep reading until the upload ends or errors
          }
          done("completed");
        } catch (e) {
          done(e);
        }
      })();
    },
  ],
];

test.each(bodyConsumers)(
  "client abort while a direct stream pull() is parked frees the context and rejects a pending %s read",
  async (_name, consume) => {
    let pumpHold: Promise<never> | undefined;
    const { promise: bodyRead, resolve: signalBodyRead } = Promise.withResolvers<unknown>();
    const { promise: firstWrite, resolve: signalFirstWrite } = Promise.withResolvers<void>();

    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        consume(req, signalBodyRead);
        return new Response(
          new ReadableStream({
            type: "direct",
            pull(ctrl) {
              ctrl.write("hello");
              ctrl.flush();
              signalFirstWrite();
              pumpHold = new Promise<never>(() => {});
              return pumpHold;
            },
          }),
        );
      },
    });

    // Raw socket: send a chunked POST, deliver one partial chunk so the read
    // stays pending, then destroy the socket mid-stream.
    const socket = connect(Number(server.port), "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("error", reject);
    });
    socket.removeAllListeners("error");
    socket.on("error", () => {});
    socket.write(
      "POST / HTTP/1.1\r\n" + //
        `Host: 127.0.0.1:${server.port}\r\n` +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n" +
        "7\r\npartial\r\n",
    );
    await firstWrite;
    socket.destroy();

    // The cut-off upload rejects the pending read at abort time.
    const err = await bodyRead;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("AbortError");
    await stopAndAssertDrained(server);
    pumpHold = undefined;
  },
);

test("pendingRequests drops when the client aborts a parked direct-stream pull(), and the late pull() settle is a no-op", async () => {
  // Same parked pull() scenario, driven through fetch() and an AbortController,
  // with the pull() resolvers stashed in user state. Releasing them afterwards
  // settles the pump promise of a context that is already gone: the stream
  // reaction's take() returns null, and pendingRequests must not move.
  const parked: Array<() => void> = [];
  const pullEntered: Array<() => void> = [];
  const pullSettled: Array<() => void> = [];

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(c) {
            c.write("x");
            await c.flush();
            pullEntered.shift()?.();
            await new Promise<void>(r => parked.push(r));
            pullSettled.shift()?.();
          },
        }),
        { headers: { "Content-Length": "100000" } },
      );
    },
  });

  async function abortWhileParked() {
    const { promise: entered, resolve: markEntered } = Promise.withResolvers<void>();
    pullEntered.push(markEntered);
    const ac = new AbortController();
    const res = await fetch(server.url, { signal: ac.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    await entered;
    ac.abort();
    await reader.closed.catch(() => {});
  }

  const iterations = 4;
  for (let i = 0; i < iterations; i++) {
    await abortWhileParked();
  }

  // stop() resolves only once every abort tore its context down.
  await stopAndAssertDrained(server);

  // Release the parked pulls: each settle targets a context that is already
  // gone. The stream reaction's take() returns null and the counter stays 0.
  // Awaiting the settle signals orders the assertion after those reactions.
  const resolvers = parked.splice(0);
  expect(resolvers.length).toBe(iterations);
  const settled = resolvers.map(() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    pullSettled.push(resolve);
    return promise;
  });
  for (const r of resolvers) r();
  await Promise.all(settled);
  Bun.gc(true);
  expect(server.pendingRequests).toBe(0);
});

// The abort tears the context down before the stream pump settles, so the
// pump's cleanup of the Response body never runs. The body kept a strong ref
// on the stream. When the stream can reach the Response (hono's streamSSE
// keeps a WeakMap from the body stream to its Context), that ref closed a
// cycle through a GC root and every disconnect leaked the Response, the
// stream, and everything the handler closed over.
test.each(["sync", "async"])(
  "client abort of a streaming Response releases the body stream it held (%s handler)",
  async kind => {
    const stash = new WeakMap<ReadableStream, Response>();
    const streams: WeakRef<ReadableStream>[] = [];
    const respond = () => {
      const stream = new ReadableStream({
        pull(controller) {
          controller.enqueue("data: x\n\n");
          return new Promise<void>(() => {});
        },
      });
      streams.push(new WeakRef(stream));
      const response = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      stash.set(stream, response);
      return response;
    };

    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch:
        kind === "async"
          ? async () => {
              await Promise.resolve();
              return respond();
            }
          : () => respond(),
    });

    async function abortAfterFirstChunk() {
      const ac = new AbortController();
      const res = await fetch(server.url, { signal: ac.signal });
      const reader = res.body!.getReader();
      await reader.read();
      ac.abort();
      await reader.closed.catch(() => {});
    }

    const iterations = 8;
    for (let i = 0; i < iterations; i++) {
      await abortAfterFirstChunk();
    }
    expect(streams).toHaveLength(iterations);

    // stop() resolves once every abort tore its context down, which is when
    // the body's ref must be gone.
    await stopAndAssertDrained(server);

    let alive = iterations;
    for (let i = 0; i < 20 && alive > 0; i++) {
      Bun.gc(true);
      await Bun.sleep(1);
      alive = streams.filter(ref => ref.deref() !== undefined).length;
    }
    // A survivor is rare and does not reproduce locally. Report what holds it
    // instead of the bare count.
    expect(alive === 0 ? "" : describeRetainers(streams, stash)).toBe("");
  },
);

// For each stream still alive: whether it and its Response are native roots
// (a bun_jsc::Strong slot or a protect()), every object that points at it,
// and the shortest path from a GC root, read from a debugging heap snapshot.
function describeRetainers(streams: WeakRef<ReadableStream>[], stash: WeakMap<ReadableStream, Response>): string {
  const { out, tagged } = tagSurvivors(streams, stash);

  // The survivors and the protected-object list are out of scope here, so the
  // snapshot does not see this function's own references.
  jsc.releaseWeakRefs();
  // GCDebugging snapshot: nodes are 7-tuples [id, size, classIndex, flags, labelIndex, cell, wrapped],
  // edges are 4-tuples [from, to, typeIndex, data], roots are 3-tuples [id, reasonLabel, reachabilityLabel].
  const snap = (jsc as any).generateHeapSnapshotForDebugging();
  const nodes: Map<number, string> = new Map();
  for (let p = 0; p < snap.nodes.length; p += 7) {
    const label = snap.labels[snap.nodes[p + 4]];
    const wrapped = snap.nodes[p + 6];
    nodes.set(
      snap.nodes[p],
      snap.nodeClassNames[snap.nodes[p + 2]] +
        (label ? `(${label})` : "") +
        (wrapped && wrapped !== "0x0" ? `{wrapped ${wrapped}}` : ""),
    );
  }
  const rootReason: Map<number, string> = new Map();
  for (let p = 0; p < snap.roots.length; p += 3) {
    const reach = snap.labels[snap.roots[p + 2]];
    rootReason.set(snap.roots[p], snap.labels[snap.roots[p + 1]] + (reach ? ` (${reach})` : ""));
  }
  type Edge = { from: number; to: number; label: string };
  const incoming: Map<number, Edge[]> = new Map();
  const taggedNode: Map<string, number> = new Map();
  for (let p = 0; p < snap.edges.length; p += 4) {
    const [from, to] = [snap.edges[p], snap.edges[p + 1]];
    const type = snap.edgeTypes[snap.edges[p + 2]];
    const name: string =
      type === "Property" || type === "Variable"
        ? (snap.edgeNames[snap.edges[p + 3]] ?? "")
        : type === "Index"
          ? String(snap.edges[p + 3])
          : "";
    const edge = { from, to, label: name ? `${type}:${name}` : type };
    let list = incoming.get(to);
    if (!list) incoming.set(to, (list = []));
    list.push(edge);
    if (type === "Property" && name.startsWith("__leak_")) taggedNode.set(name, from);
  }
  const fmt = (id: number) => {
    const root = rootReason.get(id);
    return `${nodes.get(id) ?? "?"}#${id}${root ? ` [ROOT: ${root}]` : ""}`;
  };
  // Shortest path from a root to `id`. Weak containers only reach an object
  // that is already alive, so they are skipped.
  const chainToRoot = (id: number): string => {
    if (rootReason.has(id)) return `  ${fmt(id)}`;
    const prev: Map<number, Edge | null> = new Map([[id, null]]);
    const queue = [id];
    let found = -1;
    while (queue.length && found < 0) {
      const cur = queue.shift()!;
      for (const edge of incoming.get(cur) ?? []) {
        if (prev.has(edge.from)) continue;
        const cls = nodes.get(edge.from) ?? "";
        if (cls.startsWith("WeakRef") || cls.startsWith("WeakMap") || cls.startsWith("WeakSet")) continue;
        prev.set(edge.from, edge);
        if (edge.from === 0 || rootReason.has(edge.from)) {
          found = edge.from;
          break;
        }
        queue.push(edge.from);
      }
    }
    if (found < 0) return "  (no path from a root outside weak containers)";
    const parts: string[] = [];
    for (let cur = found; ; ) {
      const edge = prev.get(cur);
      if (!edge) break;
      parts.push(`${fmt(cur)} -${edge.label}-> `);
      cur = edge.to;
    }
    return "  " + parts.join("") + fmt(id);
  };
  for (const i of tagged) {
    for (const what of ["stream", "response"]) {
      const id = taggedNode.get(`__leak_${what}_${i}`);
      if (id === undefined) {
        if (what === "stream") out.push(`index ${i}: stream node not found in the snapshot`);
        continue;
      }
      out.push(`index ${i}: ${what} = ${fmt(id)}`);
      for (const edge of incoming.get(id) ?? []) out.push(`    <- ${edge.label} from ${fmt(edge.from)}`);
      out.push(chainToRoot(id));
    }
  }
  return out.join("\n");
}

// Tag each survivor with a unique property so its node can be found in the
// snapshot, and record whether it and its Response are native roots.
function tagSurvivors(
  streams: WeakRef<ReadableStream>[],
  stash: WeakMap<ReadableStream, Response>,
): { out: string[]; tagged: number[] } {
  const out: string[] = [];
  const tagged: number[] = [];
  const protectedObjects: unknown[] = jsc.getProtectedObjects();
  for (let i = 0; i < streams.length; i++) {
    const stream = streams[i].deref();
    if (!stream) continue;
    const response = stash.get(stream);
    (stream as any)[`__leak_stream_${i}`] = {};
    if (response) (response as any)[`__leak_response_${i}`] = {};
    tagged.push(i);
    out.push(
      `index ${i}: stream ${protectedObjects.includes(stream) ? "IS" : "is not"} a native root; ` +
        `response ${response ? (protectedObjects.includes(response) ? "IS" : "is not") : "(not in stash)"} a native root`,
    );
  }
  return { out, tagged };
}

// Between the abort and the late settle, the server itself goes away: stop()
// (issued before or after the abort) plus pendingRequests reaching 0 lets the
// server release its JS wrapper, and dropping the last reference lets GC free
// it. Releasing the parked pull() after that must still be a no-op.
for (const stopFirst of [true, false]) {
  test(`releasing a parked pull() after the abort tore down the context and the server is a no-op (${stopFirst ? "stop-then-abort" : "abort-then-stop"})`, async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let release;
        const gate = new Promise(r => (release = r));
        let pullDone;
        const pullExited = new Promise(r => (pullDone = r));
        let server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          fetch() {
            return new Response(new ReadableStream({
              type: "direct",
              async pull(c) {
                c.write("x");
                await c.flush();
                await gate;
                pullDone();
              },
            }), { headers: { "Content-Length": "100000" } });
          },
        });
        const ac = new AbortController();
        const reader = (await fetch(server.url, { signal: ac.signal })).body.getReader();
        await reader.read();
        ${stopFirst ? "const stopped = server.stop();" : ""}
        ac.abort();
        await reader.closed.catch(() => {});
        // The stop() promise resolves only once the abort tears the parked
        // context down. No Bun.gc before it: the abort itself has to do it.
        ${stopFirst ? "await stopped;" : "await server.stop();"}
        if (server.pendingRequests !== 0) throw new Error("pendingRequests=" + server.pendingRequests);
        server = undefined;
        Bun.gc(true);
        release();
        await pullExited;
        Bun.gc(true);
        console.log("ok");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
}

test("async server.upgrade() frees the context while the handler promise stays parked", async () => {
  // The upgrade detaches the response and disarms onAborted, so neither
  // on_abort nor an end path can run afterwards. The upgrade itself must
  // reclaim the cell's ref, or the held resolve parks the context forever.
  let capturedResolve: ((r: Response) => void) | undefined;
  let capturedPromise: Promise<Response> | undefined;

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req, srv) {
      capturedPromise = new Promise<Response>(resolve => {
        capturedResolve = resolve;
        // Upgrade from a macrotask, so on_response parks the promise and
        // takes the cell ref before the upgrade runs.
        setImmediate(() => srv.upgrade(req));
      });
      return capturedPromise;
    },
    websocket: {
      message() {},
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}/`);
  try {
    const { promise: opened, resolve: signalOpen, reject: failOpen } = Promise.withResolvers<void>();
    const { promise: closed, resolve: signalClose } = Promise.withResolvers<void>();
    ws.onopen = () => signalOpen();
    ws.onclose = () => signalClose();
    ws.onerror = () => failOpen(new Error("websocket upgrade failed"));
    await opened;

    // Close the socket first: stop() also waits for open WebSockets. After
    // that, its resolution is exactly the context teardown the upgrade owes.
    ws.close();
    await closed;
    await stopAndAssertDrained(server);

    // Resolving after the context is gone is a safe no-op: the reaction's
    // take() returns null. Awaiting the handler promise orders the assertion
    // after the native reaction, which was attached first.
    capturedResolve!(new Response("late"));
    await capturedPromise;
    capturedResolve = undefined;
    expect(server.pendingRequests).toBe(0);
  } finally {
    ws.close();
  }
});

test("413 on a chunked upload frees the context while the handler promise stays parked", async () => {
  // The 413 path ends the request through end_without_body, and uWS markDone()
  // clears onAborted, so on_abort can never run for this request. The held
  // resolve keeps the promise alive forever, so only the end path itself can
  // release the context.
  let capturedResolve: ((r: Response) => void) | undefined;
  const { promise: handlerEntered, resolve: signalHandler } = Promise.withResolvers<void>();

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    maxRequestBodySize: 1024,
    fetch() {
      signalHandler();
      return new Promise<Response>(resolve => {
        capturedResolve = resolve;
      });
    },
  });

  const socket = connect(Number(server.port), "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("error", reject);
    });
    // The server closes the connection after the 413; EPIPE/ECONNRESET while
    // we are still writing chunks is the expected outcome.
    socket.removeAllListeners("error");
    socket.on("error", () => {});

    let received = "";
    const { promise: gotResponse, resolve: signalResponse } = Promise.withResolvers<void>();
    socket.on("data", d => {
      received += d.toString("latin1");
      if (received.includes("\r\n\r\n")) signalResponse();
    });
    socket.on("close", () => signalResponse());

    socket.write(
      "POST / HTTP/1.1\r\n" + //
        `Host: 127.0.0.1:${server.port}\r\n` +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n",
    );
    await handlerEntered;

    const piece = Buffer.alloc(512, "A").toString("latin1");
    for (let sent = 0; sent < 4096 && !socket.destroyed; sent += piece.length) {
      await new Promise<void>(resolve => {
        if (socket.destroyed) return resolve();
        socket.write(piece.length.toString(16) + "\r\n" + piece + "\r\n", () => resolve());
      });
    }

    await gotResponse;
    // An early close resolves gotResponse too; fail on the missing response
    // before the status-line comparison so the cause is visible.
    expect(received).not.toBe("");
    expect(received.split("\r\n")[0]).toBe("HTTP/1.1 413 Payload Too Large");

    // The context is torn down by the 413, not by GC collecting the promise.
    // The 413 closed the connection, so stop() waits only on the teardown.
    await stopAndAssertDrained(server);
    capturedResolve = undefined;
  } finally {
    socket.destroy();
  }
});

// A request subscribes to its connection's close only once its dispatch is
// over (to_async), so a close that lands before that was lost. server.stop(true)
// inside the handler closes the connection right there. A request with its body
// in flight then went async on the closed socket and was parked forever: no
// abort, a pending body read that never settled, pendingRequests stuck at 1,
// and a stop() promise that never resolved. A request without a body rendered
// a 204 into the closed socket instead of aborting.
const stoppedRequests: Array<[string, string, string[]]> = [
  ["a GET", "GET /stopped HTTP/1.1\r\nHost: example.com\r\n\r\n", ["abort http://example.com/stopped example.com"]],
  [
    "a POST with its body in flight",
    // Declares 1000 bytes and sends 10.
    "POST /stopped HTTP/1.1\r\nHost: example.com\r\nContent-Length: 1000\r\n\r\n0123456789",
    ["abort http://example.com/stopped example.com", "text rejected: AbortError"],
  ],
];
test.each(stoppedRequests)("server.stop(true) inside the handler of %s aborts it", async (_what, head, expected) => {
  const events: string[] = [];
  const { promise: reached, resolve: signalReached, reject: failReached } = Promise.withResolvers<void>();
  let stopped: Promise<void>;
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req, srv) {
      // url and headers are read lazily from inside the listener: an abort
      // delivered this way must still see them, like any other abort.
      req.signal.addEventListener("abort", () => events.push(`abort ${req.url} ${req.headers.get("host")}`), {
        once: true,
      });
      if (req.method === "POST") {
        req.text().then(
          () => events.push("text resolved"),
          e => events.push(`text rejected: ${(e as Error).name}`),
        );
      }
      stopped = srv.stop(true);
      signalReached();
      return new Promise<Response>(() => {});
    },
  });

  const client = connect(Number(server.port), "127.0.0.1", () => client.write(head));
  // A reset after the server closed the connection is expected; a failure
  // before the handler ran is not.
  client.on("error", failReached);

  await reached;
  // The abort is delivered as the dispatch finishes; an immediate queued from
  // inside it runs after that.
  await new Promise(resolve => setImmediate(resolve));
  expect(events).toEqual(expected);
  expect(server.pendingRequests).toBe(0);
  await stopped!;
});

// A Response the server will never render still owns a body stream that
// somebody produces into. The server has to cancel it, like a client abort
// after the stream was attached does, or the producer waits for a pull that
// never comes: a `pull()` source is never told, and a writer feeding a
// TransformStream (hono's streamSSE) blocks forever with everything it
// closes over.
test("a Promise<Response> that settles after the client aborted has its body stream cancelled", async () => {
  const { promise: handlerEntered, resolve: signalHandler } = Promise.withResolvers<void>();
  const { promise: abortObserved, resolve: signalAbort } = Promise.withResolvers<void>();
  const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
  let handlerResult: Promise<Response> | undefined;
  const cancelReasons: unknown[] = [];

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      req.signal.addEventListener("abort", () => signalAbort(), { once: true });
      signalHandler();
      handlerResult = (async () => {
        await gate;
        return new Response(
          new ReadableStream({
            cancel(reason) {
              cancelReasons.push(reason);
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      })();
      return handlerResult;
    },
  });

  const ac = new AbortController();
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await handlerEntered;
  ac.abort();
  await p;
  await abortObserved;

  // The abort tore the context down. Only now does the handler produce its Response.
  openGate();
  // The native reaction was attached when the handler returned, so it runs
  // before this continuation: the cancel is already done here.
  await handlerResult!;
  // The same `undefined` reason a client abort after attachment delivers.
  expect(cancelReasons).toStrictEqual([undefined]);
  await stopAndAssertDrained(server);
});

test("a TransformStream writer behind a Response that settles after the client aborted is released", async () => {
  // hono's streamSSE shape: the handler writes into a TransformStream whose
  // readable side is the Response body. Nothing reads the body, so the first
  // write parks on backpressure. Cancelling the body errors the writable side
  // and settles that write.
  const { promise: handlerEntered, resolve: signalHandler } = Promise.withResolvers<void>();
  const { promise: abortObserved, resolve: signalAbort } = Promise.withResolvers<void>();
  const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
  let handlerResult: Promise<Response> | undefined;
  let writeOutcome: Promise<string> | undefined;

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      req.signal.addEventListener("abort", () => signalAbort(), { once: true });
      signalHandler();
      handlerResult = (async () => {
        await gate;
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();
        writeOutcome = writer.write(new TextEncoder().encode("data: hello\n\n")).then(
          () => "written",
          () => "rejected",
        );
        return new Response(readable, { headers: { "Content-Type": "text/event-stream" } });
      })();
      return handlerResult;
    },
  });

  const ac = new AbortController();
  const p = fetch(server.url, { signal: ac.signal }).catch(() => {});
  await handlerEntered;
  ac.abort();
  await p;
  await abortObserved;

  openGate();
  await handlerResult!;
  expect(await writeOutcome!).toBe("rejected");
  await stopAndAssertDrained(server);
});

// server.stop(true) inside the handler closes the connection under the
// request. The handler's result is then a Response the server drops: a plain
// one, an already-settled promise (an async handler with no await), or a
// promise that settles after the dispatch is over. The request's signal
// aborts through the regular teardown either way; the body cancel is the
// part that was missing.
type StoppingHandler = (req: Request, srv: ReturnType<typeof Bun.serve>) => Response | Promise<Response>;
const stoppedServers: Promise<void>[] = [];
const stoppedHandlers: Array<[string, (body: () => ReadableStream, gate: Promise<void>) => StoppingHandler]> = [
  [
    "a Response",
    body => (_req, srv) => {
      stoppedServers.push(srv.stop(true));
      return new Response(body());
    },
  ],
  [
    "a settled Promise<Response>",
    body => async (_req, srv) => {
      stoppedServers.push(srv.stop(true));
      return new Response(body());
    },
  ],
  [
    "a pending Promise<Response>",
    (body, gate) => async (_req, srv) => {
      stoppedServers.push(srv.stop(true));
      await gate;
      return new Response(body());
    },
  ],
];

test.each(stoppedHandlers)(
  "%s returned after server.stop(true) in the handler has its body stream cancelled",
  async (_what, makeFetch) => {
    const { promise: gate, resolve: openGate } = Promise.withResolvers<void>();
    const events: string[] = [];
    const body = () =>
      new ReadableStream({
        cancel(reason) {
          events.push(`cancel ${reason}`);
        },
      });
    const handler = makeFetch(body, gate);

    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req, srv) {
        req.signal.addEventListener("abort", () => events.push("abort"), { once: true });
        return handler(req, srv);
      },
    });

    await fetch(server.url).then(
      () => {
        throw new Error("the request should not get a response");
      },
      () => {},
    );
    // The stopped server tears the request down as the dispatch ends. A
    // pending handler result settles only now, into a context that is gone.
    await stoppedServers.pop()!;
    expect(server.pendingRequests).toBe(0);
    openGate();
    // The cancel runs inside the promise reaction the server attached, which
    // was registered before anything this test awaits.
    await gate;
    await new Promise(resolve => setImmediate(resolve));
    expect(events.sort()).toEqual(["abort", "cancel undefined"]);
  },
);

test("error() returning a streaming Response after server.stop(true) has its body stream cancelled", async () => {
  let stopped: Promise<void> | undefined;
  const cancelReasons: unknown[] = [];

  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      throw new Error("boom");
    },
    error() {
      stopped = server.stop(true);
      return new Response(
        new ReadableStream({
          cancel(reason) {
            cancelReasons.push(reason);
          },
        }),
      );
    },
  });

  await fetch(server.url).then(
    () => {
      throw new Error("the request should not get a response");
    },
    () => {},
  );
  await stopped!;
  expect(cancelReasons).toStrictEqual([undefined]);
  expect(server.pendingRequests).toBe(0);
});

// A null-body status is sent without its body, as HEAD is: the stream behind
// it has to be cancelled the same way.
test.each([204, 304])("a %d Response with a ReadableStream body cancels the stream", async status => {
  const cancelReasons: unknown[] = [];
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          cancel(reason) {
            cancelReasons.push(reason);
          },
        }),
        { status },
      );
    },
  });

  const res = await fetch(server.url);
  expect(res.status).toBe(status);
  expect(await res.text()).toBe("");
  expect(cancelReasons).toStrictEqual([undefined]);
  await stopAndAssertDrained(server);
});
