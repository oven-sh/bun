import { dlopen, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import { once } from "node:events";
import fs from "node:fs";

// Node's validation test is ported to test/js/node/test/parallel/test-fs-stream-windows-handle.js.
// These cover what its native addon test does, plus who closes the HANDLE.
describe.skipIf(!isWindows)("fs streams with windowsHandle", () => {
  const { symbols: k32 } = isWindows
    ? dlopen("kernel32.dll", {
        CreatePipe: { args: ["ptr", "ptr", "ptr", "u32"], returns: "i32" },
        GetHandleInformation: { args: ["u64", "ptr"], returns: "i32" },
        CloseHandle: { args: ["u64"], returns: "i32" },
      })
    : ({ symbols: {} } as any);

  function createPipe(): { readHandle: bigint; writeHandle: bigint } {
    const handles = new BigUint64Array(2);
    expect(k32.CreatePipe(ptr(handles), ptr(handles, 8), null, 0)).not.toBe(0);
    return { readHandle: handles[0], writeHandle: handles[1] };
  }

  function isOpen(handle: bigint): boolean {
    const flags = new Uint32Array(1);
    return k32.GetHandleInformation(handle, ptr(flags)) !== 0;
  }

  test("reads and writes through a pipe, then closes both handles", async () => {
    const { readHandle, writeHandle } = createPipe();
    const readable = fs.createReadStream(null as any, { windowsHandle: readHandle } as any);
    const writable = fs.createWriteStream(null as any, { windowsHandle: writeHandle } as any);
    expect(typeof readable.fd).toBe("number");
    expect(typeof writable.fd).toBe("number");
    expect(readable.pending).toBe(false);
    expect(writable.pending).toBe(false);
    expect(readable.path).toBeUndefined();
    expect(writable.path).toBeUndefined();

    const closed = Promise.all([once(readable, "close"), once(writable, "close")]);
    writable.end("payload");
    const chunks: Buffer[] = [];
    for await (const chunk of readable) chunks.push(chunk as Buffer);
    await closed;

    expect(Buffer.concat(chunks).toString()).toBe("payload");
    expect(readable.fd).toBeNull();
    expect(writable.fd).toBeNull();
    expect(isOpen(readHandle)).toBe(false);
    expect(isOpen(writeHandle)).toBe(false);
  });

  test("destroy() right after construction closes the handle", async () => {
    const { readHandle, writeHandle } = createPipe();
    const readable = fs.createReadStream(null as any, { windowsHandle: readHandle, autoClose: true } as any);
    const writable = fs.createWriteStream(null as any, { windowsHandle: writeHandle, autoClose: true } as any);
    const closed = Promise.all([once(readable, "close"), once(writable, "close")]);
    readable.destroy();
    writable.destroy();
    await closed;
    expect(isOpen(readHandle)).toBe(false);
    expect(isOpen(writeHandle)).toBe(false);
  });

  test("autoClose: false leaves the fd open for the caller to close", async () => {
    const { readHandle, writeHandle } = createPipe();
    const writable = fs.createWriteStream(null as any, { windowsHandle: writeHandle, autoClose: false } as any);
    const fd = writable.fd as number;
    writable.end("x");
    await once(writable, "finish");
    expect(isOpen(writeHandle)).toBe(true);
    fs.closeSync(fd);
    expect(isOpen(writeHandle)).toBe(false);
    expect(k32.CloseHandle(readHandle)).not.toBe(0);
  });

  test("a failed construction leaves the caller owning the handle", () => {
    const { readHandle, writeHandle } = createPipe();
    expect(() => fs.createReadStream(null as any, { windowsHandle: readHandle, start: -1 } as any)).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    expect(() => fs.createWriteStream(null as any, { windowsHandle: writeHandle, start: -1 } as any)).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    expect(k32.CloseHandle(readHandle)).not.toBe(0);
    expect(k32.CloseHandle(writeHandle)).not.toBe(0);
  });

  test("an invalid handle throws a system error", () => {
    for (const create of [fs.createReadStream, fs.createWriteStream]) {
      expect(() => create(null as any, { windowsHandle: 0n } as any)).toThrow(
        expect.objectContaining({ code: "EBADF", syscall: "_open_osfhandle" }),
      );
    }
  });
});
