import { describe, expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { createSecureServer } from "node:http2";
import type { AddressInfo } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { duplexPair, Writable } from "node:stream";
import { createServer as createTLSServer, connect as tlsConnect } from "node:tls";

test("aborting a connection settles every queued pipelined response callback once", async () => {
  const queued = Promise.withResolvers<void>();
  const callbacksDone = Promise.withResolvers<void>();
  const queuedResponsesClosed = Promise.withResolvers<void>();
  const events: string[] = [];
  const callbackErrors: Error[] = [];
  let callbacksRemaining = 6;
  let closesRemaining = 2;

  const callback = (name: string) => (error?: Error | null) => {
    events.push(name);
    if (error) callbackErrors.push(error);
    if (--callbacksRemaining === 0) callbacksDone.resolve();
  };
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/a") return;

    const prefix = req.url!.slice(1);
    res.on("close", () => {
      events.push(`${prefix}:close`);
      if (--closesRemaining === 0) queuedResponsesClosed.resolve();
    });
    res.writeContinue(callback(`${prefix}:continue`));
    res.write("body", callback(`${prefix}:write`));
    res.end("end", callback(`${prefix}:end`));
    if (req.url === "/c") queued.resolve();
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const client = connect((server.address() as AddressInfo).port, "127.0.0.1");
  client.on("error", () => {});

  try {
    await new Promise<void>(resolve => client.once("connect", resolve));
    client.write(
      "GET /a HTTP/1.1\r\nHost: localhost\r\n\r\n" +
        "GET /b HTTP/1.1\r\nHost: localhost\r\n\r\n" +
        "GET /c HTTP/1.1\r\nHost: localhost\r\n\r\n",
    );
    await queued.promise;
    client.destroy();
    await Promise.all([callbacksDone.promise, queuedResponsesClosed.promise]);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(events.filter(event => !event.endsWith(":close")).sort()).toEqual([
      "b:continue",
      "b:end",
      "b:write",
      "c:continue",
      "c:end",
      "c:write",
    ]);
    expect(callbackErrors).toHaveLength(6);
    expect(new Set(callbackErrors).size).toBe(1);
    expect(callbackErrors[0]).toMatchObject({ code: "ERR_STREAM_DESTROYED" });
    for (const prefix of ["b", "c"]) {
      for (const operation of ["continue", "write", "end"]) {
        expect(events.indexOf(`${prefix}:close`)).toBeGreaterThan(events.indexOf(`${prefix}:${operation}`));
      }
    }
  } finally {
    client.destroy();
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});

test("a request body that was put back on its socket before emit('connection') is delivered whole to a listener that reads it after an await", async () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  const server = createServer(async (req, res) => {
    await null;
    let bytes = 0;
    const slow = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        bytes += chunk.length;
        setImmediate(callback);
      },
    });
    req.pipe(slow).on("finish", () => resolve(bytes));
    res.end();
  });
  const front = createNetServer(socket => {
    socket.once("data", first => {
      socket.pause();
      socket.unshift(first);
      server.emit("connection", socket);
      socket.resume();
    });
  });
  front.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => front.once("listening", resolve));
  const client = connect((front.address() as AddressInfo).port, "127.0.0.1");
  try {
    client.on("error", () => {}).resume();
    client.write(
      "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n" +
        Array.from("abcd", fill => `400\r\n${fill.repeat(1024)}\r\n`).join("") +
        "0\r\n\r\n",
    );
    expect(await promise).toBe(4096);
  } finally {
    client.destroy();
    server.closeAllConnections();
    front.close();
  }
});

