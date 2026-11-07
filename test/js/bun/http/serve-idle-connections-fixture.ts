// Fixture for bun-server.test.ts. Each scenario brings one Bun.serve connection into a state with a raw client,
// then reports what a graceful stop() or closeIdleConnections() does with it. No handler reads a request body.
// usage: bun serve-idle-connections-fixture.ts '[{"scenario":"sweepAfterBody","chunked":true}]' '{"cert":..,"key":..}'
// It prints the results as one JSON array, in the order of the scenarios.
import net from "node:net";
import tls from "node:tls";

type Options = { scenario: string; tls?: boolean; chunked?: boolean; stopFirst?: boolean };
type Conn = { socket: net.Socket; text: string; closed: boolean };

const runs: Options[] = JSON.parse(process.argv[2]);
const serverTls: { cert: string; key: string } = JSON.parse(process.argv[3]);

// The most that the server reads from a socket at once (LIBUS_RECV_BUFFER_LENGTH).
const MAX_READ = 524288;

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(condition: () => boolean) {
  while (!condition()) await tick();
}
// The responses that arrived in full.
const answers = (conn: Conn) => conn.text.split("\r\n\r\nok").length - 1;
// Resolves when the kernel has the bytes.
const send = (conn: Conn, bytes: string | Buffer) =>
  new Promise<void>(resolve => conn.socket.write(bytes, () => resolve()));

// The body bytes of one chunked response, from its chunk sizes.
function chunkedBodyBytes(raw: Buffer) {
  let at = raw.indexOf("\r\n\r\n") + 4;
  let total = 0;
  for (;;) {
    const lineEnd = raw.indexOf("\r\n", at);
    const size = lineEnd === -1 ? 0 : parseInt(raw.toString("latin1", at, lineEnd), 16);
    if (!(size > 0)) return total;
    total += Math.min(size, raw.length - (lineEnd + 2));
    at = lineEnd + 2 + size + 2;
  }
}

