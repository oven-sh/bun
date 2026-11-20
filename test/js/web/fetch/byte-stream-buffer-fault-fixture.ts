// Prints what becomes of bodies for a part of which their stream has no memory.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import type { Socket } from "bun";
import { constants, deflateRawSync } from "node:zlib";

const refuse = () => fault.set({ syscall: "byte_stream_buffer", action: "errno", errno: "ENOMEM" });
const chunk = (bytes: Uint8Array) =>
  Buffer.concat([Buffer.from(bytes.length.toString(16) + "\r\n"), bytes, Buffer.from("\r\n")]);

async function respond(init?: RequestInit) {
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
        const head = "HTTP/1.1 200 OK\r\nContent-Encoding: deflate\r\nTransfer-Encoding: chunked\r\n\r\n";
        socket.write(Buffer.concat([Buffer.from(head), part("<p>first", constants.Z_FULL_FLUSH)]));
      },
      close: () => closed.resolve(),
    },
  });
  const response = await fetch(`http://127.0.0.1:${listener.port}`, init);
  listener.stop();
  response.body;
  return {
    response,
    closed: closed.promise,
    more: (text: string | Buffer) => server.write(part(text, constants.Z_FULL_FLUSH)),
    last: (text: string) => server.end(Buffer.concat([part(text, constants.Z_FINISH), Buffer.from("0\r\n\r\n")])),
  };
}

/** Until the client has hung up, too. */
const both = (read: Promise<unknown>, closed: Promise<void>) => read.finally(() => closed);

const later = (read: (response: Response) => Promise<unknown>) => async () => {
  const { response, closed, more } = await respond();
  refuse();
  more("more");
  await closed;
  return read(response);
};

const bucket = ({ url }: { url: URL }) =>
  new Bun.S3Client({ endpoint: url.href, bucket: "a", accessKeyId: "a", secretAccessKey: "a" });

function rewrite(rewriter: HTMLRewriter) {
  const { readable, writable } = new TransformStream();
  const response = rewriter.transform(new Response(readable));
  response.body;
  const writer = writable.getWriter();
  return { response, close: () => writer.write("first<p>").then(() => writer.close()) };
}

function textOf(rewriter: HTMLRewriter) {
  const { response, close } = rewrite(rewriter);
  const text = response.text();
  close().catch(() => {});
  return text;
}

const refuseAtTheEnd = () =>
  new HTMLRewriter().onDocument({
    end(end) {
      refuse();
      end.append("last");
    },
  });

const refuseAtAnElement = (then: (element: HTMLRewriterTypes.Element) => void | Promise<void>) =>
  new HTMLRewriter().on("p", {
    element(element) {
      refuse();
      return then(element);
    },
  });

const cases: Record<string, () => Promise<unknown>> = {
  async "text()"() {
    const { response, closed, more } = await respond();
    const text = response.text();
    refuse();
    more("more");
    return both(text, closed);
  },
  async "text() at the last part"() {
    const { response, last } = await respond();
    const text = response.text();
    refuse();
    last("last");
    return text;
  },
  async "a read() with less room than the part needs"() {
    const { response, closed, more } = await respond();
    const reader = response.body!.getReader();
    await reader.read();
    // The room goes by what the last one got.
    const short = reader.read();
    more("more");
    await short;
    const read = reader.read();
    refuse();
    more(Buffer.alloc(256 * 1024));
    return both(read, closed);
  },
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
    const s3 = bucket(server);
    await s3.write("a", response).catch(() => {});
    return await s3.write("a", response);
  }),
  "a later Bun.spawn()": later(async response => Bun.spawn({ cmd: ["cat"], stdin: response }).exited),
  async "text() of an upload that goes on"() {
    const cancelled = Promise.withResolvers<void>();
    const body = new ReadableStream({
      start: controller => controller.enqueue(Buffer.from("a")),
      cancel: () => cancelled.resolve(),
    });
    const { response, closed, more } = await respond({ method: "POST", body });
    const text = response.text();
    refuse();
    more("more");
    return both(both(text, closed), cancelled.promise);
  },
  async "text() at the last part of a download"() {
    using server = Bun.serve({ port: 0, fetch: () => new Response("last") });
    refuse();
    return await bucket(server).file("a").stream().text();
  },
  "text() of a rewrite": () => textOf(refuseAtTheEnd()),
  async "text() of a rewrite whose handler waits, and still has its element"() {
    const failed = Promise.withResolvers<void>();
    let handler!: Promise<void>;
    const wait = (element: HTMLRewriterTypes.Element) =>
      (handler = failed.promise.then(() => void element.tagName.length));
    return textOf(refuseAtAnElement(wait)).finally(() => (failed.resolve(), handler));
  },
  "text() of a rewrite with what its handler throws": () =>
    textOf(
      refuseAtAnElement(() => {
        throw new Error("thrown");
      }),
    ),
  async "a later text() of a rewrite"() {
    const { response, close } = rewrite(refuseAtTheEnd());
    await close();
    return response.text();
  },
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