type Reader = (req: IncomingMessage, res: ServerResponse, take: (chunk: Buffer) => void, end: () => void) => void;
const readers: [string, Reader][] = [
  [
    "pipe() into a slow Writable",
    (req, _res, take, end) => {
      req.on("end", end).pipe(
        new Writable({
          highWaterMark: 1,
          write(chunk, _encoding, callback) {
            take(chunk);
            setImmediate(callback);
          },
        }),
      );
    },
  ],
  [
    "on('data') and pause()",
    (req, _res, take, end) => {
      req.on("end", end).on("data", chunk => {
        take(chunk);
        req.pause();
        setImmediate(() => req.resume());
      });
    },
  ],
  [
    "once('data') then pause(), and the rest once the response has closed",
    (req, res, take, end) => {
      req.once("data", chunk => {
        take(chunk);
        req.pause();
      });
      res.on("close", () => setImmediate(() => req.on("end", end).on("data", take).resume()));
    },
  ],
];
test.each(readers.flatMap(([how, read]) => [true, false].map(flowing => [how, flowing, read] as const)))(
  "a request body on a stream that is not a socket is delivered whole to a listener that reads it at once with %s and answers (stream flowing: %p)",
  async (_, flowing, read) => {
    const { promise, resolve } = Promise.withResolvers<{ bytes: number; end: boolean }>();
    const server = createServer((req, res) => {
      const seen = { bytes: 0, end: false };
      req.on("close", () => setImmediate(resolve, seen));
      read(
        req,
        res,
        chunk => (seen.bytes += chunk.length),
        () => (seen.end = true),
      );
      res.end("ok");
    });
    const [clientSide, serverSide] = duplexPair();
    server.emit("connection", serverSide);
    try {
      clientSide.on("error", () => {}).resume();
      // The server's side flows from the next tick on.
      if (flowing) await new Promise(resolve => setImmediate(resolve));
      clientSide.write(
        "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n" +
          Array.from("abcd", fill => `400\r\n${fill.repeat(1024)}\r\n`).join("") +
          "0\r\n\r\n",
      );
      expect(await promise).toEqual({ bytes: 4096, end: true });
    } finally {
      clientSide.destroy();
      server.closeAllConnections();
    }
  },
);

describe.each(["emit('connection')", "emit('connection') with a TLS socket", "allowHTTP1", "listen()"] as const)(
  "over %s",
  kind => {
    test.each([false, true])(
      "a response that never gets its turn emits no 'finish', and its end() callback gets an error (a CONNECT request behind it: %p)",
      async withConnect => {
        const events: string[] = [];
        const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
        const onRequest = (req: IncomingMessage, res: ServerResponse) => {
          if (req.url === "/0") {
            req.socket.on("close", () => setImmediate(onClosed));
            res.writeHead(204).end();
            return;
          }
          for (const event of ["finish", "close"]) res.on(event, () => events.push(`${req.url} ${event}`));
          if (req.url === "/1") req.socket.end();
          else
            res.end("body", (error?: NodeJS.ErrnoException) => events.push(`${req.url} end() ${error?.code ?? "ok"}`));
        };
        const server =
          kind === "allowHTTP1"
            ? createSecureServer({ ...tlsCert, allowHTTP1: true }, onRequest as any)
            : createServer(onRequest);
        server.on("connect", (_req, socket) => {
          events.push("connect");
          socket.on("error", () => {});
        });
        const front =
          kind === "emit('connection')"
            ? createNetServer(socket => server.emit("connection", socket))
            : kind === "emit('connection') with a TLS socket"
              ? createTLSServer(tlsCert, socket => server.emit("connection", socket))
              : server;
        await once(front.listen(0, "127.0.0.1"), "listening");
        const { port } = front.address() as AddressInfo;
        const client =
          kind === "emit('connection')" || kind === "listen()"
            ? connect(port, "127.0.0.1")
            : tlsConnect({
                port,
                host: "127.0.0.1",
                ca: tlsCert.cert,
                servername: "localhost",
                ALPNProtocols: ["http/1.1"],
              });
        try {
          client.on("error", () => {}).on("end", () => client.destroy());
          client
            .resume()
            .write(
              "GET /0 HTTP/1.1\r\nHost: localhost\r\n\r\n" +
                "POST /1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello" +
                "POST /2 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\n\r\nhello" +
                (withConnect ? "CONNECT localhost:1 HTTP/1.1\r\nHost: localhost:1\r\n\r\n" : ""),
            );
          await closed;
          // uWS parses nothing behind the request whose handler ended the socket.
          if (kind === "listen()") expect(events).toEqual(["/1 close"]);
          else {
            expect(events).toEqual([
              ...(withConnect ? ["connect"] : []),
              "/1 close",
              "/2 end() ERR_STREAM_DESTROYED",
              "/2 close",
            ]);
          }
        } finally {
          client.destroy();
          front.close();
          server.close();
        }
      },
    );
  },
);
