import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/17175
// ReadableStream cancel callback should not be called on normal stream completion,
// but SHOULD be called when the client disconnects (abort).

test("direct ReadableStream cancel is not called on normal completion", async () => {
  let cancelCalled = false;
  let cancelReason: unknown = "not-called";

  using server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        type: "direct",
        async pull(controller) {
          controller.write("Hello");
          await controller.flush();
        },
        cancel(reason) {
          cancelCalled = true;
          cancelReason = reason;
        },
      });

      return new Response(stream, {
        headers: { "Content-Type": "text/plain" },
      });
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);
  const text = await resp.text();
  expect(text).toBe("Hello");
  // Give the server time to finalize the stream and call detach
  await Bun.sleep(100);
  expect(cancelCalled).toBe(false);
  expect(cancelReason).toBe("not-called");
});

test("direct ReadableStream cancel is not called with multiple writes", async () => {
  let cancelCalled = false;

  using server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        type: "direct",
        async pull(controller) {
          controller.write("a");
          await Bun.sleep(10);
          controller.write("b");
          await controller.flush();
        },
        cancel() {
          cancelCalled = true;
        },
      });

      return new Response(stream);
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);
  const text = await resp.text();
  expect(text).toBe("ab");
  await Bun.sleep(100);
  expect(cancelCalled).toBe(false);
});

test("direct ReadableStream cancel is not called with explicit close", async () => {
  let cancelCalled = false;

  using server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        type: "direct",
        async pull(controller) {
          controller.write("data");
          controller.close();
        },
        cancel() {
          cancelCalled = true;
        },
      });

      return new Response(stream);
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);
  await resp.text();
  await Bun.sleep(100);
  expect(cancelCalled).toBe(false);
});

test("direct ReadableStream cancel IS called on client disconnect (abort)", async () => {
  const { promise: cancelPromise, resolve: cancelResolve } = Promise.withResolvers<unknown>();

  using server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        type: "direct",
        async pull(controller) {
          // Write initial data
          controller.write("chunk1\n");
          await controller.flush();
          // Keep stream open with slow writes — client will disconnect during this
          for (let i = 0; i < 100; i++) {
            await Bun.sleep(50);
            controller.write(`chunk${i}\n`);
            await controller.flush();
          }
        },
        cancel(reason) {
          cancelResolve(reason);
        },
      });

      return new Response(stream, {
        headers: { "Content-Type": "text/plain" },
      });
    },
  });

  // Connect and read just the first chunk, then abort
  const controller = new AbortController();
  const resp = await fetch(`http://localhost:${server.port}/`, {
    signal: controller.signal,
  });

  // Read initial data
  const reader = resp.body!.getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toContain("chunk");

  // Abort the connection
  controller.abort();

  // cancel should be called with undefined (abort semantics)
  const cancelReason = await Promise.race([cancelPromise, Bun.sleep(5000).then(() => "TIMEOUT")]);
  expect(cancelReason).not.toBe("TIMEOUT");
  // Abort passes undefined as the reason to cancel
  expect(cancelReason).toBeUndefined();
});

test("async generator response body cancel is called on client disconnect", async () => {
  const { promise: cleanupPromise, resolve: cleanupResolve } = Promise.withResolvers<boolean>();

  using server = Bun.serve({
    port: 0,
    fetch() {
      async function* generate() {
        try {
          yield "chunk1\n";
          // Slow operation — client will disconnect during this
          for (let i = 0; i < 100; i++) {
            await Bun.sleep(50);
            yield `chunk${i}\n`;
          }
        } finally {
          cleanupResolve(true);
        }
      }
      return new Response(generate() as any);
    },
  });

  // Connect, read first chunk, then disconnect
  const controller = new AbortController();
  const resp = await fetch(`http://localhost:${server.port}/`, {
    signal: controller.signal,
  });

  const reader = resp.body!.getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toContain("chunk");

  // Disconnect
  controller.abort();

  // The generator's finally block should execute (cleanup via iter.return())
  const result = await Promise.race([cleanupPromise, Bun.sleep(5000).then(() => false)]);
  expect(result).toBe(true);
});
