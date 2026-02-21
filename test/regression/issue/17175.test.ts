import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/17175
// ReadableStream cancel callback should not be called on normal stream completion.
// Previously, the cancel callback was always invoked with `reason: undefined` even
// when the stream completed successfully.

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
  // Body may or may not contain data with explicit close(), just consume it
  await resp.text();
  await Bun.sleep(100);
  expect(cancelCalled).toBe(false);
});
