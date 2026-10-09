// Scenarios for websocket-server-upgrade-reentrant.test.ts: the handler calls
// server.upgrade(req) after a response to `req` has started. Each scenario
// prints one JSON line: what server.upgrade() returned and what the client read.
//
//   stream <version>      a streaming Response is in flight
//   getter <data|headers> an upgrade option getter starts the streaming Response
//   rewriter              an HTMLRewriter body is attached and has written nothing
//   file <fifo>           a Bun.file() body is in flight
import { drainMicrotasks } from "bun:jsc";
import { closeSync, openSync, writeSync } from "node:fs";

const [scenario, arg] = process.argv.slice(2);

const upgradeRequest = (version: string) =>
  "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
  `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: ${version}\r\n\r\n`;

let opened = 0;
const websocket = {
  open() {
    opened++;
  },
  message() {},
};

async function connect(server: { port: number }, request: string) {
  let received = "";
  let closed = false;
  let wake = () => {};
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    socket: {
      open(socket) {
        socket.write(request);
      },
      data(_, chunk) {
        received += chunk.toString("latin1");
        wake();
      },
      close() {
        closed = true;
        wake();
      },
      error() {},
    },
  });
  return {
    get received() {
      return received;
    },
    // Waits for `done()`, or for the connection to close.
    async until(done: () => boolean) {
      while (!done() && !closed) await new Promise<void>(resolve => (wake = resolve));
    },
    async close() {
      socket.end();
      await this.until(() => false);
    },
  };
}

// The whole message has arrived, or the connection became a WebSocket.
const complete = (client: { received: string }) => client.received.includes("0\r\n\r\n") || opened > 0;

// Everything after the blank line that ends the header block.
const bodyOf = (wire: string) => wire.split("\r\n\r\n").slice(1).join("\r\n\r\n");

async function report(server: { pendingRequests: number; stop(force: boolean): void }, wire: string, rest: object) {
  // The server handles a closed connection a turn or two after the client does.
  // Bounded: a request that leaked stays in the count.
  for (let turn = 0; server.pendingRequests > 0 && turn < 100; turn++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log(
    JSON.stringify({
      ...rest,
      opened,
      statusLine: wire.split("\r\n")[0],
      handshake: /upgrade|sec-websocket/i.test(wire),
      pendingRequests: server.pendingRequests,
    }),
  );
  server.stop(true);
  process.exit(0);
}

// Writes "chunk-a", waits for `release`, then writes "chunk-b" and ends.
let pulls = 0;
function twoChunks(release: Promise<unknown>, beforeSecondChunk = () => {}) {
  return new ReadableStream({
    async pull(controller) {
      if (pulls++ === 0) return controller.enqueue("chunk-a");
      await release;
      beforeSecondChunk();
      controller.enqueue("chunk-b");
      controller.close();
    },
  });
}

if (scenario === "stream") {
  const firstChunkArrived = Promise.withResolvers<void>();
  let upgraded: unknown;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    websocket,
    fetch(req, server) {
      return new Response(twoChunks(firstChunkArrived.promise, () => (upgraded = server.upgrade(req))));
    },
  });
  const client = await connect(server, upgradeRequest(arg));
  await client.until(() => client.received.includes("chunk-a"));
  firstChunkArrived.resolve();
  await client.until(() => complete(client));
  await client.close();
  await report(server, client.received, { upgraded, body: bodyOf(client.received) });
}

if (scenario === "getter") {
  const parked = Promise.withResolvers<{ req: Request; answer: (response: Response) => void }>();
  const firstChunkArrived = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    websocket,
    fetch(req) {
      const handler = Promise.withResolvers<Response>();
      parked.resolve({ req, answer: handler.resolve });
      return handler.promise;
    },
  });
  const client = await connect(server, upgradeRequest("13"));
  const { req, answer } = await parked.promise;
  // One turn later the server waits on the handler's promise.
  await new Promise(resolve => setImmediate(resolve));
  let startedInGetter = false;
  const startResponse = () => {
    answer(new Response(twoChunks(firstChunkArrived.promise)));
    // Runs the reaction of the handler's promise now: the response starts
    // while server.upgrade() is on the stack, after its first check passed.
    drainMicrotasks();
    startedInGetter = pulls > 0;
    return { "x-from-getter": "1" };
  };
  const options =
    arg === "data"
      ? {
          get data() {
            return startResponse();
          },
        }
      : {
          get headers() {
            return startResponse();
          },
        };
  const upgraded = server.upgrade(req, options);
  await client.until(() => client.received.includes("chunk-a") || opened > 0);
  firstChunkArrived.resolve();
  await client.until(() => complete(client));
  await client.close();
  await report(server, client.received, { upgraded, startedInGetter, body: bodyOf(client.received) });
}

if (scenario === "rewriter") {
  const sourcePulled = Promise.withResolvers<Request>();
  const release = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    websocket,
    fetch(req) {
      return new HTMLRewriter().on("p", { element() {} }).transform(
        new Response(
          new ReadableStream({
            async pull(controller) {
              sourcePulled.resolve(req);
              await release.promise;
              controller.enqueue("<p>late</p>");
              controller.close();
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
      );
    },
  });
  const client = await connect(server, upgradeRequest("13"));
  const req = await sourcePulled.promise;
  // One turn later the server has attached the body. Its status line waits for the first chunk.
  await new Promise(resolve => setImmediate(resolve));
  const upgraded = server.upgrade(req);
  release.resolve();
  await client.until(() => complete(client));
  await client.close();
  await report(server, client.received, { upgraded, body: bodyOf(client.received) });
}

if (scenario === "file") {
  // Read and write: the server's read of the FIFO then waits instead of finding EOF.
  const writer = openSync(arg, "r+");
  const fileRequest = Promise.withResolvers<Request>();
  const otherParked = Promise.withResolvers<void>();
  const otherAnswer = Promise.withResolvers<Response>();
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    websocket,
    fetch(req) {
      if (new URL(req.url).pathname === "/other") {
        otherParked.resolve();
        return otherAnswer.promise;
      }
      fileRequest.resolve(req);
      return new Response(Bun.file(arg));
    },
  });
  const client = await connect(server, upgradeRequest("13"));
  const req = await fileRequest.promise;
  await client.until(() => client.received.includes("\r\n"));
  const upgraded = server.upgrade(req);
  // A second request, parked in its handler while the file body continues.
  const other = await connect(server, "GET /other HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
  await otherParked.promise;
  writeSync(writer, "late-data");
  await client.until(() => client.received.includes("late-data") || opened > 0);
  otherAnswer.resolve(new Response("other-answer"));
  await other.until(() => other.received.includes("other-answer") || opened > 0);
  closeSync(writer);
  await Promise.all([client.close(), other.close()]);
  await report(server, client.received, {
    upgraded,
    fileBodyArrived: client.received.includes("late-data"),
    other: bodyOf(other.received),
  });
}
