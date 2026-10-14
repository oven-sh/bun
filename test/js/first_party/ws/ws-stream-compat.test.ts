// createWebSocketStream(), against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { Duplex, pipeline } from "node:stream";
import {
  closedPort,
  createServer,
  dial,
  event,
  implementations,
  openClient,
  openServer,
  runScript,
  scriptTimeout,
  show,
  showError,
} from "./ws-raw-peer";

/** Records 'end', 'finish', 'close' and `error <error>` as lines. Does not make the stream flow. */
function watchStream(duplex: Duplex) {
  const events: string[] = [];
  for (const name of ["end", "finish", "close"]) duplex.on(name, () => events.push(name));
  duplex.on("error", error => events.push("error " + showError(error)));
  return events;
}

/** The next `count` chunks, through `show`. Makes the stream flow. */
function chunks(duplex: Duplex, count: number) {
  const seen: string[] = [];
  return new Promise<string[]>(resolve =>
    duplex.on("data", chunk => {
      if (seen.push(show(chunk)) === count) resolve(seen);
    }),
  );
}

/** `"written"`, or the error the callback of `write()` gets. */
function write(duplex: Duplex, chunk: string) {
  return new Promise<string>(resolve => duplex.write(chunk, error => resolve(error ? showError(error) : "written")));
}

