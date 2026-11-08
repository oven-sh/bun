// Fixture for bun-server.test.ts. Each scenario brings one Bun.serve connection into a state with a raw client,
// then reports what a graceful stop() or closeIdleConnections() does with it. No handler reads a request body.
// usage: bun serve-idle-connections-fixture.ts '[{"scenario":"sweepAfterBody","chunked":true}]' '{"cert":..,"key":..}'
// It prints the results as one JSON array, in the order of the scenarios.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import net from "node:net";
import tls from "node:tls";

type Options = { scenario: string; tls?: boolean; chunked?: boolean; stopFirst?: boolean };
type Conn = { socket: net.Socket; text: string; closed: boolean };

const runs: Options[] = JSON.parse(process.argv[2]);
const serverTls: { cert: string; key: string } = JSON.parse(process.argv[3]);

// The most that the server reads from a socket at once (LIBUS_RECV_BUFFER_LENGTH).
const MAX_READ = 524288;

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
// Resolves to false when the condition does not hold in time. The servers here have an idleTimeout of 255
// seconds, so a close that takes that long did not come from stop() or from closeIdleConnections().
async function until(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await tick();
  }
  return true;
}
// Whether the promise resolves in that time.
function settles(promise: Promise<unknown>) {
  let settled = false;
  promise.then(() => (settled = true));
  return until(() => settled);
}
// The responses that arrived in full.
const answers = (conn: Conn) => conn.text.split("\r\n\r\nok").length - 1;
// Resolves when the kernel has the bytes.
const send = (conn: Conn, bytes: string | Buffer) =>
  new Promise<void>(resolve => conn.socket.write(bytes, () => resolve()));

