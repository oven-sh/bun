// The raw client of serve-response-in-flight.test.ts, and the scenarios of that
// file that need a process of their own, for what they report on stderr. The
// process runs the scenarios it is given, in order, and announces each on
// stderr, so a report lands under its scenario.
import { closeSync, constants, openSync, writeSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";

export const LIMIT = 32;
// One chunk that takes every request body here over the limit.
export const OVERFLOW = `30\r\n${Buffer.alloc(48, "x").toString()}\r\n`;
// The first line break: the status line has arrived.
export const END_OF_STATUS_LINE = "\r\n";

// What ends the request. "limit": the client sends the chunk that takes the
// body over the limit. "leave": the client destroys its socket, which is what
// the limit is compared with.
export type Cause = "limit" | "leave";

export type Upload = {
  // What the client must have received before it acts, so the response is
  // provably in flight. `null`: the request head and the overflow leave in one
  // write, so the server finds both in one read.
  marker: string | null;
  // Body bytes (within the limit) sent with the request head.
  first?: string;
  path?: string;
  cause?: Cause;
  // For a response that can have megabytes in flight. Settles when the server
  // has let the request go: the FIN of the upload leaves then, not behind the
  // overflow. On macOS such a client is not always told of a reset when it
  // sends nothing afterwards, and this FIN is answered with a reset.
  released?: () => Promise<unknown>;
  // With `released`: the client also stops reading until then, so the response
  // stays in flight whatever the socket buffers can take.
  hold?: boolean;
};

// Waits for `condition`, with a deadline: what never happens shows in the
// result, not as a timeout.
export async function eventually(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition() && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
}

// Settles when `server` has let every request go.
export const released = (server: { pendingRequests: number }) => eventually(() => server.pendingRequests === 0);

const connect = (port: number, secure: boolean, onConnect: () => void): net.Socket =>
  secure
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, onConnect)
    : net.connect(port, "127.0.0.1", onConnect);

// Uploads a chunked body: `first` with the head and, once `marker` has arrived,
// the chunk that takes the body over the limit. The overflow leaves from the
// data handler because a forced close is a RST, and a RST can discard what the
// client has not read yet. The client sends its FIN behind the overflow, so a
// server that answers and keeps the connection open still ends the upload.
// `closed` tells a forced close ("reset") from a graceful one ("fin"), and
// from a client that left ("left").
export function upload(
  port: number,
  secure: boolean,
  { marker, first = "", path = "/", cause = "limit", released, hold }: Upload,
  onClose = () => {},
) {
  const chunks: Buffer[] = [];
  let acted = marker === null;
  let closed = "fin";
  return new Promise<{ wire: string; closed: string }>(resolve => {
    const sock = connect(port, secure, () => {
      const head = `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n${first}`;
      if (acted) sock.end(head + OVERFLOW);
      else sock.write(head);
    });
    sock.on("data", (d: Buffer) => {
      chunks.push(d);
      if (acted || !Buffer.concat(chunks).includes(marker!)) return;
      acted = true;
      if (cause === "leave") {
        closed = "left";
        return void sock.destroy();
      }
      if (!released) return void sock.end(OVERFLOW);
      sock.write(OVERFLOW);
      if (hold) sock.pause();
      released().finally(() => {
        sock.resume();
        sock.end();
      });
    });
    sock.on("error", () => (closed = "reset"));
    sock.on("close", () => {
      onClose();
      resolve({ wire: Buffer.concat(chunks).toString("latin1"), closed });
    });
  });
}

// The status line of a GET on a connection of its own.
export function get(port: number, secure = false, path = "/ok"): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise(resolve => {
    const sock = connect(port, secure, () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    sock.on("data", (d: Buffer) => chunks.push(d));
    sock.on("error", () => {});
    sock.on("close", () => resolve(Buffer.concat(chunks).toString("latin1").split("\r\n")[0]));
  });
}