describe.each(implementations)("createWebSocketStream ($name)", ({ ws: implementation, specifier }) => {
  const { WebSocket, createWebSocketStream } = implementation;

  test.each([
    { label: "without options", options: undefined },
    { label: "with objectMode and writableObjectMode", options: { objectMode: true, writableObjectMode: true } },
  ])("$label: a Duplex that is not in object mode", async ({ options }) => {
    await using client = await openClient(implementation);
    const duplex = createWebSocketStream(client.ws, options);
    expect(duplex).toBeInstanceOf(Duplex);
    expect([duplex.readableObjectMode, duplex.writableObjectMode]).toEqual([false, false]);
  });

  describe("reading", () => {
    test.each([
      {
        label: "by default every message is a Buffer",
        options: undefined,
        expected: ['Buffer("txt")', 'Buffer("bin")'],
      },
      {
        label: "readableObjectMode: a text message is a string",
        options: { readableObjectMode: true },
        expected: ['"txt"', 'Buffer("bin")'],
      },
      { label: "encoding: every message is a string", options: { encoding: "utf8" }, expected: ['"txt"', '"bin"'] },
    ] as const)("$label", async ({ options, expected }) => {
      await using client = await openClient(implementation);
      const seen = chunks(createWebSocketStream(client.ws, options), 2);
      client.conn.text("txt");
      client.conn.binary("bin");
      expect(await seen).toEqual([...expected]);
    });

    test("a full buffer pauses the socket, read() resumes it", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws, { highWaterMark: 16 });
      conn.binary(Buffer.alloc(64, "a"));
      await event(ws, "message");
      expect(ws.isPaused).toBe(true);
      conn.binary("next");

      expect(show(duplex.read())).toBe("Buffer(64 bytes)");
      expect(ws.isPaused).toBe(false);
      await event(ws, "message");
      expect(show(duplex.read())).toBe('Buffer("next")');
      expect(ws.isPaused).toBe(false);
    });

    test("the peer closes: the data, then 'end', and the writable side stays open until end()", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      const seen = chunks(duplex, 1);
      conn.text("bye");
      conn.close(1000);
      conn.end();
      await event(duplex, "end");
      expect(await seen).toEqual(['Buffer("bye")']);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(duplex.destroyed).toBe(false);

      duplex.end();
      await event(duplex, "close");
      expect(events).toEqual(["end", "finish", "close"]);
      expect(duplex.destroyed).toBe(true);
    });
  });

  describe("writing", () => {
    test("write() sends a binary frame, for a string too", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const duplex = createWebSocketStream(client.ws);
      expect(await write(duplex, "text")).toBe("written");
      duplex.write(Buffer.from([1, 2]));
      expect(await client.conn.take(2)).toEqual(['binary "text"', "binary 0x0102"]);
    });

    test("write() and end() while CONNECTING wait for 'open'", async () => {
      await using client = await dial(implementation, { perMessageDeflate: false });
      const duplex = createWebSocketStream(client.ws);
      duplex.write("first");
      duplex.write("second");
      duplex.end("last");
      expect(client.ws.readyState).toBe(WebSocket.CONNECTING);
      const conn = await client.peer.connection();
      expect(await conn.take(4)).toEqual(['binary "first"', 'binary "second"', 'binary "last"', "close"]);
    });

    test("end() sends an empty Close frame; 'finish', 'end' and 'close' follow the closing handshake", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      duplex.resume();
      duplex.end("last");
      expect(await conn.take(2)).toEqual(['binary "last"', "close"]);
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      expect(events).toEqual([]);

      conn.close(1000);
      conn.end();
      await event(duplex, "close");
      expect(events).toEqual(["finish", "end", "close"]);
      expect(duplex.destroyed).toBe(true);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    test("write() after ws.close() fails and destroys the stream, which terminates the socket", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      ws.close();
      const closed = event(duplex, "close");
      expect(await write(duplex, "x")).toBe('Error "WebSocket is not open: readyState 2 (CLOSING)"');
      await closed;
      expect(events).toEqual(['error Error "WebSocket is not open: readyState 2 (CLOSING)"', "close"]);
      expect(client.events.at(-1)).toBe("close 1006 Buffer() rs=3");
      expect(await conn.rest()).toEqual(["close"]);
    });

    test("write() on the stream of a CLOSED socket fails", async () => {
      await using client = await openClient(implementation);
      const duplex = createWebSocketStream(client.ws);
      const events = watchStream(duplex);
      client.conn.close(1000);
      client.conn.end();
      await client.closed;
      const closed = event(duplex, "close");
      expect(await write(duplex, "too late")).toBe('Error "WebSocket is not open: readyState 3 (CLOSED)"');
      await closed;
      expect(events).toEqual(['error Error "WebSocket is not open: readyState 3 (CLOSED)"', "close"]);
    });
  });

  describe("destroy()", () => {
    test("terminates the socket: CLOSING at once, FIN without a Close frame, then 'close' alone", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      duplex.destroy();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await event(duplex, "close");
      expect(events).toEqual(["close"]);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(client.events.at(-1)).toBe("close 1006 Buffer() rs=3");
      expect(await conn.rest()).toEqual([]);
      expect(conn.tcp).toEqual(["end"]);
    });

    test("with an error: 'error' with it once the socket is CLOSED, then 'close'", async () => {
      await using client = await openClient(implementation);
      const duplex = createWebSocketStream(client.ws);
      const events = watchStream(duplex);
      const states: number[] = [];
      duplex.on("error", () => states.push(client.ws.readyState));
      duplex.destroy(new Error("mine"));
      await event(duplex, "close");
      expect(events).toEqual(['error Error "mine"', "close"]);
      expect(states).toEqual([WebSocket.CLOSED]);
    });
  });

  describe("an 'error' of the socket", () => {
    test("a refused connection: 'error' with the socket's error, then 'close'", async () => {
      const ws = new WebSocket("ws://127.0.0.1:" + (await closedPort()));
      const duplex = createWebSocketStream(ws);
      const events = watchStream(duplex);
      await event(duplex, "close");
      expect(events).toEqual(['error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED', "close"]);
      expect(duplex.destroyed).toBe(true);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    test.concurrent(
      "without an 'error' listener on the stream it is thrown",
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

    test("a protocol error: the Close frame still goes out", async () => {
      await using client = await openClient(implementation);
      const duplex = createWebSocketStream(client.ws);
      const events = watchStream(duplex);
      const closed = event(duplex, "close");
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
      const seen = chunks(duplex, 1);
      server.client.text("in");
      expect(await seen).toEqual(['"in"']);
      duplex.write("out");
      expect(await server.client.next()).toBe('binary "out"');
    });

    test("write() after the client is gone fails", async () => {
      await using server = await openServer(implementation);
      const duplex = createWebSocketStream(server.ws);
      const events = watchStream(duplex);
      server.client.destroy();
      await server.closed;
      const closed = event(duplex, "close");
      expect(await write(duplex, "too late")).toBe('Error "WebSocket is not open: readyState 3 (CLOSED)"');
      await closed;
      expect(events).toEqual(['error Error "WebSocket is not open: readyState 3 (CLOSED)"', "close"]);
    });

    test("pipeline(duplex, duplex) echoes, and is done without an error when the client closes", async () => {
      await using server = await openServer(implementation);
      const { client } = server;
      const duplex = createWebSocketStream(server.ws);
      const done = new Promise<string>(resolve => pipeline(duplex, duplex, error => resolve(show(error))));
      client.text("a");
      client.binary("b");
      expect(await client.take(2)).toEqual(['binary "a"', 'binary "b"']);
      client.close();
      expect(await done).toBe("undefined");
      expect(await client.rest()).toEqual(["close"]);
      expect(server.events.at(-1)).toBe("close 1005 Buffer() rs=3");
    });
  });

  test("a client stream and a server stream, end to end", async () => {
    await using server = await createServer(implementation);
    const served = new Promise<string>(resolve =>
      server.wss.on("connection", ws => {
        const duplex = createWebSocketStream(ws);
        pipeline(duplex, duplex, error => resolve(show(error)));
      }),
    );
    const ws = new WebSocket("ws://127.0.0.1:" + server.port);
    try {
      const duplex = createWebSocketStream(ws, { encoding: "utf8" });
      const events = watchStream(duplex);
      const seen = chunks(duplex, 2);
      duplex.write("a");
      duplex.write("b");
      expect(await seen).toEqual(['"a"', '"b"']);
      duplex.end();
      await event(duplex, "close");
      expect(events).toEqual(["finish", "end", "close"]);
      expect(await served).toBe("undefined");
    } finally {
      ws.on("error", () => {}).terminate();
    }
  });
});
