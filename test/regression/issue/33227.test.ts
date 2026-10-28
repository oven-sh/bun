import { sleep } from "bun";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/33227
test("reader.cancel() aborts the fetch and triggers the server's stream cancel", async () => {
  const { promise: sawAbort, resolve: onAbort } = Promise.withResolvers<void>();
  const { promise: sawCancel, resolve: onCancel } = Promise.withResolvers<void>();
  const encoder = new TextEncoder();

  using server = Bun.serve({
    port: 0,
    fetch(request) {
      request.signal.addEventListener("abort", () => onAbort());
      let count = 0;
      return new Response(
        new ReadableStream({
          // Stream forever (paced) so the body is always in flight: the unfixed
          // drain path keeps the connection open and actively reading, so the
          // server never sees a close unless the cancel actually aborts.
          async pull(controller) {
            controller.enqueue(encoder.encode(`data: ${count++}\n\n`));
            await sleep(10);
          },
          cancel() {
            onCancel();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });

  const res = await fetch(`http://localhost:${server.port}`, { method: "POST" });
  const reader = res.body!.getReader();

  const first = await reader.read();
  expect(first.done).toBe(false);
  expect(first.value!.byteLength).toBeGreaterThan(0);

  await reader.cancel();

  // Cancelling the reader must abort the fetch and close the connection, so the
  // server observes request.signal's abort and runs the body stream's cancel().
  await Promise.all([sawAbort, sawCancel]);
});
