import { test, expect, mock } from "bun:test";

test("cancel() is called on a ReadableStream which passes invalid arguments to enqueue()", async () => {
  var defer = Promise.withResolvers();
  var onCancel = Promise.withResolvers();

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(
        new ReadableStream({
          async pull(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            await Bun.sleep(10);
            defer.resolve();
            // Invalid argument
            controller.enqueue([new Uint8Array(32)]);
          },
          cancel(reason) {
            onCancel.resolve(reason);
          },
        }),
      );
    },
  });

  const resp = await fetch(server.url);
  resp.body;
  await defer.promise;
  expect(await resp.bytes()).toEqual(new Uint8Array([1, 2, 3]));
  server.stop(true);
  expect(await onCancel.promise).toBeInstanceOf(TypeError);
});

// This is mostly to test we don't crash in this case.
test("cancel() is NOT called on a ReadableStream with invalid arguments and close called", async () => {
  var defer = Promise.withResolvers();
  var cancel = mock(() => {});
  var endOfPullFunction = mock(() => {});

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(
        new ReadableStream({
          async pull(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            await Bun.sleep(10);
            defer.resolve();
            // Invalid argument
            controller.enqueue([new Uint8Array(32)]);
            controller.close();
            endOfPullFunction();
          },
          cancel,
        }),
      );
    },
  });

  const resp = await fetch(server.url);
  resp.body;
  await defer.promise;
  expect(await resp.bytes()).toEqual(new Uint8Array([1, 2, 3]));
  server.stop(true);
  await Bun.sleep(10);
  expect(cancel).not.toHaveBeenCalled();
  expect(endOfPullFunction).toHaveBeenCalled();
});
