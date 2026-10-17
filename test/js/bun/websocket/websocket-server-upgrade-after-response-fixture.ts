// Scenarios for websocket-server-upgrade-reentrant.test.ts: the handler calls
// server.upgrade(req) after a response to `req` has started. Each argument
// names one scenario, as `name` or `name:argument`. The scenarios run one after
// the other. Each prints one JSON line: what server.upgrade() returned, what
// the client read, and what the server holds afterwards.
import type { Server } from "bun";
import { drainMicrotasks } from "bun:jsc";
import { closeSync, openSync, writeSync } from "node:fs";

const upgradeRequest = (version = "13") =>
  "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
  `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: ${version}\r\n\r\n`;

type Respond = (req: Request, server: Server<undefined>) => Response | Promise<Response>;
type Transport = { tls?: boolean; route?: boolean };

// One server for one scenario. `respond` answers the handshake request.
function serve(respond: Respond, { tls, route }: Transport = {}) {
  const sockets = { opened: 0 };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: tls ? JSON.parse(process.env.UPGRADE_FIXTURE_TLS!) : undefined,
    websocket: {
      open() {
        sockets.opened++;
      },
      message() {},
    },
    ...(route ? { routes: { "/": respond } } : { fetch: respond }),
  });
  return { server, sockets };
}