const body = (wire: string) => wire.split("\r\n\r\n").slice(1).join("\r\n\r\n");

// A handler that reports a failed upload inside its own response. It is
// written for a client that leaves: it first checks that the request is still
// there.
async function report(cause: Cause) {
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    maxRequestBodySize: LIMIT,
    fetch(req) {
      if (req.method === "GET") return new Response("ok");
      let controller!: ReadableStreamDefaultController;
      const progress = new ReadableStream({
        start(c) {
          controller = c;
          c.enqueue("progress: reading the upload\n");
        },
      });
      req.text().then(
        text => {
          controller.enqueue(`done: ${text.length} bytes\n`);
          controller.close();
        },
        err => {
          if (req.signal.aborted) return;
          controller.enqueue(`upload failed: ${err.message}\n`);
          controller.close();
        },
      );
      return new Response(progress);
    },
  });
  const { wire, closed } = await upload(server.port!, false, { marker: "progress", cause });
  await released(server);
  return { body: body(wire), closed, pendingRequests: server.pendingRequests, next: await get(server.port!) };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  "report:limit": () => report("limit"),
  "report:leave": () => report("leave"),

  // The body of request A is the response body of request B, which has written
  // a chunk. A crosses the limit: A gets the 413, and B's body fails with the
  // limit error, which is B's to report.
  async "relay"() {
    const bodyOfA = Promise.withResolvers<ReadableStream>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      maxRequestBodySize: LIMIT,
      async fetch(req) {
        if (req.method === "GET") return new Response(await bodyOfA.promise);
        bodyOfA.resolve(req.body!);
        return new Promise<Response>(() => {});
      },
    });
    const relayed = Promise.withResolvers<void>();
    const b = new Promise<{ wire: string; closed: string }>(resolve => {
      const chunks: Buffer[] = [];
      let closed = "fin";
      const sock = net.connect(server.port!, "127.0.0.1", () => {
        sock.write("GET /b HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
      });
      sock.on("data", (d: Buffer) => {
        chunks.push(d);
        if (Buffer.concat(chunks).includes("chunk-a")) relayed.resolve();
      });
      sock.on("error", () => (closed = "reset"));
      sock.on("close", () => resolve({ wire: Buffer.concat(chunks).toString("latin1"), closed }));
    });
    // A sends its overflow once B has relayed A's first chunk.
    const a = await new Promise<string>(resolve => {
      const chunks: Buffer[] = [];
      const sock = net.connect(server.port!, "127.0.0.1", async () => {
        sock.write("POST /a HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n7\r\nchunk-a\r\n");
        await relayed.promise;
        sock.end(OVERFLOW);
      });
      sock.on("data", (d: Buffer) => chunks.push(d));
      sock.on("error", () => {});
      sock.on("close", () => resolve(Buffer.concat(chunks).toString("latin1").split("\r\n")[0]));
    });
    const { wire, closed } = await b;
    return {
      a,
      b: { statusLine: wire.split("\r\n")[0], body: body(wire), closed },
      pendingRequests: server.pendingRequests,
    };
  },

  // The handler has not answered. Its abort listener cancels the reader of the
  // request body and lets the promise of that cancel go.
  async "an abort listener cancels the reader of the request body"() {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      maxRequestBodySize: LIMIT,
      fetch(req) {
        if (req.method === "GET") return new Response("ok");
        const reader = req.body!.getReader();
        reader.read().catch(() => {});
        req.signal.addEventListener("abort", () => void reader.cancel());
        return new Promise<Response>(() => {});
      },
    });
    const { wire } = await upload(server.port!, false, { marker: null });
    await released(server);
    return {
      statusLine: wire.split("\r\n")[0],
      next: await get(server.port!),
      pendingRequests: server.pendingRequests,
    };
  },

  // X has not answered when its body crosses the limit. That body feeds the
  // response of Y through an HTMLRewriter that has written nothing, so the
  // body error runs Y's `error()`, which lets the handler of X answer with the
  // file ANSWER_FILE. X is over by then.
  async "the handler answers with a file while its request is being rejected"() {
    const file = process.env.ANSWER_FILE!;
    // A writer that stays open: the read end of the FIFO waits for bytes and sees no end.
    const writer = process.env.ANSWER_KIND === "fifo" ? openSync(file, constants.O_RDWR | constants.O_NONBLOCK) : -1;
    const answer = Promise.withResolvers<void>();
    const bodyOfX = Promise.withResolvers<ReadableStream>();
    const attached = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      maxRequestBodySize: LIMIT,
      error() {
        answer.resolve();
        return new Response("err", { status: 500 });
      },
      async fetch(req) {
        if (req.method === "GET") return new Response("ok");
        if (new URL(req.url).pathname === "/x") {
          bodyOfX.resolve(req.body!);
          await answer.promise;
          return new Response(Bun.file(file));
        }
        req.body!.getReader();
        const other = await bodyOfX.promise;
        // One turn of the event loop: the server has taken the response of Y.
        setImmediate(attached.resolve);
        return new HTMLRewriter()
          .on("p", { element() {} })
          .transform(new Response(other, { headers: { "content-type": "text/html" } }));
      },
    });
    // A chunked upload that stays open. `overflow()` takes it over the limit.
    const post = (path: string) => {
      let body!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({ start: c => void (body = c) });
      const done = new AbortController();
      const status = fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: "POST",
        body: stream,
        duplex: "half",
        signal: done.signal,
      } as RequestInit).then(
        res => res.status,
        e => `rejected: ${e.code}`,
      );
      return { status, done, overflow: () => body.enqueue(new Uint8Array(48).fill(120)) };
    };
    const y = post("/y");
    const x = post("/x");
    await attached.promise;
    x.overflow();
    const statuses = { x: await x.status, y: await y.status };
    y.done.abort();
    // New connections first: one of them takes the place of the closed
    // connection of X. Then the FIFO becomes readable. A file stream that the
    // rejection left behind reads it into that place.
    let later = "";
    for (let i = 0; i < 10; i++) later = await get(server.port!);
    if (writer !== -1) {
      writeSync(writer, Buffer.alloc(4096, "z"));
      later = await get(server.port!);
      closeSync(writer);
    }
    await released(server);
    return { ...statuses, later, pendingRequests: server.pendingRequests };
  },
};

