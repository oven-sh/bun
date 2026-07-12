import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
import fs from "node:fs";
import { join } from "node:path";
import { markAsUntransferable, MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";

test("MessagePort.postMessage transfers a FileHandle", async () => {
  using dir = tempDir("port-fh-transfer", { "x.txt": "hello" });
  const fh = await fs.promises.open(join(String(dir), "x.txt"), "r");
  const origFd = fh.fd;
  const { port1, port2 } = new MessageChannel();
  let rx: any;
  try {
    const received = new Promise<any>(resolve => port1.on("message", resolve));
    port2.postMessage(fh, [fh as any]);
    rx = await received;
    expect(fh.fd).toBe(-1);
    expect(rx.fd).toBe(origFd);
    expect(typeof rx.read).toBe("function");
    const buf = Buffer.alloc(5);
    const { bytesRead } = await rx.read(buf, 0, 5, 0);
    expect(buf.toString("utf8", 0, bytesRead)).toBe("hello");
  } finally {
    if (rx?.fd >= 0) await rx.close();
    if (fh.fd !== -1) await fh.close();
    port1.close();
    port2.close();
  }
});

test("MessagePort.postMessage transfers a FileHandle with the {transfer} form", async () => {
  using dir = tempDir("port-fh-transfer", { "x.txt": "hello" });
  const fh = await fs.promises.open(join(String(dir), "x.txt"), "r");
  const { port1, port2 } = new MessageChannel();
  let rx: any;
  try {
    const received = new Promise<any>(resolve => port1.on("message", resolve));
    port2.postMessage({ handle: fh }, { transfer: [fh as any] } as any);
    rx = await received;
    expect(fh.fd).toBe(-1);
    expect(typeof rx.handle.read).toBe("function");
  } finally {
    if (rx?.handle?.fd >= 0) await rx.handle.close();
    if (fh.fd !== -1) await fh.close();
    port1.close();
    port2.close();
  }
});

test("receiveMessageOnPort reconstructs a transferred FileHandle", async () => {
  using dir = tempDir("port-fh-transfer", { "x.txt": "hello" });
  const fh = await fs.promises.open(join(String(dir), "x.txt"), "r");
  const { port1, port2 } = new MessageChannel();
  let res: any;
  try {
    port2.postMessage({ handle: fh, n: 1 }, [fh as any]);
    res = receiveMessageOnPort(port1) as any;
    expect(res.message.n).toBe(1);
    expect(typeof res.message.handle.read).toBe("function");
    expect(res.message.handle.fd).toBeGreaterThanOrEqual(0);
  } finally {
    if (res?.message?.handle?.fd >= 0) await res.message.handle.close();
    if (fh.fd !== -1) await fh.close();
    port1.close();
    port2.close();
  }
});

test("MessagePort.postMessage on an in-use FileHandle throws DataCloneError and leaves it usable", async () => {
  using dir = tempDir("port-fh-transfer", { "x.txt": "hello" });
  const fh = await fs.promises.open(join(String(dir), "x.txt"), "r");
  const pending = fh.read(Buffer.alloc(5), 0, 5, 0);
  const { port1, port2 } = new MessageChannel();
  let rx: any;
  try {
    expect(() => port2.postMessage(fh, [fh as any])).toThrow(expect.objectContaining({ name: "DataCloneError" }));
    await pending;
    expect(fh.fd).toBeGreaterThanOrEqual(0);
    const buf = Buffer.alloc(5);
    const { bytesRead } = await fh.read(buf, 0, 5, 0);
    expect(buf.toString("utf8", 0, bytesRead)).toBe("hello");
    // Once idle the same handle transfers (distinguishes the in-use rejection
    // from FileHandle not being a recognized transferable at all).
    const received = new Promise<any>(resolve => port1.on("message", resolve));
    port2.postMessage(fh, [fh as any]);
    rx = await received;
    expect(rx.fd).toBeGreaterThanOrEqual(0);
  } finally {
    if (rx?.fd >= 0) await rx.close();
    if (fh.fd !== -1) await fh.close();
    port1.close();
    port2.close();
  }
});

test("MessagePort.postMessage restores a transferred FileHandle when serialization fails", async () => {
  using dir = tempDir("port-fh-transfer", { "x.txt": "hello" });
  const fh = await fs.promises.open(join(String(dir), "x.txt"), "r");
  const { port1, port2 } = new MessageChannel();
  let rx: any;
  try {
    // The function is non-cloneable, so native postMessage throws after the
    // handle was already neutered; the rollback must restore it.
    expect(() => port2.postMessage({ fh, bad: () => {} }, [fh as any])).toThrow(
      expect.objectContaining({ name: "DataCloneError" }),
    );
    expect(fh.fd).toBeGreaterThanOrEqual(0);
    const buf = Buffer.alloc(5);
    const { bytesRead } = await fh.read(buf, 0, 5, 0);
    expect(buf.toString("utf8", 0, bytesRead)).toBe("hello");
    // A subsequent clean transfer of the restored handle succeeds.
    const received = new Promise<any>(resolve => port1.on("message", resolve));
    port2.postMessage(fh, [fh as any]);
    rx = await received;
    expect(rx.fd).toBeGreaterThanOrEqual(0);
  } finally {
    if (rx?.fd >= 0) await rx.close();
    if (fh.fd !== -1) await fh.close();
    port1.close();
    port2.close();
  }
});

test("MessagePort.postMessage rejects a FileHandle marked untransferable", async () => {
  using dir = tempDir("port-fh-transfer", { "x.txt": "hello" });
  const file = join(String(dir), "x.txt");
  const fh = await fs.promises.open(file, "r");
  const ok = await fs.promises.open(file, "r");
  markAsUntransferable(fh);
  const { port1, port2 } = new MessageChannel();
  let rx: any;
  try {
    // Second handle proves rollback restored the earlier neutered entry too.
    expect(() => port2.postMessage({ ok, fh }, [ok as any, fh as any])).toThrow(
      expect.objectContaining({ name: "DataCloneError" }),
    );
    expect(fh.fd).toBeGreaterThanOrEqual(0);
    expect(ok.fd).toBeGreaterThanOrEqual(0);
    // The unmarked handle still transfers on its own.
    const received = new Promise<any>(resolve => port1.on("message", resolve));
    port2.postMessage(ok, [ok as any]);
    rx = await received;
    expect(rx.fd).toBeGreaterThanOrEqual(0);
  } finally {
    if (rx?.fd >= 0) await rx.close();
    if (ok.fd !== -1) await ok.close();
    await fh.close();
    port1.close();
    port2.close();
  }
});

test("a FileHandle referenced twice in a posted message deserializes to one instance", async () => {
  using dir = tempDir("port-fh-transfer", { "x.txt": "hello" });
  const fh = await fs.promises.open(join(String(dir), "x.txt"), "r");
  const { port1, port2 } = new MessageChannel();
  let rx: any;
  try {
    const received = new Promise<any>(resolve => port1.on("message", resolve));
    port2.postMessage({ a: fh, b: fh }, [fh as any]);
    rx = await received;
    expect(rx.a).toBe(rx.b);
    await rx.a.close();
    expect(rx.b.fd).toBe(-1);
  } finally {
    if (rx?.a?.fd >= 0) await rx.a.close();
    if (fh.fd !== -1) await fh.close();
    port1.close();
    port2.close();
  }
});

test("Worker.postMessage and parentPort.postMessage transfer FileHandles", async () => {
  using dir = tempDir("worker-fh-post", {
    "x.txt": "hello",
    "w.mjs": `import { parentPort } from "node:worker_threads";
      import { open } from "node:fs/promises";
      parentPort.on("message", async ({ fh, file }) => {
        const buf = Buffer.alloc(5);
        const { bytesRead } = await fh.read(buf, 0, 5, 0);
        await fh.close();
        const out = await open(file, "r");
        parentPort.postMessage({ text: buf.toString("utf8", 0, bytesRead), back: out }, [out]);
      });`,
  });
  const file = join(String(dir), "x.txt");
  const fh = await fs.promises.open(file, "r");
  const worker = new Worker(join(String(dir), "w.mjs"));
  let reply: any;
  try {
    worker.postMessage({ fh, file }, [fh as any]);
    expect(fh.fd).toBe(-1);
    [reply] = await once(worker, "message");
    expect(reply.text).toBe("hello");
    expect(typeof reply.back.read).toBe("function");
    const buf = Buffer.alloc(5);
    const { bytesRead } = await reply.back.read(buf, 0, 5, 0);
    expect(buf.toString("utf8", 0, bytesRead)).toBe("hello");
  } finally {
    if (reply?.back?.fd >= 0) await reply.back.close();
    if (fh.fd !== -1) await fh.close();
    await worker.terminate();
  }
});
