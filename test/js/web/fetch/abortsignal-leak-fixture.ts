import { heapStats } from "bun:jsc";
import { expect } from "bun:test";
import { isASAN, isDebug, rss, tls } from "harness";

/** Same suite over HTTP/1.1 and HTTP/2 (server `http2: true`, client `protocol: "http2"`). */
export function createAbortSignalLeakSuite({ http2 = false }: { http2?: boolean } = {}) {
  const fetchOptions = http2 ? ({ protocol: "http2", tls: { rejectUnauthorized: false } } as const) : {};
  const fetch = (url: string, init: RequestInit = {}) => globalThis.fetch(url, { ...fetchOptions, ...init });
  let abortEventCount = 0;
  let onAbortHandler = () => {};
  let onRequestContinuePromise = Promise.withResolvers();
  let onRequestContinueHandler = () => {};
  const server = Bun.serve({
    port: 0,
    ...(http2 ? { tls, http2: true } : {}),
    // Set it to a long number so this test will time out if it's actually the idleTimeout.
    idleTimeout: 254,

    async fetch(req) {
      if (req.url.endsWith("/no-abort-event-just-req-signal")) {
        const signal = req.signal;
        signal.aborted;
        onRequestContinueHandler();
        await onRequestContinuePromise.promise;
        return new Response();
      }

      if (req.url.endsWith("/req-signal-aborted")) {
        const signal = req.signal;
        signal.addEventListener("abort", () => {
          abortEventCount++;
          onAbortHandler();
        });
        onRequestContinueHandler();
        await onRequestContinuePromise.promise;
        return new Response();
      }

      return new Response();
    },
  });

  function checkForLeaks(batchSize) {
    // AbortSignal often doesn't get cleaned up until the next full GC.
    Bun.gc(true);

    const { objectTypeCounts } = heapStats();
    console.log(objectTypeCounts);
    expect(objectTypeCounts.AbortSignal || 0).toBeLessThan(batchSize * 2);
  }

  // This test checks that calling req.signal doesn't cause the AbortSignal to be leaked.
  async function testReqSignalGetter() {
    const url = `${server.url}/req-signal-aborted`;
    const batchSize = 50;
    const iterations = isDebug || isASAN ? 15 : 50;

    async function batch() {
      onRequestContinuePromise = Promise.withResolvers();
      const promises = new Array(batchSize);
      const controllers = new Array(batchSize);
      let onRequestContinueCallCount = 0;
      onRequestContinueHandler = () => {
        onRequestContinueCallCount++;
        if (onRequestContinueCallCount === batchSize) {
          onRequestContinuePromise.resolve();
        }
      };
      for (let i = 0; i < batchSize; i++) {
        const controller = new AbortController();
        controllers[i] = controller;
        promises[i] = fetch(url, { signal: controller.signal }).catch(() => {});
      }
      await onRequestContinuePromise.promise;

      for (const controller of controllers) {
        controller.abort();
      }

      Bun.gc();
      await Promise.allSettled(promises);
    }

    await batch();

    const { objectTypeCounts } = heapStats();
    console.log(objectTypeCounts);
    for (let i = 0; i < iterations; i++) {
      await batch();
    }

    checkForLeaks(batchSize);
  }

  // This test checks that calling req.signal.addEventListener("abort", ...)
  // doesn't cause the AbortSignal to be leaked after the request is aborted.
  async function testReqSignalAbortEvent() {
    const url = `${server.url}/req-signal-aborted`;
    const batchSize = 50;
    const iterations = isDebug || isASAN ? 15 : 50;

    async function batch() {
      onRequestContinuePromise = Promise.withResolvers();
      const promises = new Array(batchSize);
      const controllers = new Array(batchSize);
      let onRequestContinueCallCount = 0;
      let onAbortCallCount = 0;

      let waitForRequests = Promise.withResolvers();
      onRequestContinueHandler = () => {
        onRequestContinueCallCount++;

        if (onRequestContinueCallCount === batchSize) {
          waitForRequests.resolve();
        }
      };
      onAbortHandler = () => {
        onAbortCallCount++;

        if (onAbortCallCount === batchSize) {
          onRequestContinuePromise.resolve();
        }
      };
      for (let i = 0; i < batchSize; i++) {
        const controller = new AbortController();
        controllers[i] = controller;
        promises[i] = fetch(url, { signal: controller.signal }).catch(() => {});
      }

      await waitForRequests.promise;
      await Bun.sleep(1);

      for (const controller of controllers) {
        controller.abort();
      }
      controllers.length = 0;

      await onRequestContinuePromise.promise;

      Bun.gc();
      await Promise.allSettled(promises);
    }
    await batch();

    const { objectTypeCounts } = heapStats();
    console.log(objectTypeCounts);
    for (let i = 0; i < iterations; i++) {
      await batch();
    }

    checkForLeaks(batchSize);
  }

  // This test checks that we decrement the pending activity count for the AbortSignal.
  async function testReqSignalAbortEventNeverResolves() {
    const url = `${server.url}/req-signal-aborted`;
    const batchSize = 50;
    const iterations = isDebug || isASAN ? 15 : 50;

    async function batch() {
      onRequestContinuePromise = Promise.withResolvers();
      const promises = new Array(batchSize);
      let onRequestContinueCallCount = 0;

      onAbortHandler = () => {
        throw new Error("abort event should not be emitted");
      };
      onRequestContinueHandler = () => {
        onRequestContinueCallCount++;
        if (onRequestContinueCallCount === batchSize) {
          onRequestContinuePromise.resolve();
        }
      };
      for (let i = 0; i < batchSize; i++) {
        promises[i] = fetch(url);
      }

      await onRequestContinuePromise.promise;
      await Bun.sleep(1);
      Bun.gc();
      await Promise.allSettled(promises);
    }

    await batch();

    for (let i = 0; i < iterations; i++) {
      await batch();
    }

    checkForLeaks(batchSize);
  }

  async function runAll() {
    let initialRSS = (rss() / 1024 / 1024) | 0;
    console.time("testReqSignalGetter");
    await testReqSignalGetter();
    console.timeEnd("testReqSignalGetter");
    let rssAfterReqSignalGetter = (rss() / 1024 / 1024) | 0;
    console.log(`RSS after testReqSignalGetter: ${rssAfterReqSignalGetter}`);
    console.log(`RSS delta after testReqSignalGetter: ${rssAfterReqSignalGetter - initialRSS}`);

    console.time("testReqSignalAbortEvent");
    await testReqSignalAbortEvent();
    console.timeEnd("testReqSignalAbortEvent");
    let rssAfterReqSignalAbortEvent = (rss() / 1024 / 1024) | 0;
    console.log(`RSS after testReqSignalAbortEvent: ${rssAfterReqSignalAbortEvent}`);
    console.log(`RSS delta after testReqSignalAbortEvent: ${rssAfterReqSignalAbortEvent - rssAfterReqSignalGetter}`);

    console.time("testReqSignalAbortEventNeverResolves");
    await testReqSignalAbortEventNeverResolves();
    console.timeEnd("testReqSignalAbortEventNeverResolves");
    let rssAfterReqSignalAbortEventNeverResolves = (rss() / 1024 / 1024) | 0;
    console.log(`RSS after testReqSignalAbortEventNeverResolves: ${rssAfterReqSignalAbortEventNeverResolves}`);
    console.log(
      `RSS delta after testReqSignalAbortEventNeverResolves: ${rssAfterReqSignalAbortEventNeverResolves - rssAfterReqSignalAbortEvent}`,
    );

    server.stop(true);
  }

  return { server, testReqSignalGetter, testReqSignalAbortEvent, testReqSignalAbortEventNeverResolves, runAll };
}

if (import.meta.main) {
  await createAbortSignalLeakSuite({ http2: process.argv.includes("--http2") }).runAll();
}
