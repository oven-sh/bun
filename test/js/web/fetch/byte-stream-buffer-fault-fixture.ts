// Prints what becomes of bodies for a part of which their stream has no memory.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import type { Socket } from "bun";
import { constants, deflateRawSync } from "node:zlib";

const refuse = () => fault.set({ syscall: "byte_stream_buffer", action: "errno", errno: "ENOMEM" });
const chunk = (bytes: Uint8Array) =>
  Buffer.concat([Buffer.from(bytes.length.toString(16) + "\r\n"), bytes, Buffer.from("\r\n")]);

async function respond(request: (url: URL) => Response | Promise<Response> = fetch) {
  const part = (text: string | Buffer, finishFlush: number) => chunk(deflateRawSync(text, { finishFlush }));
  const closed = Promise.withResolvers<void>();
  let server!: Socket;
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        if (server) return;
        server = socket;
        listener.stop();
        const head = "HTTP/1.1 200 OK\r\nContent-Encoding: deflate\r\nTransfer-Encoding: chunked\r\n\r\n";
        socket.write(Buffer.concat([Buffer.from(head), part("<p>first", constants.Z_FULL_FLUSH)]));
      },
      close: () => closed.resolve(),
    },
  });
  const response = await request(new URL(`http://127.0.0.1:${listener.port}`));
  response.body;
  return {
    response,
    closed: closed.promise,
    more: (text: string | Buffer) => server.write(part(text, constants.Z_FULL_FLUSH)),
    last: (text: Buffer) => server.end(Buffer.concat([part(text, constants.Z_FINISH), Buffer.from("0\r\n\r\n")])),
  };
}

const bucket = (url: URL) =>
  new Bun.S3Client({ endpoint: url.href, bucket: "a", accessKeyId: "a", secretAccessKey: "a" });
const download = (url: URL) => new Response(bucket(url).file("a").stream());

const later =
  (read: (response: Response) => Promise<unknown>, request?: (url: URL) => Promise<Response>) => async () => {
    const { response, closed, more } = await respond(request);
    refuse();
    more("more");
    await closed;
    return read(response);
  };

const lessRoom = (part: "more" | "last", request?: typeof download) => async () => {
  const server = await respond(request);
  const reader = server.response.body!.getReader();
  await reader.read();
  // The room goes by what the last one got.
  const short = reader.read();
  server.more("more");
  await short;
  const read = reader.read();
  refuse();
  server[part](Buffer.alloc(128 * 1024));
  return read.finally(() => server.closed);
};

/** The handlers call what they are given, and nobody reads the output until that call into the rewriter is over. */
async function rewrite(on: (rewriter: HTMLRewriter, refuse: () => void) => HTMLRewriter) {
  const over = Promise.withResolvers<void>();
  const { readable, writable } = new TransformStream();
  const rewriter = on(new HTMLRewriter(), () => (refuse(), setImmediate(over.resolve)));
  const response = rewriter.transform(new Response(readable));
  response.body;
  const writer = writable.getWriter();
  Promise.all([writer.write("first"), writer.write("more<p>"), writer.close()]).catch(() => {});
  await over.promise;
  return response.text();
}

const cases: Record<string, () => Promise<unknown>> = {
  "a read() with less room than the part needs": lessRoom("more"),
  "a read() with less room than the last part needs": lessRoom("last"),
  "a read() with less room than the part of a download needs": lessRoom("more", download),
  "a read() with less room than the last part of a download needs": lessRoom("last", download),
  async "a sink that is not ready"() {
    const { response, closed, more } = await respond();
    const element = () => {
      refuse();
      more("more");
      return closed;
    };
    return new HTMLRewriter().on("p", { element }).transform(response).text();
  },
  "a later text()": later(response => response.text()),
  "a later read()": later(response => Array.fromAsync(response.body!)),
  "a later clone()": later(response => response.clone().text()),
  "a later Bun.write()": later(async response => {
    await Bun.write(process.env.OUT!, "before");
    return Bun.write(process.env.OUT!, response).finally(async () => {
      if ((await Bun.file(process.env.OUT!).text()) !== "before") console.log("The file has changed");
    });
  }),
  "a later HTMLRewriter": later(async response => new HTMLRewriter().transform(response).text()),
  "a second upload": later(async response => {
    using server = Bun.serve({ port: 0, fetch: () => new Response() });
    const s3 = bucket(server.url);
    await s3.write("a", response).catch(() => {});
    return await s3.write("a", response);
  }),
  "a later Bun.spawn()": later(async response => Bun.spawn({ cmd: ["cat"], stdin: response }).exited),
  "a later text() of an upload that went on"() {
    const cancelled = Promise.withResolvers<void>();
    const body = new ReadableStream({
      start: controller => controller.enqueue(Buffer.from("a")),
      cancel: () => cancelled.resolve(),
    });
    return later(
      response => cancelled.promise.then(() => response.text()),
      url => fetch(url, { method: "POST", body }),
    )();
  },
  async "a later text() of a download"() {
    refuse();
    const { response, closed } = await respond(download);
    await closed;
    return response.text();
  },
  "a later text() of a rewrite": () =>
    rewrite((rewriter, refuse) => rewriter.onDocument({ end: end => (refuse(), void end.append("last")) })),
  "a later text() of a rewrite whose handler waits, and still has its element"() {
    const failed = Promise.withResolvers<void>();
    let handler!: Promise<void>;
    return rewrite((rewriter, refuse) =>
      rewriter.on("p", {
        element: element => (refuse(), (handler = failed.promise.then(() => void element.tagName.length))),
      }),
    ).finally(() => (failed.resolve(), handler));
  },
  "a later text() of a rewrite whose handler throws": () =>
    rewrite((rewriter, refuse) =>
      rewriter.on("p", {
        element() {
          refuse();
          throw new Error("thrown");
        },
      }),
    ),
  "a worker that exits when its rewrite cancels the input"() {
    const script = `
      let input;
      const stream = new ReadableStream({ start: it => void (input = it), cancel: () => process.exit(3) });
      const response = new HTMLRewriter().on("p", { element: () => new Promise(() => {}) }).transform(new Response(stream));
      response.body;
      const text = response.text();
      input.enqueue(Buffer.from("first<p>"));
      await text;
    `;
    refuse();
    return new Promise((_, reject) => {
      new Worker("data:text/javascript," + encodeURIComponent(script)).addEventListener("close", reject);
    });
  },
};

for (const [name, run] of Object.entries(cases)) {
  const result = await run().then(
    () => "resolved",
    error => error.code ?? error.message,
  );
  console.log(`${name}: ${result}`);
  fault.clear();
}
