// Tests createWebSocketStream() against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { Duplex, pipeline, Readable } from "node:stream";
import {
  closedPort,
  connectClient,
  createPeer,
  createServer,
  implementations,
  nextEvent,
  openClient,
  openServer,
  overflowSize,
  response101,
  runScript,
  scriptTimeout,
  show,
  showError,
  shrinkBuffers,
} from "./ws-raw-peer";

/** Records 'end', 'finish', 'close' and `error <error>` as lines. Doesn't switch the stream to flowing mode. */
function watchStream(duplex: Duplex) {
  const events: string[] = [];
  for (const name of ["end", "finish", "close"]) duplex.on(name, () => events.push(name));
  duplex.on("error", error => events.push("error " + showError(error)));
  return events;
}

/** Resolves with the next `count` chunks, formatted with `show`. Switches the stream to flowing mode. */
function readChunks(duplex: Duplex, count: number) {
  const received: string[] = [];
  return new Promise<string[]>(resolve =>
    duplex.on("data", chunk => {
      if (received.push(show(chunk)) === count) resolve(received);
    }),
  );
}

/** Resolves with `"written"`, or with the error passed to `write()`'s callback. */
function write(duplex: Duplex, chunk: string) {
  return new Promise<string>(resolve => duplex.write(chunk, error => resolve(error ? showError(error) : "written")));
}

