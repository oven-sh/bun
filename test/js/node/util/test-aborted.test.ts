import { expect, test } from "bun:test";
import { getEventListeners } from "events";
import { aborted } from "util";

test("aborted works when provided a resource that was already aborted", () => {
  const ac = new AbortController();
  const abortedPromise = aborted(ac.signal, {});
  ac.abort();

  expect(ac.signal.aborted).toBe(true);
  expect(getEventListeners(ac.signal, "abort").length).toBe(0);
  return expect(abortedPromise).resolves.toBeUndefined();
});

test("aborted works when provided a resource that was not already aborted", async () => {
  const ac = new AbortController();
  var strong = {};
  globalThis.strong = strong;
  const abortedPromise = aborted(ac.signal, strong);
  expect(getEventListeners(ac.signal, "abort").length).toBe(1);
  const sleepy = Bun.sleep(10).then(() => {
    ac.abort();
  });
  await 42;
  expect(ac.signal.aborted).toBe(false);
  expect(Bun.peek.status(abortedPromise)).toBe("pending");
  await sleepy;
  await abortedPromise;
  expect(ac.signal.aborted).toBe(true);
  expect(getEventListeners(ac.signal, "abort").length).toBe(0);
  return expect(abortedPromise).resolves.toBeUndefined();
});

test("aborted with gc cleanup", async () => {
  const ac = new AbortController();
  const abortedPromise = aborted(ac.signal, {});

  await new Promise(resolve => setImmediate(resolve));
  Bun.gc(true);
  ac.abort();

  expect(ac.signal.aborted).toBe(true);
  expect(getEventListeners(ac.signal, "abort").length).toBe(0);
  return expect(await abortedPromise).toBeUndefined();
});

test("fails with error if not provided abort signal", async () => {
  const invalidSignals = [{}, null, undefined, Symbol(), [], 1, 0, 1n, true, false, "a", () => {}];

  for (const sig of invalidSignals) {
    await expect(() => aborted(sig, {})).toThrow();
  }
});

test("fails if not provided a resource", async () => {
  const ac = new AbortController();
  const invalidResources = [null, undefined, 0, 1, 0n, 1n, Symbol(), "", "a"];

  for (const resource of invalidResources) {
    await expect(() => aborted(ac.signal, resource)).toThrow();
  }
});
