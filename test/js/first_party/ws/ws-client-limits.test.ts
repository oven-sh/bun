// The `maxPayload` and `handshakeTimeout` options of the `ws` client. The expected events are those of Node.js v26.3.0
// with ws 8.18.3, but where a comment says what Bun does.
import { describe, expect, it } from "bun:test";
import crypto from "crypto";
import { once } from "events";
import { tls as serverIdentity } from "harness";
import net, { type AddressInfo } from "net";
import { deflateRawSync } from "node:zlib";
import tls from "tls";
import { type ClientOptions, WebSocket } from "ws";
import { startRecordingProxy } from "../../web/websocket/proxy-test-utils";

type Seen =
  | "open"
  | { message: number }
  | { ping: number }
  | { error: string; message: string; code?: string; readyState: number }
  | { close: number; reason: string; readyState: number };

/** Everything a client emits until 'close', in order. */
function emitted(ws: WebSocket): Promise<Seen[]> {
  const seen: Seen[] = [];
  const { promise, resolve } = Promise.withResolvers<Seen[]>();
  ws.on("open", () => seen.push("open"));
  ws.on("message", data => seen.push({ message: (data as Buffer).length }));
  ws.on("ping", data => seen.push({ ping: data.length }));
  ws.on("error", (error: Error & { code?: string }) =>
    seen.push({ error: error.constructor.name, message: error.message, code: error.code, readyState: ws.readyState }),
  );
  ws.on("close", (code, reason) => {
    seen.push({ close: code, reason: String(reason), readyState: ws.readyState });
    resolve(seen);
  });
  return promise;
}

/** "open", or everything the client emitted when it closed without one. */
function openedOr(ws: WebSocket, closed = emitted(ws)): Promise<"open" | Seen[]> {
  const { promise, resolve } = Promise.withResolvers<"open" | Seen[]>();
  ws.on("open", () => resolve("open"));
  closed.then(resolve);
  return promise;
}

const tooBig: Seen = {
  error: "RangeError",
  message: "Max payload size exceeded",
  code: "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH",
  readyState: WebSocket.CLOSING,
};
const timedOut: Seen = {
  error: "Error",
  message: "Opening handshake has timed out",
  code: undefined,
  readyState: WebSocket.CLOSING,
};
const abnormal: Seen = { close: 1006, reason: "", readyState: WebSocket.CLOSED };
const rejected: Seen[] = ["open", tooBig, abnormal];

const MiB = 1024 * 1024;
const bytes = (length: number) => Buffer.alloc(length, "x");

/** One unmasked frame, as a server writes it. `declaredLength` is for the header of a frame whose payload never comes. */
function serverFrame(
  opcode: number,
  payload: Uint8Array = new Uint8Array(0),
  options: { fin?: boolean; rsv1?: boolean; declaredLength?: number } = {},
) {
  const length = options.declaredLength ?? payload.length;
  const first = (options.fin === false ? 0 : 0x80) | (options.rsv1 ? 0x40 : 0) | opcode;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([first, length]);
  } else if (length < 65536) {
    header = Buffer.from([first, 126, 0, 0]);
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** The indices of `pieces` pieces, `gap()` ms apart. `onPiece` runs before each. */
async function* paced(pieces: number, gap: () => number, onPiece: () => void) {
  for (let i = 0; i < pieces; i++) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, gap()));
    onPiece();
    yield i;
  }
}

interface RawServerOptions {
  tls?: boolean;
  /** Accept a permessage-deflate offer, with no context takeover on either side. */
  deflate?: boolean;
  /** Writes the 101 response. The default is one write. */
  respond?: (socket: net.Socket, response: Buffer) => void | Promise<void>;
}

/**
 * A server that answers the upgrade by hand and then runs `onUpgraded`, which writes every byte the client reads
 * after the 101. It uses no WebSocket implementation, so it runs the same way under Node.js.
 */
