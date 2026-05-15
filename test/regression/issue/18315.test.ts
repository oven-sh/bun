import { expect, test } from "bun:test";

test("cancel callback of 'direct' readable stream is called (lazy, never read)", async () => {
  let cancelled = false;
  let cancelReason: unknown;
  const sourceStream = new ReadableStream({
    type: "direct",
    pull() {},
    cancel(reason) {
      cancelled = true;
      cancelReason = reason;
    },
  });

  const reason = new Error("test cancel");
  await sourceStream.cancel(reason);

  expect(cancelled).toBe(true);
  expect(cancelReason).toBe(reason);
});

test("cancel callback of 'direct' readable stream is called (after reading)", async () => {
  let cancelled = false;
  let cancelReason: unknown;
  const sourceStream = new ReadableStream({
    type: "direct",
    async pull(controller) {
      controller.write("hello");
      controller.flush();
      // Keep the stream open so it can be cancelled
      await new Promise(() => {});
    },
    cancel(reason) {
      cancelled = true;
      cancelReason = reason;
    },
  });

  const reader = sourceStream.getReader();
  // Read one chunk to trigger controller initialization
  const chunk = await reader.read();
  expect(chunk.done).toBe(false);

  const reason = new Error("test cancel");
  await reader.cancel(reason);

  expect(cancelled).toBe(true);
  expect(cancelReason).toBe(reason);
});

test("cancel callback of 'direct' readable stream works with async cancel", async () => {
  let cancelled = false;
  const sourceStream = new ReadableStream({
    type: "direct",
    pull() {},
    async cancel() {
      await Bun.sleep(1);
      cancelled = true;
    },
  });

  await sourceStream.cancel();

  expect(cancelled).toBe(true);
});

test("cancel callback of 'direct' readable stream without cancel callback doesn't throw", async () => {
  const sourceStream = new ReadableStream({
    type: "direct",
    pull() {},
  });

  // Should not throw
  await sourceStream.cancel();
});