async function connect(server: { port: number }, request: string, { tls }: Transport = {}) {
  let text = "";
  let size = 0;
  let closed = false;
  let wake = () => {};
  // Replaced by a scenario that checks a large body chunk by chunk.
  let onChunk = (chunk: Buffer) => void (text += chunk.toString("latin1"));
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    tls: tls ? { rejectUnauthorized: false } : undefined,
    socket: {
      open(socket) {
        if (!tls) socket.write(request);
      },
      handshake(socket) {
        if (tls) socket.write(request);
      },
      data(_, chunk) {
        size += chunk.length;
        onChunk(chunk);
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
    socket,
    get received() {
      return text;
    },
    get size() {
      return size;
    },
    set onChunk(handler: (chunk: Buffer) => void) {
      onChunk = handler;
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

// The response on the wire is whole: its Content-Length is met, or its last chunk arrived.
function complete(wire: string) {
  const headEnd = wire.indexOf("\r\n\r\n");
  if (headEnd === -1) return false;
  const length = /\r\ncontent-length: (\d+)/i.exec(wire.slice(0, headEnd));
  if (length) return wire.length - (headEnd + 4) >= Number(length[1]);
  return wire.endsWith("0\r\n\r\n");
}

// Everything after the blank line that ends the header block.
const bodyOf = (wire: string) => wire.split("\r\n\r\n").slice(1).join("\r\n\r\n");

async function report(server: Server<undefined>, sockets: { opened: number }, wire: string, rest: object) {
  // The server handles a closed connection a turn or two after the client does.
  // Bounded: a request that leaked stays in the count.
  for (let turn = 0; server.pendingRequests > 0 && turn < 100; turn++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const result = {
    ...rest,
    opened: sockets.opened,
    pendingWebSockets: server.pendingWebSockets,
    statusLine: wire.split("\r\n")[0],
    handshake: /upgrade|sec-websocket/i.test(wire),
    pendingRequests: server.pendingRequests,
  };
  server.stop(true);
  return result;
}

// Writes "chunk-a", waits for `release`, then writes "chunk-b" and ends.
function twoChunks(release: Promise<unknown>, onPull = () => {}, beforeSecondChunk = () => {}) {
  let pulls = 0;
  return new ReadableStream({
    async pull(controller) {
      onPull();
      if (pulls++ === 0) return controller.enqueue("chunk-a");
      await release;
      beforeSecondChunk();
      controller.enqueue("chunk-b");
      controller.close();
    },
  });
}

// A streaming Response is in flight: one chunk is out, one is still to come.
async function stream(version: string, transport: Transport = {}) {
  const firstChunkArrived = Promise.withResolvers<void>();
  let upgraded: unknown;
  const { server, sockets } = serve(
    (req, server) =>
      new Response(twoChunks(firstChunkArrived.promise, undefined, () => (upgraded = server.upgrade(req)))),
    transport,
  );
  const client = await connect(server, upgradeRequest(version), transport);
  await client.until(() => client.received.includes("chunk-a"));
  firstChunkArrived.resolve();
  await client.until(() => complete(client.received) || sockets.opened > 0);
  await client.close();
  return report(server, sockets, client.received, { upgraded, body: bodyOf(client.received) });
}

const scenarios: Record<string, (argument: string) => Promise<object>> = {
  stream: version => stream(version),
  tls: () => stream("13", { tls: true }),
  route: () => stream("13", { route: true }),

  // The same, with a direct stream.
  async direct() {
    const request = Promise.withResolvers<Request>();
    const release = Promise.withResolvers<void>();
    const { server, sockets } = serve(req => {
      request.resolve(req);
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            controller.write("chunk-a");
            await controller.flush();
            await release.promise;
            controller.write("chunk-b");
            await controller.end();
          },
        } as any),
      );
    });
    const client = await connect(server, upgradeRequest());
    await client.until(() => client.received.includes("chunk-a"));
    const upgraded = server.upgrade(await request.promise);
    release.resolve();
    await client.until(() => complete(client.received) || sockets.opened > 0);
    await client.close();
    return report(server, sockets, client.received, { upgraded, body: bodyOf(client.received) });
  },

  // The stream has sent its status line and no body byte.
  async head() {
    const request = Promise.withResolvers<Request>();
    let controller!: ReadableStreamDefaultController;
    const { server, sockets } = serve(req => {
      request.resolve(req);
      return new Response(new ReadableStream({ start: c => void (controller = c) }));
    });
    const client = await connect(server, upgradeRequest());
    await client.until(() => client.received.includes("\r\n"));
    const upgraded = server.upgrade(await request.promise);
    // An upgrade that went ahead has closed the stream.
    if (!upgraded) {
      controller.enqueue("the body");
      controller.close();
    }
    await client.until(() => complete(client.received) || sockets.opened > 0);
    await client.close();
    return report(server, sockets, client.received, { upgraded, body: bodyOf(client.received) });
  },

  // The call comes from the first pull() of a direct stream: the earliest point
  // at which the stream's sink holds the response.
  async pull() {
    let upgraded: unknown;
    const { server, sockets } = serve(
      (req, server) =>
        new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              upgraded = server.upgrade(req);
              controller.write("the body");
              await controller.end();
            },
          } as any),
        ),
    );
    const client = await connect(server, upgradeRequest());
    await client.until(() => complete(client.received) || sockets.opened > 0);
    await client.close();
    return report(server, sockets, client.received, { upgraded, body: bodyOf(client.received) });
  },

  // Nobody misbehaves here. A request timeout wrapper answers with a wait page,
  // and the handler it raced upgrades after a slow check.
  async race() {
    const slowCheck = Promise.withResolvers<void>();
    const upgraded = Promise.withResolvers<unknown>();
    const cancelled = Promise.withResolvers<boolean>();
    const { server, sockets } = serve((req, server) => {
      const handler = slowCheck.promise.then(() => {
        upgraded.resolve(server.upgrade(req));
        return new Response("no", { status: 400 });
      });
      const waitPage = new Response(
        new ReadableStream({
          start: controller => controller.enqueue("please wait\n"),
          cancel: () => cancelled.resolve(true),
        }),
      );
      return Promise.race([handler, waitPage]);
    });
    const client = await connect(server, upgradeRequest());
    await client.until(() => client.received.includes("please wait\n"));
    slowCheck.resolve();
    const result = await upgraded.promise;
    await client.close();
    // The wait page is still the response, so it hears the client leave.
    if (result === true) cancelled.resolve(false);
    return report(server, sockets, client.received, {
      upgraded: result,
      cancelled: await cancelled.promise,
      body: bodyOf(client.received),
    });
  },

  // A Blob body that is larger than the socket buffers: the client does not
  // read, so the server still holds most of it.
  async blob() {
    const body = Buffer.alloc(32 * 1024 * 1024, "a");
    const request = Promise.withResolvers<Request>();
    const { server, sockets } = serve(req => {
      request.resolve(req);
      return new Response(body);
    });
    const client = await connect(server, upgradeRequest());
    await client.until(() => client.received.includes("\r\n\r\n"));
    client.socket.pause();
    const headLength = client.received.indexOf("\r\n\r\n") + 4;
    const head = client.received.slice(0, headLength);
    let intact = Buffer.from(client.received.slice(headLength), "latin1").every(byte => byte === body[0]);
    client.onChunk = chunk => void (intact &&= chunk.equals(body.subarray(0, chunk.length)));
    const upgraded = server.upgrade(await request.promise);
    client.socket.resume();
    await client.until(() => client.size >= headLength + body.length || sockets.opened > 0);
    await client.close();
    return report(server, sockets, head, { upgraded, bodyLength: client.size - headLength, bodyIntact: intact });
  },

  // An upgrade option getter starts the streaming Response.
  async getter(via) {
    const parked = Promise.withResolvers<{ req: Request; answer: (response: Response) => void }>();
    const firstChunkArrived = Promise.withResolvers<void>();
    const { server, sockets } = serve(req => {
      const handler = Promise.withResolvers<Response>();
      parked.resolve({ req, answer: handler.resolve });
      return handler.promise;
    });
    const client = await connect(server, upgradeRequest());
    const { req, answer } = await parked.promise;
    // One turn later the server waits on the handler's promise.
    await new Promise(resolve => setImmediate(resolve));
    let pulled = false;
    let startedInGetter = false;
    const startResponse = () => {
      answer(new Response(twoChunks(firstChunkArrived.promise, () => (pulled = true))));
      // Runs the reaction of the handler's promise now: the response starts
      // while server.upgrade() is on the stack, after its first check passed.
      drainMicrotasks();
      startedInGetter = pulled;
      return { "x-from-getter": "1" };
    };
    const options =
      via === "data"
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
    await client.until(() => client.received.includes("chunk-a") || sockets.opened > 0);
    firstChunkArrived.resolve();
    await client.until(() => complete(client.received) || sockets.opened > 0);
    await client.close();
    return report(server, sockets, client.received, { upgraded, startedInGetter, body: bodyOf(client.received) });
  },

  // An HTMLRewriter body is attached and has written nothing.
  async rewriter() {
    const sourcePulled = Promise.withResolvers<Request>();
    const release = Promise.withResolvers<void>();
    const { server, sockets } = serve(req =>
      new HTMLRewriter().on("p", { element() {} }).transform(
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
      ),
    );
    const client = await connect(server, upgradeRequest());
    const req = await sourcePulled.promise;
    // One turn later the server has attached the body. Its status line waits for the first chunk.
    await new Promise(resolve => setImmediate(resolve));
    const upgraded = server.upgrade(req);
    release.resolve();
    await client.until(() => complete(client.received) || sockets.opened > 0);
    await client.close();
    return report(server, sockets, client.received, { upgraded, body: bodyOf(client.received) });
  },

  // A Bun.file() body on a FIFO is in flight.
  async file(fifo) {
    // Read and write: the server's read of the FIFO then waits instead of finding EOF.
    const writer = openSync(fifo, "r+");
    const fileRequest = Promise.withResolvers<Request>();
    const otherParked = Promise.withResolvers<void>();
    const otherAnswer = Promise.withResolvers<Response>();
    const { server, sockets } = serve(req => {
      if (new URL(req.url).pathname === "/other") {
        otherParked.resolve();
        return otherAnswer.promise;
      }
      fileRequest.resolve(req);
      return new Response(Bun.file(fifo));
    });
    const client = await connect(server, upgradeRequest());
    const req = await fileRequest.promise;
    await client.until(() => client.received.includes("\r\n"));
    const upgraded = server.upgrade(req);
    // A second request, parked in its handler while the file body continues.
    const other = await connect(server, "GET /other HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    await otherParked.promise;
    writeSync(writer, "late-data");
    await client.until(() => client.received.includes("late-data") || sockets.opened > 0);
    otherAnswer.resolve(new Response("other-answer"));
    await other.until(() => other.received.includes("other-answer") || sockets.opened > 0);
    closeSync(writer);
    await Promise.all([client.close(), other.close()]);
    return report(server, sockets, client.received, {
      upgraded,
      fileBodyArrived: client.received.includes("late-data"),
      other: bodyOf(other.received),
    });
  },
};

for (const scenario of process.argv.slice(2)) {
  const separator = scenario.indexOf(":");
  const name = separator === -1 ? scenario : scenario.slice(0, separator);
  const argument = separator === -1 ? "" : scenario.slice(separator + 1);
  // A scenario that throws still leaves its line, so the ones after it report too.
  const result = await scenarios[name](argument).catch(error => ({ threw: String(error) }));
  console.log(JSON.stringify(result));
}
process.exit(0);
