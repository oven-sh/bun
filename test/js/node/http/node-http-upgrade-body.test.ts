import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tls as tlsKeys } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http, { type IncomingMessage, type ServerOptions } from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import tls from "node:tls";

// Node.js emits 'upgrade' when it has parsed the read that carried the request. The request then holds the part of
// the body that came with its head, and `head` is what follows the body in that read. Every expected value is what
// Node.js v26.3.0 gives for the same bytes, but where a test says otherwise.
describe("the 'upgrade' event of a request with a body", () => {
  const head = "POST / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: test\r\n";
  const fixed = `${head}Content-Length: 5\r\n\r\n`;
  const chunked = `${head}Transfer-Encoding: chunked\r\n\r\n`;

  type Seen = {
    // What the listener got.
    head: string;
    complete: boolean;
    readableLength: number;
    trailers: NodeJS.Dict<string>;
    // What the request and the upgrade socket gave it afterwards.
    body: string;
    tunnel: string;
  };
  type Send = (client: net.Socket, upgraded: Promise<void>) => Promise<void>;
  type Options = ServerOptions & {
    onUpgrade?: (req: IncomingMessage, socket: Duplex) => void;
    // false: the listener reads the socket and not the request.
    readRequest?: boolean;
  };

  const inOneRead = (bytes: string): Send => {
    return async client => void client.write(bytes);
  };
  // The second write goes out when the listener has run, so it comes in a later read.
  const thenInALaterRead = (first: string, later: string): Send => {
    return async (client, upgraded) => {
      client.write(first);
      await upgraded;
      client.write(later);
    };
  };
  // The head takes two reads when the server reads the first write before the second one goes out. When it does
  // not, one read carries everything, and the expected values are the same.
  const headInTwoReads = (bytes: string, cut: number): Send => {
    return async client => {
      const { promise: sent, resolve } = Promise.withResolvers<void>();
      client.write(bytes.slice(0, cut), () => setImmediate(() => setImmediate(resolve)));
      await sent;
      client.write(bytes.slice(cut));
    };
  };

  /** Serves one Upgrade request. The client ends when it has sent everything, and the server answers that with its own end. */
  async function upgrade(secure: boolean, send: Send, options: Options = {}): Promise<Seen> {
    const { onUpgrade, readRequest = true, ...serverOptions } = options;
    const { promise, resolve, reject } = Promise.withResolvers<Seen>();
    const upgraded = Promise.withResolvers<void>();
    const server = secure
      ? https.createServer({ ...tlsKeys, ...serverOptions })
      : http.createServer({ ...serverOptions });
    server.on("upgrade", (req, socket, head) => {
      const seen: Seen = {
        head: head.toString(),
        complete: req.complete,
        readableLength: req.readableLength,
        trailers: { ...req.trailers },
        body: "",
        tunnel: "",
      };
      if (readRequest) req.on("data", chunk => (seen.body += chunk));
      socket.on("data", chunk => (seen.tunnel += chunk));
      socket.on("error", reject);
      socket.on("end", () => socket.end());
      socket.on("close", () => resolve(seen));
      onUpgrade?.(req, socket);
      upgraded.resolve();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const address = { port: (server.address() as AddressInfo).port, host: "127.0.0.1" };
    // Half-open: the end of the server's side does not end the client's side.
    const client = secure
      ? tls.connect({ ...address, rejectUnauthorized: false })
      : net.connect({ ...address, allowHalfOpen: true });
    client.on("error", reject);
    client.resume();
    try {
      await Promise.race([once(client, secure ? "secureConnect" : "connect"), promise]);
      await Promise.race([send(client, upgraded.promise), promise]);
      await Promise.race([upgraded.promise, promise]);
      client.end();
      return await promise;
    } finally {
      client.destroy();
      server.close();
    }
  }

  const wholeBodyAndMore: Seen = {
    head: "AFTER",
    complete: true,
    readableLength: 5,
    trailers: {},
    body: "HELLO",
    tunnel: "",
  };
  const rows: [string, Send, Seen][] = [
    ["a Content-Length body and the bytes behind it", inOneRead(fixed + "HELLOAFTER"), wholeBodyAndMore],
    [
      "a chunked body with a trailer and the bytes behind it",
      inOneRead(chunked + "5\r\nHELLO\r\n0\r\nX-Trailer: t\r\n\r\nAFTER"),
      { ...wholeBodyAndMore, trailers: { "x-trailer": "t" } },
    ],
    ["the whole body and nothing behind it", inOneRead(fixed + "HELLO"), { ...wholeBodyAndMore, head: "" }],
    [
      "a part of the body",
      thenInALaterRead(fixed + "HE", "LLOAFTER"),
      { head: "", complete: false, readableLength: 2, trailers: {}, body: "HELLO", tunnel: "AFTER" },
    ],
    [
      "nothing of the body",
      thenInALaterRead(fixed, "HELLOAFTER"),
      { head: "", complete: false, readableLength: 0, trailers: {}, body: "HELLO", tunnel: "AFTER" },
    ],
    [
      "the rest of a head that took two reads, the body and the bytes behind it",
      headInTwoReads(fixed + "HELLOAFTER", 20),
      wholeBodyAndMore,
    ],
    [
      "the body and the bytes behind it, with more bytes of the tunnel in a later read",
      thenInALaterRead(fixed + "HELLOAFTER", "MORE"),
      { ...wholeBodyAndMore, tunnel: "MORE" },
    ],
  ];
  describe.each([
    ["http", false],
    ["https", true],
  ] as const)("over %s, when the read of the head carries", (_transport, secure) => {
    test.concurrent.each(rows)("%s", async (_what, send, expected) => {
      expect(await upgrade(secure, send)).toEqual(expected);
    });
  });

  test.concurrent("a body above the highWaterMark of the request is whole before the listener runs", async () => {
    const [first, second] = [Buffer.alloc(1024, "a").toString(), Buffer.alloc(1024, "b").toString()];
    const send = inOneRead(`${chunked}400\r\n${first}\r\n400\r\n${second}\r\n0\r\n\r\nAFTER`);
    expect(await upgrade(false, send, { highWaterMark: 1024 })).toEqual({
      head: "AFTER",
      complete: true,
      readableLength: 2048,
      trailers: {},
      body: first + second,
      tunnel: "",
    });
  });

  test.concurrent("a read of the socket leaves a complete request as it is", async () => {
    let request: IncomingMessage | undefined;
    const onUpgrade = (req: IncomingMessage) => void (request = req);
    const send = thenInALaterRead(fixed + "HELLOAFTER", "MORE");
    const { tunnel } = await upgrade(false, send, { onUpgrade, readRequest: false });
    expect({ tunnel, readableLength: request?.readableLength, readableFlowing: request?.readableFlowing }).toEqual({
      tunnel: "MORE",
      readableLength: 5,
      readableFlowing: null,
    });
  });

  test.concurrent(
    "a request that shouldUpgradeCallback paused is complete in the listener and stays paused",
    async () => {
      const shouldUpgradeCallback = (req: IncomingMessage) => {
        req.pause();
        return true;
      };
      expect(await upgrade(false, inOneRead(fixed + "HELLOAFTER"), { shouldUpgradeCallback })).toEqual({
        ...wholeBodyAndMore,
        body: "",
      });
    },
  );

  // Not as Node.js here. A request that shouldUpgradeCallback began to read has a reader before its 'upgrade', and
  // that reader would get the end of the request inside the read. So the event does not wait for the read: the
  // listener gets no head, and the bytes behind the body reach the socket. Node.js: head "AFTER", complete.
  const readers: [string, (req: IncomingMessage, order: string[]) => void, string[]][] = [
    [
      "'data'",
      (req, order) => void req.on("data", chunk => order.push(`data ${chunk}`)),
      ["upgrade", "data HELLO", "end"],
    ],
    [
      "'readable'",
      (req, order) =>
        void req.on("readable", () => {
          const chunk = req.read();
          if (chunk !== null) order.push(`readable ${chunk}`);
        }),
      ["upgrade", "readable HELLO", "end"],
    ],
  ];
  test.concurrent.each(readers)(
    "a request that shouldUpgradeCallback reads with %s gets its 'upgrade' first",
    async (_event, read, expected) => {
      const order: string[] = [];
      const shouldUpgradeCallback = (req: IncomingMessage) => {
        read(req, order);
        req.on("end", () => order.push("end"));
        return true;
      };
      const onUpgrade = () => void order.push("upgrade");
      const seen = await upgrade(false, inOneRead(fixed + "HELLOAFTER"), { shouldUpgradeCallback, onUpgrade });
      expect({ order, ...seen }).toEqual({
        order: expected,
        head: "",
        complete: false,
        readableLength: 0,
        trailers: {},
        body: "HELLO",
        tunnel: "AFTER",
      });
    },
  );

  // The listener gets the request once, also when the socket does not live to the end of the read.
  const stops: [string, (req: IncomingMessage) => void, { request: boolean; socket: boolean; writable: boolean }][] = [
    ["destroys the request", req => void req.destroy(), { request: true, socket: true, writable: false }],
    [
      "destroys the socket in a tick",
      req => void process.nextTick(() => req.socket.destroy()),
      { request: false, socket: true, writable: false },
    ],
    [
      "ends the socket in a tick",
      req => void process.nextTick(() => req.socket.end()),
      { request: false, socket: false, writable: false },
    ],
  ];
  test.concurrent.each(stops)(
    "a shouldUpgradeCallback that %s still gets its 'upgrade'",
    async (_what, stop, expected) => {
      const upgrades: object[] = [];
      const shouldUpgradeCallback = (req: IncomingMessage) => {
        stop(req);
        return true;
      };
      const onUpgrade = (req: IncomingMessage, socket: Duplex) => {
        upgrades.push({ request: req.destroyed, socket: socket.destroyed, writable: socket.writable });
      };
      await upgrade(false, inOneRead(fixed + "HELLOAFTER"), { shouldUpgradeCallback, onUpgrade });
      expect(upgrades).toEqual([expected]);
    },
  );

  test.concurrent(
    "a listener that destroys the socket gets the head first, and the request keeps its body",
    async () => {
      const onUpgrade = (_req: IncomingMessage, socket: Duplex) => void socket.destroy();
      expect(await upgrade(false, inOneRead(fixed + "HELLOAFTER"), { onUpgrade })).toEqual(wholeBodyAndMore);
    },
  );

  test.concurrent("a body that does not parse, in the read of the head, comes after 'upgrade'", async () => {
    const upgrades: object[] = [];
    const server = http.createServer();
    // With no 'clientError' listener the server answers 400 and destroys the socket.
    server.on("upgrade", (req, socket, head) => {
      upgrades.push({
        head: head.toString(),
        complete: req.complete,
        readableLength: req.readableLength,
        destroyed: socket.destroyed,
      });
      req.on("error", () => {});
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const client = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    try {
      client.on("error", () => {});
      client.resume();
      await once(client, "connect");
      client.write(`${chunked}5\r\nHELLO\r\nnot a chunk size\r\n`);
      await once(client, "close");
      expect(upgrades).toEqual([{ head: "", complete: false, readableLength: 5, destroyed: false }]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test.concurrent("the listener runs in the async context of listen()", async () => {
    const storage = new AsyncLocalStorage<string>();
    let store: string | undefined;
    const onUpgrade = () => void (store = storage.getStore());
    await storage.run("listen", () => upgrade(false, inOneRead(fixed + "HELLOAFTER"), { onUpgrade }));
    expect(store).toBe("listen");
  });
});

// The close of a tunnel gave the request body handler one more last chunk, also when the parser had given it one.
// From inside the delivery of that last chunk, the second one killed the process: "Segmentation fault at address
// 0x30", under ASAN "JSCast.h:182 member call on null pointer of type 'JSC::JSCell'".
describe("an Upgrade request with a body", () => {
  const fixture = path.join(import.meta.dir, "node-http-upgrade-body-fixture.js");
  const nativeLog = "[nodehttpresponse] ";

  async function run(options: Record<string, unknown>, env: Record<string, string | undefined> = bunEnv) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, JSON.stringify(options)],
      env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split("\n").filter(Boolean);
    const printed = lines.filter(line => !line.startsWith(nativeLog));
    return {
      // What the fixture printed, or the output of a child that died before it could.
      ...(printed.length === 1 && printed[0].startsWith("{") ? JSON.parse(printed[0]) : { stdout }),
      native: lines.filter(line => line.startsWith(nativeLog)).map(line => line.slice(nativeLog.length)),
      stderr,
      exitCode,
      signalCode: proc.signalCode,
    };
  }

  const exited = { stderr: "", exitCode: 0, signalCode: null };

  // The listener reads the 100-byte body and lets go when it has the last byte. `split`: the second half of the body
  // comes in a read of its own, so the listener lets go inside the delivery of the last chunk, and the request gets
  // its EOF once after that. Otherwise the whole body came with the head: the request has its EOF when the listener
  // runs (`eofs` 0), and it emits 'end' before 'close', as in Node.js v26.3.0.
  const reads = (split: boolean, read = "data") => (split ? [`req ${read} 50`, `req ${read} 50`] : [`req ${read} 100`]);
  const destroyed = (split: boolean, read = "data") => ({
    events: [...reads(split, read), "req aborted", ...(split ? [] : ["req end"]), "req close", "socket close"],
    eofs: split ? 1 : 0,
  });
  const ended = (split: boolean, ...after: string[]) => ({
    events: [...reads(split), "req end", "req close", ...after],
    eofs: split ? 1 : 0,
  });

  describe.each([
    ["with its head", false],
    ["in a read of its own", true],
  ] as const)("whose last chunk comes %s, when the listener lets go at the last byte", (_where, split) => {
    const rows: [name: string, options: Record<string, unknown>, expected: { events: string[]; eofs: number }][] = [
      ["req.destroy() in 'data'", { act: "req.destroy()" }, destroyed(split)],
      ["req.destroy() in 'readable'", { act: "req.destroy()", read: "readable" }, destroyed(split, "readable")],
      ["req.destroy() over TLS", { act: "req.destroy()", secure: true }, destroyed(split)],
      [
        "req.destroy(err)",
        { act: "req.destroy(err)" },
        {
          events: [
            ...reads(split),
            "req aborted",
            "req error: stop",
            "req close",
            "socket error: stop",
            "socket close",
          ],
          eofs: split ? 1 : 0,
        },
      ],
      ["socket.destroy(), then req.destroy()", { act: "socket.destroy() then req.destroy()" }, destroyed(split)],
      [
        "req.destroy(), then a throw",
        { act: "req.destroy() then throw" },
        {
          events: [
            ...reads(split),
            "req aborted",
            "uncaughtException: listener threw",
            ...(split ? [] : ["req end"]),
            "req close",
            "socket close",
          ],
          // Inside the last chunk, the throw leaves the callback before it gives the request its EOF.
          eofs: 0,
        },
      ],
      ["socket.destroy()", { act: "socket.destroy()" }, ended(split, "socket close")],
      ["socket.resetAndDestroy()", { act: "socket.resetAndDestroy()" }, ended(split, "socket close")],
      ["socket.destroySoon()", { act: "socket.destroySoon()" }, ended(split, "socket end", "socket close")],
      [
        "req.destroy() in 'readable', while a TLS write that spilled defers the close",
        { act: "req.destroy()", read: "readable", secure: true, spill: true },
        destroyed(split, "readable"),
      ],
    ];
    for (const [name, options, expected] of rows) {
      test.concurrent(name, async () => {
        expect(await run({ ...options, split })).toMatchObject({ ...expected, ...exited });
      });
    }
  });

  // Only a debug build prints what uws gives to the body handler of the request.
  describe.skipIf(!isDebug)("gets nothing from uws after its last chunk", () => {
    const rows: [name: string, options: Record<string, unknown>, events: string[]][] = [
      [
        "the close of the socket inside that chunk",
        { act: "socket.destroy()", split: true },
        ended(true, "socket close").events,
      ],
      [
        "bytes of the tunnel after socket.end() inside that chunk",
        { act: "socket.end()", split: true, tunnelBytes: "0123456789" },
        // The upgrade socket got the bytes, so uws did read them.
        ended(true, "socket data 10", "socket end", "socket close").events,
      ],
    ];
    for (const [name, options, events] of rows) {
      test.concurrent(name, async () => {
        // A BUN_DEBUG from the shell of the developer sends the log to a file. An empty one keeps it on stdout.
        const result = await run(options, { ...bunEnv, BUN_DEBUG: "", BUN_DEBUG_NodeHTTPResponse: "1" });
        const native = result.native.filter(line => line.startsWith("onData("));
        expect({ ...result, native }).toMatchObject({
          events,
          eofs: 1,
          native: ["onData(50 bytes, is_last = 0)", "onData(50 bytes, is_last = 1)"],
          ...exited,
        });
      });
    }
  });

  // These end the process when they go wrong, so each one runs in a process of its own.
  describe.each([
    ["http", false],
    ["https", true],
  ] as const)("whose whole body came with its head, over %s", (_transport, secure) => {
    test.concurrent("a listener that throws gets the request first", async () => {
      expect(await run({ listener: "throws", secure })).toMatchObject({
        events: ["uncaughtException: listener threw", "socket end", "socket close"],
        upgrade: { head: 0, complete: true, readableLength: 100 },
        ...exited,
      });
    });

    test.concurrent("the socket is destroyed when shouldUpgradeCallback accepts and no listener takes it", async () => {
      // The fixture prints when the server has seen the close of that socket.
      expect(await run({ listener: "none", secure })).toMatchObject({ events: [], ...exited });
    });
  });
});
