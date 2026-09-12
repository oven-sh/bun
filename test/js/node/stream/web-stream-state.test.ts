import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { isDisturbed, isErrored, isReadable } from "node:stream";
import { finished } from "node:stream/promises";

test("node:stream observes ReadableStream state", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });

  expect(isReadable(stream)).toBe(true);
  expect(isErrored(stream)).toBe(false);
  expect(isDisturbed(stream)).toBe(false);

  controller.enqueue(new Uint8Array([1]));
  const reader = stream.getReader();
  await reader.read();
  expect(isReadable(stream)).toBe(true);
  expect(isDisturbed(stream)).toBe(true);

  controller.close();
  await reader.closed;
  expect(isReadable(stream)).toBe(false);
  expect(isErrored(stream)).toBe(false);
});

test("node:stream observes errored ReadableStreams", () => {
  let controller!: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(value) {
      controller = value;
    },
  });

  controller.error(new Error("fixture stream error"));

  expect(isReadable(stream)).toBe(false);
  expect(isErrored(stream)).toBe(true);
});

// fetch(), Bun.write(), Bun.serve(), Bun.spawn() and HTMLRewriter read a fetch() body or a
// Bun.file() stream in native code, without a reader. The stream stays locked to the consumer.
// It must leave the readable state when the consumer is done with it.
describe.concurrent("a stream that a native consumer takes", () => {
  const state = (stream: ReadableStream) => ({
    readable: isReadable(stream),
    errored: isErrored(stream),
    disturbed: isDisturbed(stream),
    locked: stream.locked,
    inspect: /state: '(\w+)'/.exec(Bun.inspect(stream))?.[1],
  });
  const closed = { readable: false, errored: false, disturbed: true, locked: true, inspect: "closed" };
  const errored = { readable: false, errored: true, disturbed: true, locked: true, inspect: "errored" };

  // Serves "first last". "last" leaves only after finish(), so the body is still in flight when
  // the client attaches its consumer: the consumer streams it instead of taking a finished buffer.
  function heldUpstream() {
    const { promise: released, resolve: finish } = Promise.withResolvers<void>();
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(new TextEncoder().encode("first "));
              await released;
              controller.enqueue(new TextEncoder().encode("last"));
              controller.close();
            },
          }),
        ),
    });
    return { url: server.url, finish, [Symbol.asyncDispose]: () => server.stop(true) };
  }

  // Each consumer attaches to `response`, calls finish() once it is attached, and resolves when
  // it has taken the whole body.
  const consumers: Record<string, (response: Response, finish: () => void) => Promise<void>> = {
    "a fetch() request body": async (response, finish) => {
      await using sink = Bun.serve({
        port: 0,
        async fetch(request) {
          let length = 0;
          // The upload is attached once its first bytes arrive here.
          for await (const chunk of request.body!) {
            length += chunk.length;
            finish();
          }
          return new Response(String(length));
        },
      });
      const upload = await fetch(sink.url, { method: "POST", body: response.body });
      expect(await upload.text()).toBe("10");
    },
    "Bun.write()": async (response, finish) => {
      using dir = tempDir("web-stream-state", {});
      const written = Bun.write(join(dir, "out"), response);
      finish();
      expect(await written).toBe(10);
    },
    "a Bun.serve() response body": async (response, finish) => {
      await using proxy = Bun.serve({ port: 0, fetch: () => new Response(response.body) });
      const proxied = await fetch(proxy.url);
      finish();
      expect(await proxied.text()).toBe("first last");
    },
    "Bun.spawn() stdin": async (response, finish) => {
      await using child = Bun.spawn({
        cmd: [bunExe(), "-e", "process.stdout.write(String((await Bun.stdin.bytes()).length))"],
        env: bunEnv,
        stdin: response,
        stdout: "pipe",
        stderr: "inherit",
      });
      finish();
      const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
      expect({ stdout, exitCode }).toEqual({ stdout: "10", exitCode: 0 });
    },
    "HTMLRewriter": async (response, finish) => {
      const rewritten = new HTMLRewriter()
        .on("b", { element() {} })
        .transform(response)
        .text();
      finish();
      expect(await rewritten).toBe("first last");
    },
  };

  for (const [name, consume] of Object.entries(consumers)) {
    test(`closes after ${name} takes it to the end`, async () => {
      await using upstream = heldUpstream();
      const response = await fetch(upstream.url);
      const body = response.body!;
      await consume(response, upstream.finish);
      expect(state(body)).toEqual(closed);
      await finished(body);
    });
  }

  test("errors with the failure of its producer", async () => {
    // Serves a chunked body and drops the connection in the middle of it.
    const connections: { end(): void }[] = [];
    using upstream = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nfirst \r\n");
          connections.push(socket);
        },
      },
    });
    using dir = tempDir("web-stream-state", {});
    const response = await fetch(`http://127.0.0.1:${upstream.port}/`);
    const body = response.body!;
    const written = Bun.write(join(dir, "out"), response);
    for (const connection of connections) connection.end();
    const error = await written.catch(error => error);
    expect(error.code).toBe("ECONNRESET");
    expect(state(body)).toEqual(errored);
    expect(await finished(body).catch(error => error)).toBe(error);
  });

  test("closes when its consumer stops early", async () => {
    await using upstream = heldUpstream();
    const response = await fetch(upstream.url);
    const body = response.body!;
    const abort = new AbortController();
    await using sink = Bun.serve({
      port: 0,
      async fetch(request) {
        // The upload is attached once its first bytes arrive here.
        await request.body!.getReader().read();
        abort.abort();
        return new Response();
      },
    });
    const upload = fetch(sink.url, { method: "POST", body, signal: abort.signal });
    expect(await upload.catch(error => error.name)).toBe("AbortError");
    expect(state(body)).toEqual(closed);
    await finished(body);
  });

  test("closes a Bun.file() stream after a fetch() request body takes it to the end", async () => {
    using dir = tempDir("web-stream-state", { "in.txt": "first last" });
    const stream = Bun.file(join(dir, "in.txt")).stream();
    await using sink = Bun.serve({ port: 0, fetch: async request => new Response(await request.text()) });
    const upload = await fetch(sink.url, { method: "POST", body: stream });
    expect(await upload.text()).toBe("first last");
    expect(state(stream)).toEqual(closed);
    await finished(stream);
  });

  test("errors a Bun.file() stream whose file does not open", async () => {
    using dir = tempDir("web-stream-state", {});
    const stream = Bun.file(join(dir, "missing")).stream();
    const error = await Bun.write(join(dir, "out"), stream).catch(error => error);
    expect(error.code).toBe("ENOENT");
    expect(state(stream)).toEqual(errored);
    expect(await finished(stream).catch(error => error)).toBe(error);
  });
});
