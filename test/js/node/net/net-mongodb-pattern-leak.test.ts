// Regression test for #12117: MongoDB driver memory leak.
//
// We can't depend on a real mongod in CI, so this exercises the exact
// node:net / node:tls patterns the mongodb 6.x driver uses on every command:
//
//   1. A long-lived client socket piped into a Transform (SizedMessageTransform).
//   2. Per-command: socket.setTimeout(N) → write → await async-iterator over the
//      Transform's 'data' events → socket.setTimeout(0). The async iterator is a
//      fresh closure-captured event-stream per command (mongodb's onData()).
//   3. Nested async generators with early return so the chain has to clean up
//      its listeners via .return().
//
// On a regressed build, per-command state was retained and JS-heap object
// counts (Timeout, Promise, AsyncGenerator, Function) grew linearly with
// commands. This asserts those counts and RSS stay flat after warmup over both
// TCP and TLS.
//
// The self-clearing-timer half of the original report (mongodb's
// MonitorInterval calling clearTimeout on the currently-firing timer) is
// covered separately by setTimeout-clear-in-callback-leak-fixture.js (#30058).

import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug, tls as tlsCerts } from "harness";
import { once } from "node:events";
import net from "node:net";
import { Transform } from "node:stream";
import tls from "node:tls";

// 4-byte big-endian length prefix → emits the body. Same shape as mongodb's
// SizedMessageTransform, just without BSON.
class SizedMessageTransform extends Transform {
  #buf: Buffer[] = [];
  #len = 0;
  override _transform(chunk: Buffer, _enc: string, cb: () => void) {
    this.#buf.push(chunk);
    this.#len += chunk.length;
    while (this.#len >= 4) {
      const head = this.#buf.length === 1 ? this.#buf[0] : Buffer.concat(this.#buf, this.#len);
      const want = head.readUInt32BE(0);
      if (this.#len < 4 + want) {
        this.#buf = [head];
        break;
      }
      this.push(head.subarray(4, 4 + want));
      const rest = head.subarray(4 + want);
      this.#buf = rest.length ? [rest] : [];
      this.#len = rest.length;
    }
    cb();
  }
}

