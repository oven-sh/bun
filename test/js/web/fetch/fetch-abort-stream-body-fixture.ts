// Regression: aborting a fetch() whose request body is a JS ReadableStream
// would call ResumableSink.cancel() twice (once from the abort listener, once
// from the HTTP failure callback). The second cancel() re-invoked
// FetchTasklet.writeEndRequest -> over-deref -> use-after-free.

let onServerGotChunk: () => void = () => {};

using server = Bun.serve({
  port: 0,
  async fetch(req) {
    const reader = req.body!.getReader();
    // Read the first chunk so the client knows its request-stream sink is
    // attached and writing, then stall so the client aborts mid-upload.
    await reader.read();
    onServerGotChunk();
    await reader.read().catch(() => {});
    return new Response("unreachable");
  },
});

const url = server.url.href;
const ITERATIONS = 50;

for (let i = 0; i < ITERATIONS; i++) {
  const controller = new AbortController();
  const { promise: serverGotChunk, resolve } = Promise.withResolvers<void>();
  onServerGotChunk = resolve;

  const body = new ReadableStream({
    pull(c) {
      c.enqueue(new TextEncoder().encode("hello"));
      // never close — keep the upload pending so abort lands mid-stream
    },
  });

  const req = fetch(url, {
    method: "POST",
    body,
    signal: controller.signal,
    // @ts-ignore
    duplex: "half",
  });

  // Wait until the server has received the first chunk, which proves the
  // FetchTasklet's request-body ResumableSink is attached and in-flight.
  await serverGotChunk;

  controller.abort();

  let err: unknown;
  try {
    await req;
  } catch (e) {
    err = e;
  }
  if (!(err instanceof Error) || err.name !== "AbortError") {
    console.error("iteration", i, "did not reject with AbortError:", err);
    process.exit(1);
  }

  // Give the HTTP-thread failure callback a chance to land and call
  // sink.cancel() a second time.
  await Bun.sleep(0);
  await Bun.sleep(0);
  Bun.gc(true);
}

console.log(`done ${ITERATIONS}`);