// The body bytes of one response, from its chunk sizes or from the end of its head.
function bodyBytes(raw: Buffer) {
  const headEnd = raw.indexOf("\r\n\r\n");
  if (headEnd === -1) return 0;
  let at = headEnd + 4;
  if (!/^transfer-encoding: chunked$/im.test(raw.toString("latin1", 0, headEnd))) return raw.length - at;
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
  let responseBytes = 0;
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
              const write = () => {
                responseBytes += chunk.length;
                return controller.write(chunk);
              };
              // write() returns a promise once the kernel refuses a part of a chunk. One more chunk follows, so the
              // server holds a megabyte or more of the response when the stream ends.
              while (typeof write() === "number" && responseBytes < 256 * chunk.length);
              write();
              controller.close();
              // An immediate runs before the server polls its sockets again. Until then the server sends no more of
              // the response, and the client reads nothing.
              setImmediate(held.resolve);
            },
          }),
        );
      }
      if (req.url.endsWith("/spill")) {
        // From here on each send() takes one byte. The TLS layer accepts the whole response and keeps what the
        // kernel did not take, so the response ends with an empty send buffer and most of its bytes not sent.
        fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
        responseBytes = 65536;
        held.resolve();
        return new Response(Buffer.alloc(responseBytes, "x"));
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

  // A POST to `path` with the body bytes "a", "b" and "c", in three parts.
  const upload = (path: string) =>
    options.chunked
      ? {
          head: `POST ${path} HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n`,
          middle: "1\r\nb\r\n",
          end: "1\r\nc\r\n0\r\n\r\n",
        }
      : { head: `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Length: 3\r\n\r\na`, middle: "b", end: "c" };

  // Sends an upload that the handler answers at its head, up to `last`. The server reads each part after the head
  // in a read of its own, after the response.
  async function answeredUpload(conn: Conn, last: "head" | "middle" | "end") {
    const { head, middle, end } = upload("/");
    await send(conn, head);
    await until(() => answers(conn) === 1);
    if (last === "head") return;
    await send(conn, middle);
    await barrier();
    if (last === "middle") return;
    await send(conn, end);
    await barrier();
  }

  const scenarios: Record<string, () => Promise<object>> = {
    // The body ended two reads after the response.
    async sweepAfterBody() {
      const conn = await dial();
      await answeredUpload(conn, "end");
      const swept = server.closeIdleConnections();
      return { swept, closed: swept ? await until(() => conn.closed) : conn.closed };
    },

    async stopAfterBody() {
      const conn = await dial();
      await answeredUpload(conn, "end");
      const stopped = await settles(server.stop());
      return { stopped, closed: stopped ? await until(() => conn.closed) : conn.closed };
    },

    // One read after the response, and the body has not ended. The client never sends the rest.
    async stopDuringBody() {
      const conn = await dial();
      await answeredUpload(conn, "middle");
      const stopped = await settles(server.stop());
      return { stopped, closed: stopped ? await until(() => conn.closed) : conn.closed };
    },

    // stop() comes while the response is pending. The response then ends, and the client never sends the rest of
    // the body.
    async stopBeforeResponse() {
      const conn = await dial();
      await send(conn, upload("/hold").head);
      await settles(held.promise);
      const stopping = server.stop();
      release.resolve();
      const stopped = await settles(stopping);
      const closed = stopped ? await until(() => conn.closed) : conn.closed;
      return { answers: answers(conn), stopped, closed };
    },

    // The rest of the body takes the server two reads or more, however the bytes arrive.
    async stopAfterLargeBody() {
      const conn = await dial();
      const rest = Buffer.alloc(2 * MAX_READ, "b");
      await send(conn, `POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${1 + rest.length}\r\n\r\na`);
      await until(() => answers(conn) === 1);
      await send(conn, rest);
      await barrier();
      const stopped = await settles(server.stop());
      return { stopped, closed: stopped ? await until(() => conn.closed) : conn.closed };
    },

    // Right after the response, the body has not ended. Then it ends, and a second request follows.
    async sweepDuringBody() {
      const conn = await dial();
      await answeredUpload(conn, "head");
      const sweptDuringBody = server.closeIdleConnections();
      const { middle, end } = upload("/");
      await send(conn, middle + end + "GET /next HTTP/1.1\r\nHost: x\r\n\r\n");
      await until(() => answers(conn) === 2 || conn.closed);
      const servedNext = answers(conn) === 2;
      const sweptAfterBody = server.closeIdleConnections();
      return { sweptDuringBody, servedNext, sweptAfterBody, closed: await until(() => conn.closed) };
    },

    // A part of the next request's head arrives while the response is pending.
    async nextHead() {
      const conn = await dial();
      await send(conn, "GET /hold HTTP/1.1\r\nHost: x\r\n\r\n");
      await settles(held.promise);
      await send(conn, "GET /next HTTP/1.1\r\nHost: x\r\n");
      await barrier();
      let swept: number | undefined;
      let stopping: Promise<void>;
      if (options.stopFirst) {
        stopping = server.stop();
        release.resolve();
        await until(() => answers(conn) === 1);
      } else {
        release.resolve();
        await until(() => answers(conn) === 1);
        swept = server.closeIdleConnections();
        stopping = server.stop();
      }
      // The rest of the head.
      await send(conn, "\r\n");
      await until(() => answers(conn) === 2 || conn.closed);
      const servedNext = answers(conn) === 2;
      const stopped = await settles(stopping);
      return { swept, servedNext, stopped, closed: stopped ? await until(() => conn.closed) : conn.closed };
    },

    // The response has ended for the server, and the server still holds a part of it.
    async unsentResponse() {
      const chunks: Buffer[] = [];
      const conn = await dial(chunk => chunks.push(chunk));
      conn.socket.write("GET /stream HTTP/1.1\r\nHost: x\r\n\r\n");
      // This continues inside the immediate of the /stream handler. Nothing between here and the two calls may
      // wait for a turn of the event loop: the server sends more of the response in each turn.
      await held.promise;
      const ended = server.pendingRequests === 0;
      const swept = server.closeIdleConnections();
      const stopping = server.stop();
      // The close comes after megabytes of response. Each wait is for the next part of them, or for the close.
      let parts: number;
      do {
        parts = chunks.length;
        await until(() => conn.closed || chunks.length > parts);
      } while (!conn.closed && chunks.length > parts);
      const received = bodyBytes(Buffer.concat(chunks));
      return {
        ended,
        swept,
        received: received === responseBytes ? "all" : `${received} of ${responseBytes}`,
        stopped: await settles(stopping),
      };
    },

    // TLS, and a build with fault injection. The response has ended, the send buffer is empty, and the kernel has
    // taken one byte of the ciphertext.
    async spilledResponse() {
      const chunks: Buffer[] = [];
      const conn = await dial(chunk => chunks.push(chunk));
      await send(conn, "GET /spill HTTP/1.1\r\nHost: x\r\n\r\n");
      await settles(held.promise);
      await until(() => server.pendingRequests === 0);
      const swept = server.closeIdleConnections();
      const stopping = server.stop();
      fault.clear();
      await until(() => conn.closed);
      const received = bodyBytes(Buffer.concat(chunks));
      return {
        swept,
        received: received === responseBytes ? "all" : `${received} of ${responseBytes}`,
        stopped: await settles(stopping),
      };
    },

    // Bun.serve answers a CONNECT like any request. What the client sends after it is not a request.
    async connectBytes() {
      const conn = await dial();
      await send(conn, "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\n\r\n");
      await until(() => answers(conn) === 1);
      await send(conn, "x");
      await barrier();
      const swept = server.closeIdleConnections();
      return { swept, closed: swept ? await until(() => conn.closed) : conn.closed };
    },

    // The handler's closeIdleConnections() runs inside the server's read of the connection, after the response
    // ended. The whole request is in that read. With chunked framing the parser has not entered the body yet.
    async sweepInRead() {
      const conn = await dial();
      const { head, middle, end } = upload("/sweep");
      await send(conn, head + middle + end);
      await until(() => answers(conn) === 1 && sweptInRead !== undefined);
      const sweptAfterRead = server.closeIdleConnections();
      return { sweptInRead, sweptAfterRead, closed: sweptAfterRead ? await until(() => conn.closed) : conn.closed };
    },
  };

  try {
    return await scenarios[options.scenario]();
  } finally {
    // A build that left the connection open must not keep this process alive.
    await server.stop(true);
  }
}

const results: object[] = [];
for (const options of runs) results.push(await run(options));
console.log(JSON.stringify(results));
