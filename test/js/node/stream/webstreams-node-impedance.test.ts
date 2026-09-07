import { describe, expect, test } from "bun:test";
import { Readable, Writable, Transform, pipeline } from "node:stream";
import { promisify } from "node:util";

const streamPipeline = promisify(pipeline);

describe("WHATWG Web Streams <-> Node.js Streams Backpressure & Teardown", () => {
  test("Readable.toWeb enforces backpressure with slow Web sink", async () => {
    let produced = 0;
    let pausedTimes = 0;
    let resumedTimes = 0;

    const nodeReadable = new Readable({
      highWaterMark: 4,
      read() {
        if (produced < 15) {
          produced++;
          this.push(Buffer.from(`chunk-${produced}\n`));
        } else {
          this.push(null);
        }
      },
    });

    const origPause = nodeReadable.pause.bind(nodeReadable);
    nodeReadable.pause = function () {
      pausedTimes++;
      return origPause();
    };
    const origResume = nodeReadable.resume.bind(nodeReadable);
    nodeReadable.resume = function () {
      resumedTimes++;
      return origResume();
    };

    const webReadable = Readable.toWeb(nodeReadable);
    let consumed = 0;

    const slowWebWritable = new WritableStream({
      async write() {
        consumed++;
        await new Promise(r => setTimeout(r, 10));
      },
    });

    await webReadable.pipeTo(slowWebWritable);

    expect(consumed).toBe(15);
    expect(pausedTimes).toBeGreaterThan(0);
    expect(resumedTimes).toBeGreaterThan(0);
  });

  test("Readable.fromWeb preserves backpressure with pull-based Web source", async () => {
    let pullsIssued = 0;

    const webReadable = new ReadableStream({
      pull(controller) {
        pullsIssued++;
        controller.enqueue(Buffer.from(`item-${pullsIssued}`));
        if (pullsIssued >= 10) {
          controller.close();
        }
      },
    });

    const nodeReadable = Readable.fromWeb(webReadable);
    let nodeReceived = 0;

    const slowNodeWritable = new Writable({
      highWaterMark: 1,
      async write(chunk, encoding, callback) {
        nodeReceived++;
        await new Promise(r => setTimeout(r, 10));
        callback();
      },
    });

    await streamPipeline(nodeReadable, slowNodeWritable);

    expect(nodeReceived).toBe(10);
    expect(pullsIssued).toBe(10);
  });

  test("Readable.toWeb cleanly detaches data listeners when reader is canceled", async () => {
    let nodeDestroyed = false;
    let nodeDestroyReason: any = null;

    const nodeReadable = new Readable({
      read() {
        this.push("ping");
      },
      destroy(err, cb) {
        nodeDestroyed = true;
        nodeDestroyReason = err;
        cb(err);
      },
    });

    const webStream = Readable.toWeb(nodeReadable);
    const reader = webStream.getReader();

    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);

    const customReason = new Error("client-navigation-abort");
    await reader.cancel(customReason);

    expect(nodeDestroyed).toBe(true);
    expect(nodeDestroyReason).toBe(customReason);
  });

  test("Readable.fromWeb handles mid-stream abort signal without unhandled rejection", async () => {
    const ac = new AbortController();
    let webSourceCanceled = false;

    const webReadable = new ReadableStream({
      start(c) {
        let counter = 0;
        const timer = setInterval(() => {
          counter++;
          try {
            c.enqueue(Buffer.from(`item-${counter}\n`));
          } catch {
            clearInterval(timer);
          }
        }, 5);
        (this as any).timer = timer;
      },
      cancel() {
        webSourceCanceled = true;
        clearInterval((this as any).timer);
      },
    });

    let chunksProcessed = 0;
    const slowTransform = new Transform({
      transform(chunk, encoding, callback) {
        chunksProcessed++;
        if (chunksProcessed === 3) {
          ac.abort(new Error("aborted-midstream"));
        }
        setTimeout(() => callback(null, chunk), 10);
      },
    });

    const blackHole = new Writable({
      write(chunk, encoding, cb) {
        cb();
      },
    });

    let caughtError: any = null;
    try {
      await streamPipeline(Readable.fromWeb(webReadable), slowTransform, blackHole, { signal: ac.signal });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.name).toBe("AbortError");
    expect(webSourceCanceled).toBe(true);
  });
});