async function startRawServer(onUpgraded: (socket: net.Socket) => void, options: RawServerOptions = {}) {
  let connections = 0;
  const onSocket = (socket: net.Socket) => {
    connections++;
    let request = "";
    let upgraded = false;
    // A client that fails the connection drops it.
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      if (upgraded) return;
      request += chunk.toString("latin1");
      if (!request.includes("\r\n\r\n")) return;
      upgraded = true;
      const key = /^sec-websocket-key: (.*)\r$/im.exec(request)![1];
      const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      const deflate = options.deflate && /^sec-websocket-extensions: .*permessage-deflate/im.test(request);
      const response = Buffer.from(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          (deflate
            ? "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n"
            : "") +
          "\r\n",
      );
      const respond = options.respond ?? ((socket, response) => void socket.write(response));
      Promise.resolve(respond(socket, response)).then(() => onUpgraded(socket));
    });
  };
  const server = options.tls ? tls.createServer(serverIdentity, onSocket) : net.createServer(onSocket);
  await once(server.listen(0, "127.0.0.1"), "listening");
  return {
    url: `${options.tls ? "wss" : "ws"}://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    /** How many connections the server accepted so far. */
    get connections() {
      return connections;
    },
    [Symbol.dispose]() {
      server.close();
    },
  };
}

/** Takes connections, completes the TLS handshake with `tls`, and never answers the upgrade. */
async function silentServer(options: { tls?: boolean; allowHalfOpen?: boolean } = {}) {
  const sockets: net.Socket[] = [];
  let requests = 0;
  const hold = (socket: net.Socket) => {
    sockets.push(socket);
    socket.on("error", () => {});
  };
  const read = (socket: net.Socket) => {
    hold(socket);
    socket.once("data", () => requests++);
  };
  const server = options.tls
    ? tls.createServer({ ...serverIdentity, allowHalfOpen: options.allowHalfOpen }, read)
    : net.createServer(read);
  // Under TLS these are the sockets below it: a handshake that never completes has no other.
  if (options.tls) server.on("connection", hold);
  server.on("tlsClientError", () => {});
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: `${options.tls ? "wss" : "ws"}://127.0.0.1:${port}/`,
    /** How many clients wrote to the server so far. Under TLS that is after the handshake: the upgrade request. */
    get requests() {
      return requests;
    },
    [Symbol.dispose]() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

/**
 * What a client emits when the server writes `frames` after the 101 and ends. A client that takes every frame
 * closes with the end of the server, so it fails the assertion with what it saw.
 */
async function receive(frames: Uint8Array[], clientOptions: ClientOptions, serverOptions: RawServerOptions = {}) {
  using server = await startRawServer(socket => {
    for (const frame of frames) socket.write(frame);
    socket.end();
  }, serverOptions);
  return await emitted(new WebSocket(server.url, clientOptions));
}

/**
 * What a client of `url` emits when its timer runs out with its upgrade request at `server`. A machine that stalls
 * can let the timer run out before that. Only then a client with a longer timer follows. `clients` counts them.
 */
async function timedOutAfterRequest(server: { readonly requests: number }, url: string, transport?: object) {
  let events: Seen[] = [];
  let clients = 0;
  for (const handshakeTimeout of [100, 1000]) {
    clients++;
    const options = { rejectUnauthorized: false, ...transport, handshakeTimeout } as ClientOptions;
    events = await emitted(new WebSocket(url, options));
    if (server.requests > 0 || !Bun.deepEquals(events, [timedOut, abnormal])) break;
  }
  return { events, requestArrived: server.requests > 0, clients };
}

describe.concurrent("maxPayload", () => {
  it.each([
    ["text", 0x1],
    ["binary", 0x2],
  ] as const)("a %s message of the limit arrives, one byte more does not", async (_, opcode) => {
    const frames = [serverFrame(opcode, bytes(1024)), serverFrame(opcode, bytes(1025))];
    expect(await receive(frames, { maxPayload: 1024 })).toEqual(["open", { message: 1024 }, tooBig, abnormal]);
  });

  it("the fragments of a message count together", async () => {
    const frames = [
      serverFrame(0x1, bytes(512), { fin: false }),
      serverFrame(0x0, bytes(512)),
      serverFrame(0x1, bytes(512), { fin: false }),
      serverFrame(0x0, bytes(513)),
    ];
    expect(await receive(frames, { maxPayload: 1024 })).toEqual(["open", { message: 1024 }, tooBig, abnormal]);
  });

  // 1024 bytes inflate in one call. 300,000 do not fit the buffer of that call, so a zlib stream inflates them.
  it.each([
    ["in one call", 1024],
    ["as a stream", 300_000],
  ] as const)("a compressed message counts by what it inflates to, %s", async (_, limit) => {
    const frames = [
      serverFrame(0x2, deflateRawSync(bytes(limit)), { rsv1: true }),
      serverFrame(0x2, deflateRawSync(bytes(limit + 1)), { rsv1: true }),
    ];
    expect(frames[1].length).toBeLessThan(1024);
    const events = await receive(frames, { maxPayload: limit }, { deflate: true });
    expect(events).toEqual(["open", { message: limit }, tooBig, abnormal]);
  });

  // Bun inflates a message when its last fragment is in. npm ws fails at the fragment that passes the limit.
  it("a compressed message in fragments counts by what it inflates to", async () => {
    const deflated = deflateRawSync(bytes(100_000));
    const frames = [
      serverFrame(0x2, deflated.subarray(0, 50), { rsv1: true, fin: false }),
      serverFrame(0x0, deflated.subarray(50)),
    ];
    expect(await receive(frames, { maxPayload: 1024 }, { deflate: true })).toEqual(rejected);
  });

  it("a frame that arrives with the 101 response counts", async () => {
    const respond: RawServerOptions["respond"] = (socket, response) =>
      void socket.write(Buffer.concat([response, serverFrame(0x1, bytes(5000))]));
    expect(await receive([], { maxPayload: 1024 }, { respond })).toEqual(rejected);
  });

  it("control frames do not count", async () => {
    const frames = [serverFrame(0x9, bytes(125)), serverFrame(0x1, bytes(100)), serverFrame(0x1, bytes(101))];
    expect(await receive(frames, { maxPayload: 100 })).toEqual([
      "open",
      { ping: 125 },
      { message: 100 },
      tooBig,
      abnormal,
    ]);
  });

  it("nothing the server sent behind that message arrives", async () => {
    const frames = [serverFrame(0x1, bytes(100_000)), serverFrame(0x2, bytes(4 * MiB)), serverFrame(0x1, bytes(10))];
    expect(await receive(frames, { maxPayload: 1024 })).toEqual(rejected);
  });

  it("over wss://", async () => {
    const options = { maxPayload: 1024, rejectUnauthorized: false };
    expect(await receive([serverFrame(0x1, bytes(5000))], options, { tls: true })).toEqual(rejected);
  });

  // `proxy` is an option of Bun's `ws`. A wss:// target through it is TLS inside the tunnel.
  it.each([false, true])("through an HTTP proxy, tls: %p", async tls => {
    using proxy = await startRecordingProxy();
    const options = { maxPayload: 1024, rejectUnauthorized: false, proxy: `http://127.0.0.1:${proxy.port}` };
    expect(await receive([serverFrame(0x1, bytes(5000))], options as ClientOptions, { tls })).toEqual(rejected);
    expect(proxy.connections).toBe(1);
  });

  it("through finishRequest", async () => {
    const options = { maxPayload: 1024, finishRequest: request => request.end() } as ClientOptions;
    expect(await receive([serverFrame(0x1, bytes(5000))], options)).toEqual(rejected);
  });

  // 'close' of npm ws waits for the socket. A handshake that timed out emits both in one turn.
  it("'close' comes in a later turn than 'error'", async () => {
    using server = await startRawServer(socket => void socket.end(serverFrame(0x1, bytes(5000))));
    const ws = new WebSocket(server.url, { maxPayload: 1024 });
    const order: string[] = [];
    const closed = Promise.withResolvers<void>();
    ws.on("error", () => {
      order.push("error");
      queueMicrotask(() => order.push("microtask"));
    });
    ws.on("close", () => {
      order.push("close");
      closed.resolve();
    });
    await closed.promise;
    expect(order).toEqual(["error", "microtask", "close"]);
  });

  /** The events of a client of a server that declares a frame of 150 MiB and ends. */
  async function receiveHeaderThenEnd(options?: object) {
    using server = await startRawServer(socket => {
      socket.end(serverFrame(0x2, undefined, { declaredLength: 150 * MiB }));
    });
    return await emitted(new WebSocket(server.url, options as ClientOptions));
  }

  // The limit is `maxPayload | 0`. Not above 0 is no limit in npm ws, and so is `undefined`. Bun then keeps the
  // 128 MiB of its native socket, with the events of that socket. The default of npm ws is 100 MiB.
  it.each([
    undefined,
    { headers: { "x-test": "1" } },
    { maxPayload: undefined },
    { maxPayload: 0 },
    { maxPayload: -1 },
    { maxPayload: NaN },
    { maxPayload: null },
    { maxPayload: Infinity },
    { maxPayload: 2 ** 31 },
  ])("without a number above 0 the limit stays 128 MiB, options: %p", async options => {
    expect(await receiveHeaderThenEnd(options)).toEqual([
      "open",
      { close: 1009, reason: "Message too big", readyState: WebSocket.CLOSED },
    ]);
  });

  // Bun's 'close' has the reason text of the native socket for a connection the server dropped. npm ws has none.
  it("a number above 128 MiB is the limit", async () => {
    expect(await receiveHeaderThenEnd({ maxPayload: 200 * MiB })).toEqual([
      "open",
      { close: 1006, reason: "Connection ended", readyState: WebSocket.CLOSED },
    ]);
  });

  it.each([
    [1.5, 1],
    ["2048", 2048],
    [2 ** 32 + 2048, 2048],
  ] as const)("%p is a limit of %p bytes", async (maxPayload, limit) => {
    const frames = [serverFrame(0x1, bytes(limit)), serverFrame(0x1, bytes(limit + 1))];
    const events = await receive(frames, { maxPayload } as unknown as ClientOptions);
    expect(events).toEqual(["open", { message: limit }, tooBig, abnormal]);
  });

  it("a BigInt throws and nothing connects", async () => {
    using server = await startRawServer(() => {});
    expect(() => new WebSocket(server.url, { maxPayload: 10n } as unknown as ClientOptions)).toThrow(TypeError);
    // The only connection the server gets is this one.
    const ws = new WebSocket(server.url, { maxPayload: 10 });
    const opened = await openedOr(ws);
    ws.terminate();
    expect({ opened, connections: server.connections }).toEqual({ opened: "open", connections: 1 });
  });

  it("addEventListener and the on<event> properties get the same failure", async () => {
    using server = await startRawServer(socket => void socket.end(serverFrame(0x1, bytes(5000))));
    const ws = new WebSocket(server.url, { maxPayload: 1024 });
    const seen: unknown[] = [];
    const closed = Promise.withResolvers<void>();
    ws.addEventListener("error", event => {
      const { type, message, error } = event;
      seen.push({ type, message, error: error.constructor.name, code: error.code, readyState: ws.readyState });
    });
    ws.onclose = ({ type, code, reason, wasClean }) => {
      seen.push({ type, code, reason, wasClean, readyState: ws.readyState });
      closed.resolve();
    };
    await closed.promise;
    expect(seen).toEqual([
      { type: "error", message: tooBig.message, error: tooBig.error, code: tooBig.code, readyState: 2 },
      { type: "close", code: 1006, reason: "", wasClean: false, readyState: 3 },
    ]);
  });
});

describe.concurrent("handshakeTimeout", () => {
  it("300.7 ms without an answer fail the handshake, and not earlier", async () => {
    using server = await silentServer();
    const start = performance.now();
    expect(await emitted(new WebSocket(server.url, { handshakeTimeout: 300.7 }))).toEqual([timedOut, abnormal]);
    expect(performance.now() - start).toBeGreaterThanOrEqual(300);
  });

  it("less than 1 ms is a timeout of 1 ms", async () => {
    using server = await silentServer();
    expect(await emitted(new WebSocket(server.url, { handshakeTimeout: 0.5 }))).toEqual([timedOut, abnormal]);
  });

  it("wss:// to a server that sends no TLS handshake", async () => {
    using server = await silentServer();
    const options = { handshakeTimeout: 100, rejectUnauthorized: false };
    expect(await emitted(new WebSocket(`wss://127.0.0.1:${server.port}/`, options))).toEqual([timedOut, abnormal]);
  });

  // npm ws has no `proxy` option. With an agent its timer does not cover the CONNECT request.
  it("an HTTP proxy that does not answer the CONNECT request", async () => {
    using proxy = await silentServer();
    const options = { handshakeTimeout: 100, proxy: `http://127.0.0.1:${proxy.port}` } as ClientOptions;
    expect(await emitted(new WebSocket(proxy.url, options))).toEqual([timedOut, abnormal]);
  });

  it("through finishRequest", async () => {
    using server = await silentServer();
    const options = { handshakeTimeout: 100, finishRequest: request => request.end() } as ClientOptions;
    expect(await emitted(new WebSocket(server.url, options))).toEqual([timedOut, abnormal]);
  });

  it("'close' comes in the same turn as 'error'", async () => {
    using server = await silentServer();
    const ws = new WebSocket(server.url, { handshakeTimeout: 100 });
    const order: string[] = [];
    const closed = Promise.withResolvers<void>();
    ws.on("error", () => {
      order.push("error");
      queueMicrotask(() => order.push("microtask"));
    });
    ws.on("close", () => {
      order.push("close");
      closed.resolve();
    });
    await closed.promise;
    expect(order).toEqual(["error", "close", "microtask"]);
  });

  it("addEventListener and the on<event> properties get the same failure", async () => {
    using server = await silentServer();
    const ws = new WebSocket(server.url, { handshakeTimeout: 100 });
    const seen: unknown[] = [];
    const closed = Promise.withResolvers<void>();
    ws.onerror = ({ type, message, error }) => {
      seen.push({ type, message, error: error.constructor.name, readyState: ws.readyState });
    };
    ws.addEventListener("close", ({ type, code, reason, wasClean }) => {
      seen.push({ type, code, reason, wasClean, readyState: ws.readyState });
      closed.resolve();
    });
    await closed.promise;
    expect(seen).toEqual([
      { type: "error", message: timedOut.message, error: "Error", readyState: 2 },
      { type: "close", code: 1006, reason: "", wasClean: false, readyState: 3 },
    ]);
  });

  // The messages are those of Node.js, where the option is the `timeout` of the HTTP request.
  it.each([
    [
      "300",
      "TypeError",
      "ERR_INVALID_ARG_TYPE",
      `The "timeout" argument must be of type number. Received type string ('300')`,
    ],
    [null, "TypeError", "ERR_INVALID_ARG_TYPE", `The "timeout" argument must be of type number. Received null`],
    [
      {},
      "TypeError",
      "ERR_INVALID_ARG_TYPE",
      `The "timeout" argument must be of type number. Received an instance of Object`,
    ],
    [
      -1,
      "RangeError",
      "ERR_OUT_OF_RANGE",
      `The value of "timeout" is out of range. It must be a non-negative finite number. Received -1`,
    ],
    [
      NaN,
      "RangeError",
      "ERR_OUT_OF_RANGE",
      `The value of "timeout" is out of range. It must be a non-negative finite number. Received NaN`,
    ],
    [
      Infinity,
      "RangeError",
      "ERR_OUT_OF_RANGE",
      `The value of "timeout" is out of range. It must be a non-negative finite number. Received Infinity`,
    ],
  ])("%p throws and nothing connects", async (handshakeTimeout, name, code, message) => {
    using server = await startRawServer(() => {});
    let thrown: (Error & { code?: string }) | undefined;
    try {
      new WebSocket(server.url, { handshakeTimeout } as unknown as ClientOptions);
    } catch (error) {
      thrown = error as Error;
    }
    expect({ name: thrown?.name, code: thrown?.code, message: thrown?.message }).toEqual({ name, code, message });
    // The only connection the server gets is this one.
    const ws = new WebSocket(server.url);
    const opened = await openedOr(ws);
    ws.terminate();
    expect({ opened, connections: server.connections }).toEqual({ opened: "open", connections: 1 });
  });

  // A timer that outlives its handshake fires into a client that is gone: the ASAN build reports that.
  it("a handshake that ends another way takes its timer with it", async () => {
    using silent = await silentServer();
    const answers200 = net
      .createServer(socket => socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")))
      .listen(0, "127.0.0.1");
    await once(answers200, "listening");
    try {
      const handshakeTimeout = 100;
      const closes = new WebSocket(silent.url, { handshakeTimeout });
      const terminates = new WebSocket(silent.url, { handshakeTimeout });
      // A stalled machine cannot make this timer win against the 200.
      const notA101 = new WebSocket(`ws://127.0.0.1:${(answers200.address() as AddressInfo).port}/`, {
        handshakeTimeout: 60_000,
      });
      const ended = [emitted(closes), emitted(terminates), emitted(notA101)];
      closes.close();
      terminates.terminate();
      const events = await Promise.all(ended);
      // A timer that starts now and is longer fires after those of `closes` and `terminates` would have.
      await emitted(new WebSocket(silent.url, { handshakeTimeout: 2 * handshakeTimeout }));
      // The text of an error that is not the timeout differs from npm ws.
      const label = (event: Seen) => (typeof event === "string" ? event : "error" in event ? event.message : "close");
      const failed = [expect.not.stringMatching(timedOut.message), "close"];
      expect(events.map(seen => seen.map(label))).toEqual([failed, failed, failed]);
    } finally {
      answers200.close();
    }
  });

  /** An HTTP proxy that writes its answer to the CONNECT request in the pieces of `pace`. */
  async function startPacingProxy(pace: (pieces: number) => AsyncGenerator<number>) {
    const server = net.createServer(client => {
      client.on("error", () => {});
      client.once("data", (head: Buffer) => {
        const [, host, port] = /^CONNECT ([^:]+):(\d+)/.exec(head.toString("latin1"))!;
        const target = net.connect(Number(port), host);
        target.on("error", () => client.destroy());
        client.on("close", () => target.destroy());
        target.on("connect", async () => {
          const answer = "HTTP/1.1 200 Connection Established\r\n\r\n";
          for await (const i of pace(6)) client.write(answer.slice(i * 7, i === 5 ? undefined : (i + 1) * 7));
          client.pipe(target);
          target.pipe(client);
        });
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    return {
      port: (server.address() as AddressInfo).port,
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  // It is the socket timeout of Node.js that npm ws sets: each piece of an answer starts it again. The pieces are
  // a quarter of the timeout apart, and all of them take longer than it. Serial: other tests stretch the gaps.
  it.serial.each([
    ["a 101 response", "direct"],
    ["a 101 response inside the TLS of a tunnel", "tunnel"],
    ["the answer of a proxy to the CONNECT request", "pacing proxy"],
  ] as const)("%s that comes in pieces still opens", async (_, route) => {
    let attempt = 0;
    let gap = 0;
    let longestGap = 0;
    let last = 0;
    // Runs at each step the client sees of its handshake, for the longest time between two of them.
    const progress = () => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - last);
      last = now;
    };
    // The pieces of an attempt that is over do not count for the next one.
    const pace = (pieces: number, mine = attempt) =>
      paced(
        pieces,
        () => gap,
        () => void (mine === attempt && progress()),
      );
    using server = await startRawServer(() => {}, {
      tls: route === "tunnel",
      async respond(socket, response) {
        const pieces = route === "pacing proxy" ? 1 : 6;
        const length = Math.ceil(response.length / pieces);
        for await (const i of pace(pieces)) socket.write(response.subarray(i * length, (i + 1) * length));
      },
    });
    using proxy = route === "tunnel" ? await startRecordingProxy() : undefined;
    using pacingProxy = route === "pacing proxy" ? await startPacingProxy(pace) : undefined;
    using silent = await silentServer();
    const via = proxy ?? pacingProxy;
    const transport = { rejectUnauthorized: false, ...(via && { proxy: `http://127.0.0.1:${via.port}` }) };
    let outcome: unknown;
    // A machine that stalls can stretch a gap to the length of the timer. Such a run says nothing: a longer timer follows.
    for (const handshakeTimeout of [400, 1200]) {
      attempt++;
      gap = handshakeTimeout / 4;
      longestGap = 0;
      const start = (last = performance.now());
      const silentClient = emitted(new WebSocket(silent.url, { handshakeTimeout }));
      const ws = new WebSocket(server.url, { ...transport, handshakeTimeout } as ClientOptions);
      const result = await openedOr(ws);
      progress();
      const outlastedTimer = last - start > handshakeTimeout;
      ws.terminate();
      // The same timer on a server that sent nothing ran out.
      outcome = { result, outlastedTimer, silent: await silentClient };
      if (result === "open" || longestGap < handshakeTimeout - gap) break;
    }
    expect(outcome).toEqual({ result: "open", outlastedTimer: true, silent: [timedOut, abnormal] });
  });

  // Behind a proxy the client of the handshake lives on after the 101, to own the proxy connection. Serial: each
  // connection has to open before its timer runs out.
  it.serial.each([
    ["ws://", false, false],
    ["wss://", true, false],
    ["ws:// through an HTTP proxy", false, true],
    ["wss:// through an HTTP proxy", true, true],
  ] as const)("%s stays open after the timeout", async (_, tls, viaProxy) => {
    using silent = await silentServer();
    using proxy = viaProxy ? await startRecordingProxy() : undefined;
    using server = await startRawServer(() => {}, { tls });
    const transport = { rejectUnauthorized: false, ...(proxy && { proxy: `http://127.0.0.1:${proxy.port}` }) };
    let outcome: unknown;
    for (const handshakeTimeout of [250, 1000]) {
      const ws = new WebSocket(server.url, { ...transport, handshakeTimeout } as ClientOptions);
      const closed = emitted(ws);
      const opened = await openedOr(ws, closed);
      if (opened === "open") {
        // A timer that starts now and is as long fires after the one of `ws` would have.
        await emitted(new WebSocket(silent.url, { handshakeTimeout }));
        const readyState = ws.readyState;
        ws.terminate();
        outcome = { readyState, events: (await closed).slice(0, -1) };
        break;
      }
      outcome = opened;
      // A machine that stalls can take longer than the timer to open a connection. Only then a longer timer follows.
      if (!Bun.deepEquals(opened, [timedOut, abnormal])) break;
    }
    expect(outcome).toEqual({ readyState: WebSocket.OPEN, events: ["open"] });
  });

  // Serial, as the two tests after it: beside other tests, a debug build needs more than the first timer to get as
  // far as the test needs.
  it.serial.each([
    ["ws://", false, false],
    ["wss://", true, false],
    ["ws:// through an HTTP proxy", false, true],
    ["wss:// through an HTTP proxy", true, true],
  ] as const)("%s to a server that takes the request and does not answer", async (_, tls, viaProxy) => {
    using proxy = viaProxy ? await startRecordingProxy() : undefined;
    using server = await silentServer({ tls });
    const transport = proxy && { proxy: `http://127.0.0.1:${proxy.port}` };
    const { events, requestArrived, clients } = await timedOutAfterRequest(server, server.url, transport);
    // Each client made one connection to the proxy.
    expect({ events, requestArrived, proxied: proxy?.connections }).toEqual({
      events: [timedOut, abnormal],
      requestArrived: true,
      proxied: proxy && clients,
    });
  });

  // The records of a TLS handshake are not progress: inside a tunnel as little as on a wss:// socket.
  it.serial("through an HTTP proxy, a TLS handshake that trickles in is timed out", async () => {
    using server = await silentServer({ tls: true });
    let outcome: unknown;
    // A machine that stalls can let the timer run out before the flight starts. Only then a longer timer follows.
    for (const handshakeTimeout of [100, 1000]) {
      let flight = Buffer.alloc(0);
      let toClient = (_: Buffer) => {};
      let trickled = 0;
      using proxy = await startRecordingProxy({
        onTargetData(chunk, forward) {
          flight = Buffer.concat([flight, chunk]);
          toClient = forward;
        },
      });
      // One byte of the server's flight each 20 ms: it would take more than 20 s.
      const trickle = setInterval(() => {
        if (flight.length === 0) return;
        toClient(flight.subarray(0, 1));
        flight = flight.subarray(1);
        trickled++;
      }, 20);
      try {
        const options = { handshakeTimeout, rejectUnauthorized: false, proxy: `http://127.0.0.1:${proxy.port}` };
        const events = await emitted(new WebSocket(server.url, options as ClientOptions));
        // With two bytes, the first was at the client 20 ms before its timer ran out.
        const trickledIn = trickled >= 2;
        outcome = { events, trickledIn, requests: server.requests };
        if (trickledIn || !Bun.deepEquals(events, [timedOut, abnormal])) break;
      } finally {
        clearInterval(trickle);
      }
    }
    expect(outcome).toEqual({ events: [timedOut, abnormal], trickledIn: true, requests: 0 });
  });

  // npm ws destroys the socket of a handshake that timed out. The relay sees the TCP connection of the client end:
  // with a FIN, or with a reset when the client had bytes left to read. A TLS server that leaves the close_notify
  // without an answer does not.
  it.serial("a TLS server that does not answer the close_notify does not hold the connection", async () => {
    using server = await silentServer({ tls: true, allowHalfOpen: true });
    const dropped: Promise<void>[] = [];
    const relay = net.createServer(client => {
      const { promise, resolve } = Promise.withResolvers<void>();
      dropped.push(promise);
      const upstream = net.connect(server.port, "127.0.0.1");
      upstream.on("error", () => {});
      client.on("error", () => {});
      client.on("close", () => {
        upstream.destroy();
        resolve();
      });
      client.pipe(upstream, { end: false });
      upstream.pipe(client);
    });
    await once(relay.listen(0, "127.0.0.1"), "listening");
    try {
      const url = `wss://127.0.0.1:${(relay.address() as AddressInfo).port}/`;
      const { events, requestArrived } = await timedOutAfterRequest(server, url);
      expect({ events, requestArrived }).toEqual({ events: [timedOut, abnormal], requestArrived: true });
      await Promise.all(dropped);
    } finally {
      relay.close();
    }
  });
});
