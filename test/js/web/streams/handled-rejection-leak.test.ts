import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("promises the streams code rejects and marks handled are not rooted until the event loop turns", () => {
  // The streams code rejects some of its own promises and sets [[PromiseIsHandled]] on them:
  // reader.closed and writer.ready/closed on release or on a stream error, the promise that
  // pipeThrough() drops, the stream-level closed promise behind node:stream's finished(). When the
  // flag was set after the rejection, the promise was already queued for 'unhandledRejection', and
  // it stayed in that queue, rooted together with its reason, until the microtask queue was empty.
  // Each body runs N times inside one microtask-only section, so the event loop never turns.
  const N = 200;
  const bodies = {
    "reader.releaseLock()": `
      const reader = new ReadableStream({ start(c) { c.enqueue(1); } }).getReader();
      await reader.read();
      reader.releaseLock();`,
    "reader.releaseLock() on a closed stream": `
      const reader = new ReadableStream({ start(c) { c.close(); } }).getReader();
      await reader.closed;
      reader.releaseLock();`,
    "for await": `
      for await (const chunk of new ReadableStream({ start(c) { c.enqueue(1); c.close(); } })) {}`,
    "getReader() on an errored stream": `
      await errored().getReader().read().catch(() => {});`,
    "a stream errors under its reader": `
      let controller;
      const reader = new ReadableStream({ start(c) { controller = c; } }).getReader();
      controller.error(error);
      await reader.read().catch(() => {});`,
    "writer.releaseLock()": `
      const writer = new WritableStream({}).getWriter();
      await writer.ready;
      writer.releaseLock();`,
    "a stream errors under its writer": `
      const writer = new WritableStream({}).getWriter();
      await writer.abort(error);`,
    "getWriter() on an errored stream": `
      const stream = new WritableStream({});
      await stream.abort(error);
      stream.getWriter();`,
    "pipeTo()": `
      await new ReadableStream({ start(c) { c.enqueue(1); c.close(); } }).pipeTo(new WritableStream({}));`,
    "pipeThrough() from an errored stream": `
      await errored().pipeThrough(new TransformStream()).getReader().read().catch(() => {});`,
    "new Response(stream).text()": `
      await new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); c.close(); } })).text();`,
    "finished() on an errored stream": `
      await new Promise(resolve => require("node:stream").finished(errored(), resolve));`,
  };

  test.concurrent.each(Object.entries(bodies))("%s", async (name, body) => {
    const script = /* js */ `
      const { heapStats } = require("bun:jsc");
      const error = new Error("boom");
      const errored = () => new ReadableStream({ start(c) { c.error(error); } });
      const row = async () => {${body}
      };
      const promises = () => {
        Bun.gc(true);
        return heapStats().objectTypeCounts.Promise ?? 0;
      };
      await row();
      const before = promises();
      for (let i = 0; i < ${N}; i++) await row();
      console.log(promises() - before);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // One to six promises per iteration stayed rooted. Collected, the count ends within a few of where it began.
    expect(Number(stdout)).toBeLessThan(N / 2);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a rejection the caller can observe is still reported", async () => {
    const script = /* js */ `
      const reported = [];
      process.on("unhandledRejection", reason => reported.push(reason.message));
      const errored = message => new ReadableStream({ start(c) { c.error(new Error(message)); } });

      // The caller receives these promises and drops them.
      errored("cancel()").cancel();
      errored("pipeTo()").pipeTo(new WritableStream({}));
      errored("read()").getReader().read();

      // Only the streams code ever holds these.
      errored("reader.closed").getReader();
      errored("pipeThrough()").pipeThrough(new TransformStream()).getReader().read().catch(() => {});
      new ReadableStream({}).getReader().releaseLock();
      await new WritableStream({}).getWriter().abort(new Error("writer.ready and writer.closed"));

      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify(reported.sort()));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["cancel()", "pipeTo()", "read()"]);
    expect(exitCode).toBe(0);
  });
});