describe.each(implementations)("createWebSocketStream ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket, createWebSocketStream } = implementation;

  test.each([
    { label: "without options", options: undefined },
    { label: "with objectMode and writableObjectMode", options: { objectMode: true, writableObjectMode: true } },
  ])("returns a non-object-mode Duplex $label", async ({ options }) => {
    await using client = await openClient(implementation);
    const duplex = createWebSocketStream(client.ws, options);
    expect(duplex).toBeInstanceOf(Duplex);
    expect([duplex.readableObjectMode, duplex.writableObjectMode]).toEqual([false, false]);
  });

  describe("reading", () => {
    test.each([
      {
        label: "emits every message as a Buffer by default",
        options: undefined,
        expected: ['Buffer("txt")', 'Buffer("bin")'],
      },
      {
        label: "readableObjectMode: emits text messages as strings",
        options: { readableObjectMode: true },
        expected: ['"txt"', 'Buffer("bin")'],
      },
      {
        label: "encoding: emits every message as a string",
        options: { encoding: "utf8" },
        expected: ['"txt"', '"bin"'],
      },
    ] as const)("$label", async ({ options, expected }) => {
      await using client = await openClient(implementation);
      const received = readChunks(createWebSocketStream(client.ws, options), 2);
      client.conn.text("txt");
      client.conn.binary("bin");
      expect(await received).toEqual([...expected]);
    });

    test("pauses the socket when the readable buffer is full and resumes it on read()", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws, { highWaterMark: 16 });
      conn.binary(Buffer.alloc(64, "a"));
      await nextEvent(ws, "message");
      expect(ws.isPaused).toBe(true);
      conn.binary("next");

      expect(show(duplex.read())).toBe("Buffer(64 bytes)");
      expect(ws.isPaused).toBe(false);
      await nextEvent(ws, "message");
      expect(show(duplex.read())).toBe('Buffer("next")');
      expect(ws.isPaused).toBe(false);
    });

    test("when the peer closes, emits the data, then 'end', and stays writable until end()", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      const received = readChunks(duplex, 1);
      conn.text("bye");
      conn.close(1000);
      conn.end();
      await nextEvent(duplex, "end");
      expect(await received).toEqual(['Buffer("bye")']);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(duplex.destroyed).toBe(false);

      duplex.end();
      await nextEvent(duplex, "close");
      expect(events).toEqual(["end", "finish", "close"]);
      expect(duplex.destroyed).toBe(true);
    });
  });

  describe("writing", () => {
    test("write() sends a binary frame, even for a string", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const duplex = createWebSocketStream(client.ws);
      expect(await write(duplex, "text")).toBe("written");
      duplex.write(Buffer.from([1, 2]));
      expect(await client.conn.nextFrames(2)).toEqual(['binary "text"', "binary 0x0102"]);
    });

    // Both come from the callback of the ws.send() that write() makes. With npm ws on Bun that depends on node:net.
    test.skipIf(!builtin).each([
      { transport: "native", options: {} },
      { transport: "stream", options: { family: 4 } },
    ])(
      "the write() callback and 'drain' run in the AsyncLocalStorage store of the write() call, on the $transport transport",
      async ({ options }) => {
        const storage = new AsyncLocalStorage<string>();
        await using client = await storage.run("the socket's", () => openClient(implementation, options));
        // A chunk that is larger than the highWaterMark makes write() ask for a 'drain'.
        const duplex = createWebSocketStream(client.ws, { highWaterMark: 16 });
        const store = () => storage.getStore() ?? "no store";
        const drained = new Promise<string>(resolve => duplex.once("drain", () => resolve(`drain: ${store()}`)));
        const written = new Promise<string>(resolve =>
          duplex.write(Buffer.alloc(64), () => resolve(`write: ${store()}`)),
        );
        expect(await Promise.all([written, drained])).toEqual(["write: no store", "drain: no store"]);
      },
    );

    test("write() and end() while CONNECTING are deferred until 'open'", async () => {
      await using client = await connectClient(implementation, { perMessageDeflate: false });
      const duplex = createWebSocketStream(client.ws);
      duplex.write("first");
      duplex.write("second");
      duplex.end("last");
      expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
      const conn = await client.peer.connection();
      expect(await conn.nextFrames(4)).toEqual(['binary "first"', 'binary "second"', 'binary "last"', "close"]);
    });

    test("end() sends an empty Close frame; 'finish', 'end' and 'close' fire after the closing handshake", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      duplex.resume();
      duplex.end("last");
      expect(await conn.nextFrames(2)).toEqual(['binary "last"', "close"]);
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      expect(events).toEqual([]);

      conn.close(1000);
      conn.end();
      await nextEvent(duplex, "close");
      expect(events).toEqual(["finish", "end", "close"]);
      expect(duplex.destroyed).toBe(true);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    // A client leaves closing the connection to the server, and only gives up on a slow one after `closeTimeout`.
    test.each<{ what: string; end(duplex: Duplex): Promise<unknown> }>([
      { what: "'finish'", end: duplex => nextEvent(duplex.end("last"), "finish") },
      { what: "end()'s callback", end: duplex => new Promise<void>(resolve => duplex.end("last", resolve)) },
      {
        what: "pipeline()'s callback",
        end: duplex => new Promise(resolve => pipeline(Readable.from([Buffer.from("last")]), duplex, resolve)),
      },
    ])("$what follows the closing handshake, even if the peer leaves the connection open", async ({ end }) => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      duplex.resume();
      const finished = end(duplex);
      expect(await conn.nextFrames(2)).toEqual(['binary "last"', "close"]);
      expect(events).toEqual([]);

      conn.close();
      await finished;
      expect(events).toEqual(["finish"]);
      expect(ws.readyState).toBe(WebSocket.CLOSING);

      conn.end();
      await nextEvent(duplex, "close");
      expect(events).toEqual(["finish", "end", "close"]);
    });

    test("end() after a closing handshake that the peer started finishes while the connection is still open", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      duplex.resume();
      conn.close();
      expect(await conn.next()).toBe("close");
      // The client's FIN.
      expect(await conn.next()).toBe("EOF");

      await nextEvent(duplex.end(), "finish");
      expect(events).toEqual(["finish"]);
      expect(ws.readyState).toBe(WebSocket.CLOSING);
    });

    // The stream's write waits for the drain behind a send() whose callback throws. With npm ws on Bun, node:net
    // destroys the socket when a write callback throws.
    test.concurrent.skipIf(!builtin)(
      "finishes even if the callback of an earlier ws.send() throws",
      async () => {
        await using peer = await createPeer({
          respond: conn => (shrinkBuffers({ receiver: conn.socket }), response101(conn)),
        });
        const script = `
          const ws = new WebSocket(process.env.PEER_URL, { perMessageDeflate: false });
          ws.on("open", () => {
            // More than the kernel will buffer.
            shrinkBuffers({ sender: ws });
            ws.send(Buffer.alloc(${overflowSize}), () => {
              throw new Error("thrown by the callback");
            });
            if (${!isWindows} && ws.bufferedAmount === 0) console.log("nothing was buffered");
            const duplex = createWebSocketStream(ws);
            for (const name of ["finish", "end", "close"]) duplex.on(name, () => console.log(name));
            duplex.resume();
            duplex.end("last");
          });
        `;
        const child = runScript({ specifier }, script, { PEER_URL: peer.url });
        const conn = await peer.connection();
        expect(await conn.nextFrames(2)).toEqual([`binary ${overflowSize} bytes`, 'binary "last"']);
        conn.close();
        conn.end();
        expect((await child).lines).toEqual(['uncaught Error "thrown by the callback"', "finish", "end", "close"]);
      },
      scriptTimeout,
    );

    test("write() after ws.close() fails and destroys the stream, which terminates the socket", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      ws.close();
      const closed = nextEvent(duplex, "close");
      expect(await write(duplex, "x")).toBe('Error "WebSocket is not open: readyState 2 (CLOSING)"');
      await closed;
      expect(events).toEqual(['error Error "WebSocket is not open: readyState 2 (CLOSING)"', "close"]);
      expect(client.events.at(-1)).toBe("close 1006 Buffer() rs=3");
      expect(await conn.remainingFrames()).toEqual(["close"]);
    });

    test("write() fails when the socket is CLOSED", async () => {
      await using client = await openClient(implementation);
      const duplex = createWebSocketStream(client.ws);
      const events = watchStream(duplex);
      client.conn.close(1000);
      client.conn.end();
      await client.closed;
      const closed = nextEvent(duplex, "close");
      expect(await write(duplex, "too late")).toBe('Error "WebSocket is not open: readyState 3 (CLOSED)"');
      await closed;
      expect(events).toEqual(['error Error "WebSocket is not open: readyState 3 (CLOSED)"', "close"]);
    });
  });

  describe("destroy()", () => {
    test("terminates the socket: CLOSING immediately, FIN without a Close frame, then only 'close'", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      duplex.destroy();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await nextEvent(duplex, "close");
      expect(events).toEqual(["close"]);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(client.events.at(-1)).toBe("close 1006 Buffer() rs=3");
      expect(await conn.remainingFrames()).toEqual([]);
      expect(conn.socketEvents).toEqual(["end"]);
    });

    test("with an error, emits it as 'error' once the socket is CLOSED, then 'close'", async () => {
      await using client = await openClient(implementation);
      const duplex = createWebSocketStream(client.ws);
      const events = watchStream(duplex);
      const states: number[] = [];
      duplex.on("error", () => states.push(client.ws.readyState));
      duplex.destroy(new Error("mine"));
      await nextEvent(duplex, "close");
      expect(events).toEqual(['error Error "mine"', "close"]);
      expect(states).toEqual([WebSocket.CLOSED]);
    });
  });

  describe("when the socket emits 'error'", () => {
    test("a refused connection emits the socket's error as 'error', then 'close'", async () => {
      const ws = new WebSocket("ws://127.0.0.1:" + (await closedPort()));
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      await nextEvent(duplex, "close");
      expect(events).toEqual(['error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED', "close"]);
      expect(duplex.destroyed).toBe(true);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    test.concurrent(
      "the error is thrown when the stream has no 'error' listener",
      async () => {
        const script = `createWebSocketStream(new WebSocket(process.env.PEER_URL)).on("close", () => console.log("close"));`;
        const PEER_URL = "ws://127.0.0.1:" + (await closedPort());
        expect(await runScript({ specifier }, script, { PEER_URL })).toEqual({
          lines: ['uncaught Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED', "close"],
          stderr: "",
          exitCode: 0,
        });
      },
      scriptTimeout,
    );

    test("a protocol error still sends the Close frame", async () => {
      await using client = await openClient(implementation);
      const duplex = createWebSocketStream(client.ws);
      const events = watchStream(duplex);
      const closed = nextEvent(duplex, "close");
      client.conn.send(3, "reserved");
      expect(await client.conn.next()).toBe("close 1002");
      client.conn.end();
      await closed;
      expect(events).toEqual([
        'error RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE',
        "close",
      ]);
    });
  });

  describe("on a server socket", () => {
    test("reads and writes", async () => {
      await using server = await openServer(implementation);
      const duplex = createWebSocketStream(server.ws, { encoding: "utf8" });
      const received = readChunks(duplex, 1);
      server.client.text("in");
      expect(await received).toEqual(['"in"']);
      duplex.write("out");
      expect(await server.client.next()).toBe('binary "out"');
    });

    test("'finish' follows the closing handshake and doesn't wait for the client's FIN", async () => {
      await using server = await openServer(implementation, {}, { allowHalfOpen: true });
      const { ws, client } = server;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      duplex.resume();
      const finished = nextEvent(duplex.end(), "finish");
      expect(await client.next()).toBe("close");
      client.close();
      await finished;
      expect(events).toEqual(["finish"]);
      expect(ws.readyState).toBe(WebSocket.CLOSING);

      client.end();
      await nextEvent(duplex, "close");
      expect(events).toEqual(["finish", "end", "close"]);
    });

    test("write() fails after the client disconnected", async () => {
      await using server = await openServer(implementation);
      const duplex = createWebSocketStream(server.ws);
      const events = watchStream(duplex);
      server.client.destroy();
      await server.closed;
      const closed = nextEvent(duplex, "close");
      expect(await write(duplex, "too late")).toBe('Error "WebSocket is not open: readyState 3 (CLOSED)"');
      await closed;
      expect(events).toEqual(['error Error "WebSocket is not open: readyState 3 (CLOSED)"', "close"]);
    });

    test("pipeline(duplex, duplex) echoes and finishes without an error when the client closes", async () => {
      await using server = await openServer(implementation);
      const { client } = server;
      const duplex = createWebSocketStream(server.ws);
      const done = new Promise<string>(resolve => pipeline(duplex, duplex, error => resolve(show(error))));
      client.text("a");
      client.binary("b");
      expect(await client.nextFrames(2)).toEqual(['binary "a"', 'binary "b"']);
      client.close();
      expect(await done).toBe("undefined");
      expect(await client.remainingFrames()).toEqual(["close"]);
      expect(server.events.at(-1)).toBe("close 1005 Buffer() rs=3");
    });
  });

  test("a client stream and a server stream, end to end", async () => {
    await using server = await createServer(implementation);
    const pipelineResult = new Promise<string>(resolve =>
      server.wss.on("connection", ws => {
        const duplex = createWebSocketStream(ws);
        pipeline(duplex, duplex, error => resolve(show(error)));
      }),
    );
    const ws = new WebSocket("ws://127.0.0.1:" + server.port);
    try {
      const duplex = createWebSocketStream(ws, { encoding: "utf8" });
      const events = watchStream(duplex);
      const received = readChunks(duplex, 2);
      duplex.write("a");
      duplex.write("b");
      expect(await received).toEqual(['"a"', '"b"']);
      duplex.end();
      await nextEvent(duplex, "close");
      expect(events).toEqual(["finish", "end", "close"]);
      expect(await pipelineResult).toBe("undefined");
    } finally {
      ws.on("error", () => {}).terminate();
    }
  });
});