// mongodb's onData(): adds 'data'/'error' listeners, yields events, removes
// listeners on .return(). One of these is created PER COMMAND.
function onData(emitter: NodeJS.EventEmitter) {
  const queue: Buffer[] = [];
  const waiters: { resolve: (v: IteratorResult<Buffer>) => void; reject: (e: unknown) => void }[] = [];
  let done = false;
  const eventHandler = (v: Buffer) => {
    const w = waiters.shift();
    if (w) w.resolve({ value: v, done: false });
    else queue.push(v);
  };
  const errorHandler = (e: unknown) => {
    const w = waiters.shift();
    if (w) w.reject(e);
    close();
  };
  const close = () => {
    if (done) return;
    done = true;
    emitter.off("data", eventHandler);
    emitter.off("error", errorHandler);
    for (const w of waiters) w.resolve({ value: undefined as never, done: true });
  };
  emitter.on("data", eventHandler);
  emitter.on("error", errorHandler);
  return {
    next(): Promise<IteratorResult<Buffer>> {
      const v = queue.shift();
      if (v) return Promise.resolve({ value: v, done: false });
      if (done) return Promise.resolve({ value: undefined as never, done: true });
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    return(): Promise<IteratorResult<Buffer>> {
      close();
      return Promise.resolve({ value: undefined as never, done: true });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function frame(body: Buffer) {
  const out = Buffer.allocUnsafe(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

async function makeServer(useTLS: boolean) {
  const handler = (sock: net.Socket) => {
    sock
      .pipe(new SizedMessageTransform())
      .on("data", (body: Buffer) => sock.write(frame(body)))
      .on("error", () => {});
    sock.on("error", () => {});
  };
  const srv = useTLS ? tls.createServer({ ...tlsCerts }, handler) : net.createServer(handler);
  srv.listen(0);
  await once(srv, "listening");
  return srv;
}

async function makeClient(port: number, useTLS: boolean) {
  return await new Promise<{ sock: net.Socket; messages: Transform }>((resolve, reject) => {
    const onReady = () => {
      const messages = new SizedMessageTransform();
      sock.on("error", () => {}).pipe(messages);
      resolve({ sock, messages });
    };
    const sock = useTLS
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, onReady)
      : net.connect({ port, host: "127.0.0.1" }, onReady);
    sock.once("error", reject);
  });
}

// One round-trip the way mongodb's `command()` does it: nested async generators
// with early-return so the iterator chain has to clean up its listeners.
async function command(sock: net.Socket, messages: Transform, body: Buffer) {
  async function* sendWire() {
    sock.setTimeout(30_000);
    try {
      if (!sock.write(frame(body))) await once(sock, "drain");
      for await (const msg of onData(messages)) {
        sock.setTimeout(0);
        yield msg;
        sock.setTimeout(30_000);
      }
    } finally {
      sock.setTimeout(0);
    }
  }
  for await (const reply of sendWire()) return reply; // early return → triggers .return() up the chain
  throw new Error("no reply");
}

function snapshot() {
  Bun.gc(true);
  const t = heapStats().objectTypeCounts;
  return {
    rss: process.memoryUsage.rss(),
    Timeout: t.Timeout || 0,
    Promise: t.Promise || 0,
    AsyncGenerator: t.AsyncGenerator || 0,
    Function: t.Function || 0,
    Object: t.Object || 0,
  };
}

describe.each([
  ["tcp", false],
  ["tls", true],
])("mongodb driver pattern over %s does not leak", (_name, useTLS) => {
  test("long-lived connection: framed command round-trips", async () => {
    const srv = await makeServer(useTLS);
    const { port } = srv.address() as net.AddressInfo;
    const { sock, messages } = await makeClient(port, useTLS);

    try {
      const body = Buffer.alloc(256, 0x61);
      const ITER = isDebug || isASAN ? 2_000 : 5_000;

      // Run the workload twice. Round 1 absorbs JIT, root-CA load and allocator
      // pool growth; round 2 is steady-state. We assert on round-2 vs round-1.
      const round = async () => {
        for (let i = 0; i < ITER; i++) {
          const reply = await command(sock, messages, body);
          if (i === 0) expect(reply!.equals(body)).toBe(true);
        }
        await new Promise<void>(r => setImmediate(() => queueMicrotask(r)));
        return snapshot();
      };

      const after1 = await round();
      const after2 = await round();

      // Precise signal: JS-heap object counts must be flat. These are the
      // types that grew unbounded in the issue's heapStats. A regression here
      // means per-command state is being retained (listeners not removed,
      // generator chain not cleaned up, Timeout wrappers held).
      expect(after2.Timeout - after1.Timeout).toBeLessThanOrEqual(2);
      expect(after2.AsyncGenerator - after1.AsyncGenerator).toBeLessThanOrEqual(2);
      expect(after2.Promise - after1.Promise).toBeLessThanOrEqual(10);
      expect(after2.Function - after1.Function).toBeLessThanOrEqual(20);

      // The Transform must not have accumulated listeners (onData removes its
      // pair on .return(); a missed cleanup would grow this by ITER).
      expect(messages.listenerCount("data")).toBe(0);
      expect(messages.listenerCount("error")).toBeLessThanOrEqual(1);

      // RSS round-2 vs round-1: weak signal (mimalloc segment noise) but
      // catches anything egregious that heapStats can't see.
      const rssBound = isASAN || isDebug ? 32 * 1024 * 1024 : 8 * 1024 * 1024;
      expect(after2.rss - after1.rss).toBeLessThan(rssBound);
    } finally {
      sock.destroy();
      messages.destroy();
      srv.close();
      await once(srv, "close");
    }
    // Debug/ASAN handshakes are slow; this is wall-clock crypto cost, not a
    // wait-for-condition.
  }, 60_000);
});
