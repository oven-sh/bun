import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { ChildProcess, spawn } from "node:child_process";
import fsp from "node:fs/promises";
import v8 from "node:v8";
import { join } from "path";

// Node's FileHandle is a native JSTransferable and ChildProcess carries a native
// Process at `_handle`, so V8's serializer rejects both as host objects. Bun's
// implementations are plain JS classes whose own string properties the serializer
// happily walked, producing an inert `{ _events, _eventsCount, ... }` stub with no
// fd/kill/etc. These tests assert the serializer now refuses them the way Node does.
describe("FileHandle and ChildProcess are not structured-cloneable", () => {
  const dataCloneError = expect.objectContaining({ name: "DataCloneError" });

  async function withFileHandle(fn: (fh: fsp.FileHandle) => void | Promise<void>) {
    using dir = tempDir("sc-fh", { "a.txt": "x" });
    const fh = await fsp.open(join(String(dir), "a.txt"), "r");
    try {
      await fn(fh);
    } finally {
      await fh.close();
    }
  }

  test("structuredClone(FileHandle) throws DataCloneError", async () => {
    await withFileHandle(fh => {
      expect(() => structuredClone(fh)).toThrow(dataCloneError);
      expect(() => structuredClone({ nested: fh })).toThrow(dataCloneError);
      expect(() => structuredClone([1, fh, 2])).toThrow(dataCloneError);
    });
  });

  test("v8.serialize(FileHandle) throws DataCloneError", async () => {
    await withFileHandle(fh => {
      expect(() => v8.serialize(fh)).toThrow(dataCloneError);
      expect(() => v8.serialize({ nested: fh })).toThrow(dataCloneError);
    });
  });

  test("FileHandle is still usable after a rejected clone", async () => {
    await withFileHandle(async fh => {
      expect(() => structuredClone(fh)).toThrow(dataCloneError);
      expect({
        fd: typeof fh.fd,
        read: typeof fh.read,
        keys: Object.keys(fh),
      }).toEqual({
        fd: "number",
        read: "function",
        keys: ["_events", "_eventsCount", "_maxListeners"],
      });
      const { bytesRead } = await fh.read(Buffer.alloc(1), 0, 1, 0);
      expect(bytesRead).toBe(1);
    });
  });

  test("structuredClone(ChildProcess) throws DataCloneError", () => {
    const cp = spawn(bunExe(), ["-e", "0"], { stdio: "ignore", env: bunEnv });
    try {
      expect(() => structuredClone(cp)).toThrow(dataCloneError);
      expect(() => structuredClone({ nested: cp })).toThrow(dataCloneError);
    } finally {
      cp.kill();
    }
  });

  test("v8.serialize(ChildProcess) throws DataCloneError", () => {
    const cp = spawn(bunExe(), ["-e", "0"], { stdio: "ignore", env: bunEnv });
    try {
      expect(() => v8.serialize(cp)).toThrow(dataCloneError);
      expect(() => v8.serialize({ nested: cp })).toThrow(dataCloneError);
    } finally {
      cp.kill();
    }
  });

  test("bare new ChildProcess() is also rejected", () => {
    const cp = new ChildProcess();
    expect(() => structuredClone(cp)).toThrow(dataCloneError);
    expect(() => v8.serialize(cp)).toThrow(dataCloneError);
  });

  test("MessagePort.postMessage(FileHandle) without transferList throws", async () => {
    await withFileHandle(fh => {
      const { port1, port2 } = new MessageChannel();
      try {
        expect(() => port2.postMessage(fh)).toThrow(dataCloneError);
        expect(() => port2.postMessage({ nested: fh })).toThrow(dataCloneError);
      } finally {
        port1.close();
        port2.close();
      }
    });
  });
});
