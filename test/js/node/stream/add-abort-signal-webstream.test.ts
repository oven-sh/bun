import { test, expect, describe } from "bun:test";
import { addAbortSignal } from "node:stream";

// node:stream's addAbortSignal is documented to accept WHATWG web streams since Node 19 and
// to error them through their controller on abort. Bun's web streams are native and do not
// carry Node's Symbol.for("nodejs.webstream.controllerErrorFunction") own property, so the
// abort handler must route through the real controller-error path instead.

describe("addAbortSignal on web streams", () => {
  test("ReadableStream: already-aborted signal errors the stream", async () => {
    const ac = new AbortController();
    ac.abort();
    const rs = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array([1]));
      },
    });
    expect(addAbortSignal(ac.signal, rs)).toBe(rs);
    const err = await rs
      .getReader()
      .read()
      .then(
        () => null,
        e => e,
      );
    expect(err).not.toBeNull();
    expect(err.name).toBe("AbortError");
    expect(err.code).toBe("ABORT_ERR");
  });

  test("ReadableStream: aborting after registration rejects a pending read", async () => {
    const ac = new AbortController();
    const reason = new Error("stop");
    const rs = new ReadableStream({
      pull(c) {
        queueMicrotask(() => c.enqueue(new Uint8Array([2])));
      },
    });
    addAbortSignal(ac.signal, rs);
    const reader = rs.getReader();
    const pending = reader.read().then(
      v => ({ ok: true, v }),
      e => ({ ok: false, e }),
    );
    let uncaught: unknown = null;
    const onUncaught = (e: unknown) => (uncaught = e);
    process.on("uncaughtException", onUncaught);
    try {
      ac.abort(reason);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
    const result = (await pending) as any;
    expect(uncaught).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.e.name).toBe("AbortError");
    expect(result.e.cause).toBe(reason);
    const closed = await reader.closed.then(
      () => null,
      e => e,
    );
    expect(closed?.name).toBe("AbortError");
  });

  test("ReadableStream (bytes): abort errors a byte stream", async () => {
    const ac = new AbortController();
    const rs = new ReadableStream({
      type: "bytes",
      pull(c) {
        c.enqueue(new Uint8Array([3]));
      },
    });
    addAbortSignal(ac.signal, rs);
    ac.abort();
    const err = await rs
      .getReader()
      .read()
      .then(
        () => null,
        e => e,
      );
    expect(err?.name).toBe("AbortError");
  });

  test("WritableStream: abort rejects a pending write and closed", async () => {
    const ac = new AbortController();
    const ws = new WritableStream({
      write() {
        return new Promise(() => {});
      },
    });
    addAbortSignal(ac.signal, ws);
    const writer = ws.getWriter();
    const pending = writer.write("hello").then(
      () => null,
      e => e,
    );
    ac.abort();
    const err = await pending;
    expect(err?.name).toBe("AbortError");
    const closed = await writer.closed.then(
      () => null,
      e => e,
    );
    expect(closed?.name).toBe("AbortError");
  });

  test("WritableStream: already-aborted signal errors the stream", async () => {
    const ac = new AbortController();
    ac.abort();
    const ws = new WritableStream();
    addAbortSignal(ac.signal, ws);
    const writer = ws.getWriter();
    const err = await writer.write("x").then(
      () => null,
      e => e,
    );
    expect(err?.name).toBe("AbortError");
  });

  test("TransformStream: already-aborted signal errors both readable and writable sides", async () => {
    const ac = new AbortController();
    ac.abort();
    const ts = new TransformStream();
    addAbortSignal(ac.signal, ts);
    const readErr = await ts.readable
      .getReader()
      .read()
      .then(
        () => null,
        e => e,
      );
    const writeErr = await ts.writable
      .getWriter()
      .write("x")
      .then(
        () => null,
        e => e,
      );
    expect(readErr?.name).toBe("AbortError");
    expect(writeErr?.name).toBe("AbortError");
  });

  test("no-op once the stream is already errored", async () => {
    const ac = new AbortController();
    let controller!: ReadableStreamDefaultController;
    const rs = new ReadableStream({
      start(c) {
        controller = c;
      },
    });
    const first = new Error("first");
    controller.error(first);
    addAbortSignal(ac.signal, rs);
    ac.abort();
    const err = await rs
      .getReader()
      .read()
      .then(
        () => null,
        e => e,
      );
    expect(err).toBe(first);
  });
});