async function run(options: Options) {
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let streamed = 0;
  let sweptInRead: number | undefined;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    // The idle timer must not be what closes a connection here.
    idleTimeout: 255,
    ...(options.tls ? { tls: serverTls } : {}),
    fetch(req) {
      if (req.url.endsWith("/hold")) {
        held.resolve();
        return release.promise.then(() => new Response("ok"));
      }
      if (req.url.endsWith("/stream")) {
        return new Response(
          new ReadableStream({
            type: "direct",
            pull(controller) {
              const chunk = Buffer.alloc(1024 * 1024, "x");
              // write() returns a promise once the kernel takes no more. The stream ends with those bytes not sent.
              let written: number | Promise<number>;
              do {
                written = controller.write(chunk);
                streamed += chunk.length;
              } while (typeof written === "number" && streamed < 256 * chunk.length);
              controller.close();
              held.resolve();
            },
          }),
        );
      }
      if (req.url.endsWith("/sweep")) {
        // The response ends before anything reads the body. That rejects this read inside the server's read of
        // the connection.
        req.text().catch(() => {
          sweptInRead = server.closeIdleConnections();
        });
      }
      return new Response("ok");
    },
  });

  // Resolves when the connection is open. `onData` replaces the collector of response text.
  function dial(onData?: (chunk: Buffer) => void) {
    const socket = options.tls
      ? tls.connect({ port: server.port!, host: "127.0.0.1", rejectUnauthorized: false })
      : net.connect(server.port!, "127.0.0.1");
    const conn: Conn = { socket, text: "", closed: false };
    socket.on("data", onData ?? (chunk => (conn.text += chunk.toString("latin1"))));
    socket.on("close", () => (conn.closed = true));
    socket.on("error", () => {});
    const { promise, resolve, reject } = Promise.withResolvers<Conn>();
    socket.once(options.tls ? "secureConnect" : "connect", () => resolve(conn));
    socket.once("error", reject);
    return promise;
  }

  // The server reads every connection that has bytes before it waits for more events. This request goes out on a
  // new connection after the bytes under test, so the server has read those bytes when it has answered this one.
  async function barrier() {
    const conn = await dial();
    await send(conn, "GET /barrier HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    await until(() => conn.closed);
  }

  // A POST with the body bytes "a", "b" and "c". The handler answers it at the head.
  const upload = options.chunked
    ? {
        head: "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n",
        middle: "1\r\nb\r\n",
        end: "1\r\nc\r\n0\r\n\r\n",
      }
    : { head: "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 3\r\n\r\na", middle: "b", end: "c" };

  // Sends the upload up to `last`. The server reads each part after the head in a read of its own, after the
  // response.
  async function answeredUpload(conn: Conn, last: "head" | "middle" | "end") {
    await send(conn, upload.head);
    await until(() => answers(conn) === 1);
    if (last === "head") return;
    await send(conn, upload.middle);
    await barrier();
    if (last === "middle") return;
    await send(conn, upload.end);
    await barrier();
  }

  const scenarios: Record<string, () => Promise<object>> = {
    // The body ended two reads after the response.
    async sweepAfterBody() {
      const conn = await dial();
      await answeredUpload(conn, "end");
      const swept = server.closeIdleConnections();
      if (swept) await until(() => conn.closed);
      return { swept, closed: conn.closed };
    },

    async stopAfterBody() {
      const conn = await dial();
      await answeredUpload(conn, "end");
      await server.stop();
      await until(() => conn.closed);
      return { stopped: true, closed: true };
    },

    // One read after the response, and the body has not ended. The client never sends the rest.
    async stopDuringBody() {
      const conn = await dial();
      await answeredUpload(conn, "middle");
      await server.stop();
      await until(() => conn.closed);
      return { stopped: true, closed: true };
    },

    // The rest of the body takes the server two reads or more, however the bytes arrive.
    async stopAfterLargeBody() {
      const conn = await dial();
      const rest = Buffer.alloc(2 * MAX_READ, "b");
      await send(conn, `POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${1 + rest.length}\r\n\r\na`);
      await until(() => answers(conn) === 1);
      await send(conn, rest);
      await barrier();
      await server.stop();
      await until(() => conn.closed);
      return { stopped: true, closed: true };
    },

    // Right after the response, the body has not ended. Then it ends, and a second request follows.
    async sweepDuringBody() {
      const conn = await dial();
      await answeredUpload(conn, "head");
      const sweptDuringBody = server.closeIdleConnections();
      await send(conn, upload.middle + upload.end + "GET /next HTTP/1.1\r\nHost: x\r\n\r\n");
      await until(() => answers(conn) === 2 || conn.closed);
      const servedNext = answers(conn) === 2;
      const sweptAfterBody = server.closeIdleConnections();
      if (sweptAfterBody) await until(() => conn.closed);
      return { sweptDuringBody, servedNext, sweptAfterBody, closed: conn.closed };
    },

    // A part of the next request's head arrives while the response is pending.
    async nextHead() {
      const conn = await dial();
      await send(conn, "GET /hold HTTP/1.1\r\nHost: x\r\n\r\n");
      await held.promise;
      await send(conn, "GET /next HTTP/1.1\r\nHost: x\r\n");
      await barrier();
      let swept: number | undefined;
      let stopped: Promise<void>;
      if (options.stopFirst) {
        stopped = server.stop();
        release.resolve();
        await until(() => answers(conn) === 1);
      } else {
        release.resolve();
        await until(() => answers(conn) === 1);
        swept = server.closeIdleConnections();
        stopped = server.stop();
      }
      // The rest of the head.
      await send(conn, "\r\n");
      await until(() => answers(conn) === 2 || conn.closed);
      const servedNext = answers(conn) === 2;
      await stopped;
      await until(() => conn.closed);
      return { swept, servedNext, stopped: true, closed: true };
    },

    // The response has ended for the server, and the client has not read it.
    async unsentResponse() {
      const chunks: Buffer[] = [];
      const conn = await dial(chunk => chunks.push(chunk));
      conn.socket.pause();
      await send(conn, "GET /stream HTTP/1.1\r\nHost: x\r\n\r\n");
      await held.promise;
      await until(() => server.pendingRequests === 0);
      const swept = server.closeIdleConnections();
      const stopped = server.stop();
      conn.socket.resume();
      await until(() => conn.closed);
      await stopped;
      const bodyBytes = chunkedBodyBytes(Buffer.concat(chunks));
      return { swept, received: bodyBytes === streamed ? "all" : `${bodyBytes} of ${streamed}`, stopped: true };
    },

    // Bun.serve answers a CONNECT like any request. What the client sends after it is not a request.
    async connectBytes() {
      const conn = await dial();
      await send(conn, "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n");
      await until(() => answers(conn) === 1);
      await send(conn, "x");
      await barrier();
      const swept = server.closeIdleConnections();
      if (swept) await until(() => conn.closed);
      return { swept, closed: conn.closed };
    },

    // The handler's closeIdleConnections() runs inside the server's read of the connection, after the response
    // ended.
    async sweepInRead() {
      const conn = await dial();
      await send(conn, "POST /sweep HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello");
      await until(() => answers(conn) === 1 && sweptInRead !== undefined);
      const sweptAfterRead = server.closeIdleConnections();
      if (sweptAfterRead) await until(() => conn.closed);
      return { sweptInRead, sweptAfterRead, closed: conn.closed };
    },
  };

  const result = await scenarios[options.scenario]();
  // A build that left the connection open must not keep this process alive.
  await server.stop(true);
  return result;
}

const results: object[] = [];
for (const options of runs) results.push(await run(options));
console.log(JSON.stringify(results));
