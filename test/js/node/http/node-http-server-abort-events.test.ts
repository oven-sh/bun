/**
 * This test must also pass in Node.js.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import type { IncomingMessage, Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { connect } from "node:net";

test("aborted request body emits 'error' ECONNRESET and res 'close' before req 'close'", async () => {
  // Like Node.js's socketOnClose → abortIncoming: the aborted request is
  // destroyed with ConnResetException after res 'close' has been scheduled.
  const events: string[] = [];
  const { promise: gotRequest, resolve: resolveRequest } = Promise.withResolvers<void>();
  const { promise: reqClosed, resolve: resolveReqClosed } = Promise.withResolvers<void>();
  const { promise: resClosed, resolve: resolveResClosed } = Promise.withResolvers<void>();

  const server = createServer((req, res) => {
    req.on("aborted", () => events.push("req.aborted"));
    req.on("error", e => events.push("req.error:" + (e as NodeJS.ErrnoException).code));
    req.on("close", () => {
      events.push("req.close");
      resolveReqClosed();
    });
    res.on("close", () => {
      events.push("res.close");
      resolveResClosed();
    });
    req.on("data", () => {});
    resolveRequest();
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const client = connect(port, "127.0.0.1");
    client.on("error", () => {});
    await once(client, "connect");
    client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\npartial");
    await gotRequest;
    client.destroy();
    await Promise.all([reqClosed, resClosed]);

    expect(events).toEqual(["req.aborted", "res.close", "req.error:ECONNRESET", "req.close"]);
  } finally {
    server.close();
  }
});

// A handler that answers before the request body has been received (the usual
// shape of an early 413/401/redirect). Node keeps parsing the rest of the body
// in the background: the IncomingMessage is only complete ('end', then 'close',
// req.complete === true) once the body has actually arrived, a consumer
// attached before or in the same tick as res.end() still gets every byte, and
// a connection that drops mid-body leaves the request as it was.
describe("request body arriving after the response was ended", () => {
  function reqState(req: IncomingMessage) {
    return { complete: req.complete, readableEnded: req.readableEnded, destroyed: req.destroyed, aborted: req.aborted };
  }

  async function listen(server: Server) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return (server.address() as AddressInfo).port;
  }

  // A raw client so the request body can be sent in pieces.
  async function rawClient(port: number) {
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let received = "";
    let onData: (() => void) | undefined;
    socket.on("data", chunk => {
      received += chunk;
      onData?.();
    });
    await once(socket, "connect");
    return {
      socket,
      write: (data: string) => new Promise<void>(resolve => socket.write(data, () => resolve())),
      // Resolves once the response body `marker` has been received; the
      // response is on the wire before the server-side request can complete.
      async response(marker: string) {
        while (!received.includes(marker)) {
          await new Promise<void>(resolve => (onData = resolve));
        }
        const out = received;
        received = "";
        return out;
      },
    };
  }

  function closeServer(server: Server) {
    // Resolves only once every request has been released by the server; a
    // request that is never accounted as finished hangs this (and the test).
    return new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  }

  test("req completes with 'end' then 'close' once the rest of the body arrives, not at res.end()", async () => {
    const events: string[] = [];
    const { promise: request, resolve: gotRequest } = Promise.withResolvers<IncomingMessage>();
    const { promise: reqClosed, resolve: resolveReqClosed } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      req.on("aborted", () => events.push("aborted"));
      req.on("end", () => events.push("end"));
      req.on("close", () => {
        events.push("close");
        resolveReqClosed();
      });
      res.end("first");
      gotRequest(req);
    });
    try {
      const client = await rawClient(await listen(server));
      await client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 6\r\n\r\nabc");
      const req = await request;
      await client.response("first");

      // Half of the body is still outstanding: the message is not complete.
      expect({ ...reqState(req), events: [...events] }).toEqual({
        complete: false,
        readableEnded: false,
        destroyed: false,
        aborted: false,
        events: [],
      });

      await client.write("def");
      await reqClosed;
      expect({ ...reqState(req), events }).toEqual({
        complete: true,
        readableEnded: true,
        destroyed: true,
        aborted: false,
        events: ["end", "close"],
      });

      // The trailing body bytes were consumed as body, so the kept-alive
      // connection is still in sync for the next request.
      await client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      expect(await client.response("first")).toStartWith("HTTP/1.1 200 OK");

      client.socket.destroy();
      await closeServer(server);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("a connection dropped mid-body after the response leaves req incomplete and emits nothing", async () => {
    const events: string[] = [];
    const { promise: request, resolve: gotRequest } = Promise.withResolvers<IncomingMessage>();
    const { promise: serverSocketClosed, resolve: resolveServerSocketClosed } = Promise.withResolvers<void>();
    const server = createServer((req, res) => {
      for (const name of ["aborted", "end", "close", "error"]) req.on(name, () => events.push(name));
      (req.socket as Socket).on("close", () => resolveServerSocketClosed());
      res.end("first");
      gotRequest(req);
    });
    // The half-sent body makes the peer's close a parse error on the
    // connection ('clientError', like Node); the connection is already gone.
    server.on("clientError", (_err, socket) => socket.destroy());
    try {
      const client = await rawClient(await listen(server));
      await client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 6\r\n\r\nabc");
      const req = await request;
      await client.response("first");

      client.socket.destroy();
      await serverSocketClosed;
      // Like Node's socketOnClose, only requests whose response has not
      // finished are aborted; this one is simply left incomplete.
      await closeServer(server);
      expect({ ...reqState(req), events, socketDestroyed: req.socket.destroyed }).toEqual({
        complete: false,
        readableEnded: false,
        destroyed: false,
        aborted: false,
        events: [],
        socketDestroyed: true,
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  // Issues #4733 and #18613: the body is lost when res.end() runs
  // synchronously in the handler, whether it was in the same packet as the
  // headers (curl -d) or is still in flight.
  test.each([
    ["in the same packet as the headers", "hello", ""],
    ["still in flight", "he", "llo"],
  ])("a 'data' listener attached before a synchronous res.end() receives a body %s", async (_, first, rest) => {
    const { promise: body, resolve: resolveBody } = Promise.withResolvers<object>();
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => resolveBody({ body: Buffer.concat(chunks).toString(), ...reqState(req) }));
      res.end("first");
    });
    try {
      const client = await rawClient(await listen(server));
      await client.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\n${first}`);
      await client.response("first");
      if (rest) await client.write(rest);
      expect(await body).toEqual({
        body: "hello",
        complete: true,
        readableEnded: true,
        destroyed: false,
        aborted: false,
      });
      client.socket.destroy();
      await closeServer(server);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("a consumer attached in the same tick after res.end() still receives the body", async () => {
    // Node decides whether to dump an unread body on the response's 'finish'
    // (resOnFinish), so a listener attached right after res.end() counts.
    const { promise: body, resolve: resolveBody } = Promise.withResolvers<object>();
    const server = createServer((req, res) => {
      res.end("first");
      const chunks: Buffer[] = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => resolveBody({ body: Buffer.concat(chunks).toString(), complete: req.complete }));
    });
    try {
      const client = await rawClient(await listen(server));
      await client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhe");
      await client.response("first");
      await client.write("llo");
      expect(await body).toEqual({ body: "hello", complete: true });
      client.socket.destroy();
      await closeServer(server);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("req.pause()/resume() keep working for a body arriving after the response", async () => {
    const { promise: request, resolve: gotRequest } = Promise.withResolvers<IncomingMessage>();
    const { promise: firstChunk, resolve: gotFirstChunk } = Promise.withResolvers<void>();
    const { promise: body, resolve: resolveBody } = Promise.withResolvers<object>();
    const server = createServer((req, res) => {
      res.end("first");
      const chunks: Buffer[] = [];
      req.on("data", chunk => {
        chunks.push(chunk);
        if (chunks.length === 1) {
          req.pause();
          gotFirstChunk();
        }
      });
      req.on("end", () => resolveBody({ body: Buffer.concat(chunks).toString(), complete: req.complete }));
      gotRequest(req);
    });
    try {
      const client = await rawClient(await listen(server));
      await client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 9\r\n\r\n");
      const req = await request;
      await client.response("first");
      await client.write("abc");
      await firstChunk;
      expect(req.isPaused()).toBe(true);
      await client.write("defghi");
      req.resume();
      expect(await body).toEqual({ body: "abcdefghi", complete: true });
      client.socket.destroy();
      await closeServer(server);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  // The body outliving the response must not leave anything holding the event
  // loop open: the process has to exit on its own both when the body does
  // arrive later (with the connection then reused, so the early request is no
  // longer the connection's current one when it closes) and when the client
  // goes away mid-body instead.
  test.concurrent.each(["complete", "abort"])(
    "process exits on its own after an early response (%s)",
    async mode => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
        const { createServer } = require("node:http");
        const { connect } = require("node:net");
        const server = createServer((req, res) => {
          if (req.url === "/early") {
            req.on("close", () => console.log("req close complete=" + req.complete));
            req.socket.on("close", () => console.log("socket close complete=" + req.complete));
          }
          res.end("ok:" + req.url);
        });
        server.listen(0, "127.0.0.1", () => {
          const client = connect(server.address().port, "127.0.0.1");
          let received = "";
          client.on("data", chunk => {
            received += chunk;
            if (received.endsWith("ok:/early")) {
              received = "";
              if (${JSON.stringify(mode)} === "abort") {
                client.destroy();
                server.close(() => console.log("server closed"));
              } else {
                client.write("def");
                client.write("GET /second HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
              }
            } else if (received.endsWith("ok:/second")) {
              client.end();
              server.close(() => console.log("server closed"));
            }
          });
          client.write("POST /early HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: 6\\r\\n\\r\\nabc");
        });
        `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim().split("\n").sort()).toEqual(
        mode === "abort"
          ? ["server closed", "socket close complete=false"]
          : ["req close complete=true", "server closed", "socket close complete=true"],
      );
      expect(exitCode).toBe(0);
    },
    30_000,
  );
});
