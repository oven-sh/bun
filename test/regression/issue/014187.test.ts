import { expect, test } from "bun:test";
import { EventEmitter, on } from "events";

test("issue-14187", async () => {
  const ac = new AbortController();
  const ee = new EventEmitter();

  async function* gen() {
    for await (const item of on(ee, "beep", { signal: ac.signal })) {
      yield item;
    }
  }

  const iterator = gen();

  iterator.next().catch(() => {});

  expect(ee.listenerCount("beep")).toBe(1);
  expect(ee.listenerCount("error")).toBe(1);
  ac.abort();

  expect(ee.listenerCount("beep")).toBe(0);
  expect(ee.listenerCount("error")).toBe(0);
});