// Every response that the request body feeds natively, in both modes.
const rewrite = (req: Request) =>
  new HTMLRewriter()
    .on("p", { element() {} })
    .transform(new Response(req.body, { headers: { "content-type": "text/html" } }));
const echo = (req: Request) => new Response(req.body);
const fed: Record<string, { respond(req: Request): Response } & Upload> = {
  "new Response(req.body) has written nothing": { respond: echo, marker: END_OF_STATUS_LINE },
  "new Response(req.body) has written a chunk": { respond: echo, marker: "chunk-a", first: "7\r\nchunk-a\r\n" },
  "an HTMLRewriter over req.body has written nothing": { respond: rewrite, marker: null },
  "an HTMLRewriter over req.body has written a chunk": {
    respond: rewrite,
    marker: "chunk-a",
    first: "e\r\n<b>chunk-a</b>\r\n",
  },
};
for (const development of [false, true]) {
  for (const [name, { respond, ...request }] of Object.entries(fed)) {
    scenarios[`development: ${development}: ${name}`] = async () => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development,
        maxRequestBodySize: LIMIT,
        fetch: respond,
      });
      const { wire } = await upload(server.port!, false, request);
      return `${wire.split("\r\n")[0]}, ${server.pendingRequests} pending`;
    };
  }
}

if (import.meta.main) {
  const results: Record<string, unknown> = {};
  for (const name of process.argv.slice(2)) {
    console.error(`# ${name}`);
    results[name] = await scenarios[name]();
  }
  console.log(JSON.stringify(results));
}
