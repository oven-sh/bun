import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
import * as realFs from "node:fs";
import { Utf8Stream } from "node:fs";
import { join } from "node:path";

describe.concurrent("fs.Utf8Stream reopen", () => {
  // Deterministic reproduction of the test-fastutf8stream-reopen.js flake.
  //
  // After reopen(), fileOpened() emits 'ready' synchronously. If a listener on
  // 'ready' calls write(), that write starts an async fs.write and then
  // registers once('drain', ...) expecting it to fire when the write lands.
  // The post-reopen code path previously scheduled an unconditional
  // process.nextTick(() => emit('drain')) whenever `reopening` was true,
  // regardless of whether a write was already in flight. On a loaded machine
  // that nextTick would win the race against the threadpool worker performing
  // the write() syscall, and the 'drain' listener would observe an empty file.
  //
  // We make the race deterministic by holding the post-reopen fs.write until
  // after the microtask queue has drained, then asserting 'drain' only fires
  // once the write callback has been delivered.
  test("does not emit 'drain' while a write started in the 'ready' handler is still in flight", async () => {
    using dir = tempDir("utf8stream-reopen", {});
    const dest = join(String(dir), "out.log");
    const after = dest + "-moved";

    type HeldWrite = { fd: number; buf: string; enc: string; cb: (err: any, n?: number) => void };
    let holding = false;
    let held: HeldWrite | null = null;
    const fsOverride = {
      write(fd: number, buf: string, enc: string, cb: (err: any, n?: number) => void) {
        if (holding) {
          held = { fd, buf, enc, cb };
          return;
        }
        return (realFs.write as any)(fd, buf, enc, cb);
      },
    };

    const stream = new Utf8Stream({ dest, sync: false, fs: fsOverride });
    const events: string[] = [];

    stream.write("hello world\n");
    stream.write("something else\n");
    await once(stream, "drain");

    realFs.renameSync(dest, after);

    const readyHandled = Promise.withResolvers<void>();
    const drained = Promise.withResolvers<void>();
    let writeCallbackDelivered = false;
    let writingAfterReadyWrite: boolean | undefined;

    stream.once("ready", () => {
      events.push("ready");
      holding = true;
      stream.write("after reopen\n");
      writingAfterReadyWrite = stream.writing;
      stream.once("drain", () => {
        events.push("drain");
        drained.resolve();
      });
      readyHandled.resolve();
    });
    stream.reopen();

    await readyHandled.promise;
    expect(writingAfterReadyWrite).toBe(true);
    // After 'ready' returns, fileOpened may schedule process.nextTick(emit('drain')).
    // Give any such nextTick a chance to run before we assert.
    await new Promise<void>(r => process.nextTick(r));

    // The bug: 'drain' has already fired here even though fs.write's callback
    // has not. With the fix, 'drain' is held back until #release runs.
    expect({ events, writeCallbackDelivered }).toEqual({ events: ["ready"], writeCallbackDelivered: false });
    expect(held).not.toBeNull();

    // Now perform the held write and deliver its callback.
    const h = held!;
    holding = false;
    held = null;
    await new Promise<void>((resolve, reject) => {
      (realFs.write as any)(h.fd, h.buf, h.enc, (err: any, n: number) => {
        if (err) return reject(err);
        writeCallbackDelivered = true;
        h.cb(null, n);
        resolve();
      });
    });

    await drained.promise;
    expect({ events, writeCallbackDelivered }).toEqual({ events: ["ready", "drain"], writeCallbackDelivered: true });
    expect(realFs.readFileSync(dest, "utf8")).toBe("after reopen\n");
    expect(realFs.readFileSync(after, "utf8")).toBe("hello world\nsomething else\n");

    const closed = once(stream, "close");
    stream.end();
    await closed;
  });

  // Regression guard for the other direction: when nothing is written inside
  // the 'ready' handler, reopen() must still emit a 'drain' so callers that
  // queue work on once('drain') (test-fastutf8stream-reopen.js, block 5) make
  // progress.
  test("still emits 'drain' after reopen when no write happens in 'ready'", async () => {
    using dir = tempDir("utf8stream-reopen-nowrite", {});
    const dest = join(String(dir), "out.log");

    const stream = new Utf8Stream({ dest, sync: false });
    stream.write("first\n");
    await once(stream, "drain");

    stream.reopen();
    await once(stream, "drain");
    expect(stream.writing).toBe(false);

    stream.write("second\n");
    await once(stream, "drain");
    expect(realFs.readFileSync(dest, "utf8")).toBe("first\nsecond\n");

    const closed = once(stream, "close");
    stream.end();
    await closed;
  });
});
