import { expect, it, jest } from "bun:test";
import { bunEnv, bunExe, gc, isLinux, isMacOS, isWindows } from "harness";
import { readFileSync } from "node:fs";

it("arrayBufferToString u8", async () => {
  var encoder = new TextEncoder();
  const bytes = encoder.encode("hello world");
  gc(true);
  expect(Bun.unsafe.arrayBufferToString(bytes)).toBe("hello world");
  gc(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  gc(true);
});

it("arrayBufferToString ArrayBuffer", async () => {
  var encoder = new TextEncoder();
  var bytes = encoder.encode("hello world");
  gc(true);
  const out = Bun.unsafe.arrayBufferToString(bytes.buffer);
  expect(out).toBe("hello world");
  gc(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  globalThis.bytes = bytes;
  gc(true);
  expect(out).toBe("hello world");
});

it("arrayBufferToString u16", () => {
  var encoder = new TextEncoder();
  const bytes = encoder.encode("hello world");
  var uint16 = new Uint16Array(bytes.byteLength);
  uint16.set(bytes);
  const charCodes = Bun.unsafe
    .arrayBufferToString(uint16)
    .split("")
    .map(a => a.charCodeAt(0));
  gc(true);
  for (let i = 0; i < charCodes.length; i++) {
    expect("hello world"[i]).toBe(String.fromCharCode(charCodes[i]));
  }
  gc(true);
  expect(charCodes.length).toBe("hello world".length);
  gc(true);
});

it.concurrent("arrayBufferToString u16 at an odd address", async () => {
  const texts = ["hello world", "h\u00e9llo w\u2603rld"];
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { ptr, toArrayBuffer } from "bun:ffi";
        const out = ${JSON.stringify(texts)}.map(text => {
          const bytes = new Uint8Array(1 + text.length * 2);
          const view = new DataView(bytes.buffer);
          for (let i = 0; i < text.length; i++) view.setUint16(1 + i * 2, text.charCodeAt(i), true);
          const address = ptr(bytes) + 1;
          const units = new Uint16Array(toArrayBuffer(address, 0, text.length * 2));
          return [address % 2, Bun.unsafe.arrayBufferToString(units), bytes[0]];
        });
        console.log(JSON.stringify(out));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(texts.map(text => [1, text, 0]));
  expect(exitCode).toBe(0);
});

it("arrayBufferToString u16 of nothing", () => {
  expect(Bun.unsafe.arrayBufferToString(new Uint16Array(0))).toBe("");
  const detached = new Uint16Array(4);
  detached.buffer.transfer();
  expect(Bun.unsafe.arrayBufferToString(detached)).toBe("");
});

it("Bun.allocUnsafe", () => {
  var buffer = Bun.allocUnsafe(1024);
  expect(buffer instanceof Uint8Array).toBe(true);
  expect(buffer.length).toBe(1024);
  buffer[0] = 0;
  expect(buffer[0]).toBe(0);
  expect(Bun.allocUnsafe(0).length).toBe(0);
  expect(Bun.allocUnsafe(-0).length).toBe(0);
});

it("Bun.allocUnsafe takes an integer that fits 32 bits", () => {
  const valueOf = jest.fn(() => 1);
  for (const [size, received] of [
    [undefined, "undefined"],
    [null, "null"],
    [true, "type boolean (true)"],
    ["1", "type string ('1')"],
    [3n, "type bigint (3n)"],
    [{ valueOf }, "an instance of Object"],
  ]) {
    expect(() => Bun.allocUnsafe(size)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "size" argument must be of type number. Received ${received}`,
      }),
    );
  }
  expect(valueOf).not.toHaveBeenCalled();
  for (const size of [1.5, NaN, Infinity]) {
    expect(() => Bun.allocUnsafe(size)).toThrow(
      expect.objectContaining({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "size" is out of range. It must be an integer. Received ${size}`,
      }),
    );
  }
  for (const [size, received] of [
    [-1, "-1"],
    [2 ** 32, "4294967296"],
    [2 ** 53, "9_007_199_254_740_992"],
  ]) {
    expect(() => Bun.allocUnsafe(size)).toThrow(
      expect.objectContaining({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "size" is out of range. It must be >= 0 && <= 4294967295. Received ${received}`,
      }),
    );
  }
});

it("Bun.unsafe is a plain object of functions", () => {
  expect(Object.getPrototypeOf(Bun.unsafe)).toBe(Object.prototype);
  expect(Bun.unsafe).toBe(Bun.unsafe);
  expect(
    Object.entries(Object.getOwnPropertyDescriptors(Bun.unsafe)).map(([key, { value, ...attributes }]) => ({
      key,
      name: value.name,
      length: value.length,
      ...attributes,
    })),
  ).toEqual(
    [
      ["gcAggressionLevel", 0],
      ["arrayBufferToString", 1],
      ["mimallocDump", 0],
      ["memoryFootprint", 0],
      ["setJITPolicy", 1],
    ].map(([key, length]) => ({ key, name: key, length, writable: true, enumerable: true, configurable: true })),
  );
});

it("Bun.unsafe.gcAggressionLevel returns the level it replaces", () => {
  const initial = Bun.unsafe.gcAggressionLevel();
  try {
    Bun.unsafe.gcAggressionLevel(0);
    expect(Bun.unsafe.gcAggressionLevel(1)).toBe(0);
    expect(Bun.unsafe.gcAggressionLevel("2")).toBe(1);
    expect(Bun.unsafe.gcAggressionLevel(0.9)).toBe(2);
    expect(Bun.unsafe.gcAggressionLevel(1)).toBe(0);
    // Nothing, and a level there is not, change nothing.
    for (const level of [undefined, null, 3, -1, 2 ** 32, 2 ** 32 + 2, "4294967298", Infinity]) {
      expect(Bun.unsafe.gcAggressionLevel(level)).toBe(1);
    }
    expect(() => Bun.unsafe.gcAggressionLevel(Symbol())).toThrow(
      expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a number" }),
    );
    expect(() => Bun.unsafe.gcAggressionLevel(1n)).toThrow(
      expect.objectContaining({ name: "TypeError", message: "Conversion from 'BigInt' to 'number' is not allowed." }),
    );
    expect(Bun.unsafe.gcAggressionLevel()).toBe(1);
  } finally {
    Bun.unsafe.gcAggressionLevel(initial);
  }
});

it("Bun.unsafe.arrayBufferToString takes a typed array or an ArrayBuffer", () => {
  expect(Bun.unsafe.arrayBufferToString(new Uint8Array([104, 105, 233]))).toBe("hi\xe9");
  expect(Bun.unsafe.arrayBufferToString(new Uint8Array([104, 105]).buffer)).toBe("hi");
  expect(Bun.unsafe.arrayBufferToString(new Uint16Array([104, 0x65e5]))).toBe("h\u65e5");
  for (const TypedArray of [Uint8Array, Uint16Array, Int16Array]) {
    const detached = new TypedArray(4);
    detached.buffer.transfer();
    expect(Bun.unsafe.arrayBufferToString(detached)).toBe("");
  }
  for (const notABuffer of [undefined, null, 1, "hi", {}, []]) {
    expect(() => Bun.unsafe.arrayBufferToString(notABuffer)).toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: "Expected an ArrayBuffer" }),
    );
  }
});

it("Bun.unsafe.memoryFootprint is a number of bytes, or undefined where there is nothing to read it from", () => {
  let known = isMacOS || isWindows;
  if (isLinux) {
    try {
      known = readFileSync("/proc/self/smaps_rollup", "utf8").includes("\nPss:");
    } catch {}
  }
  const bytes = Bun.unsafe.memoryFootprint();
  if (known) {
    expect(bytes).toBeInteger();
    expect(bytes).toBeGreaterThan(1024 * 1024);
  } else {
    expect(bytes).toBeUndefined();
  }
});

it("Bun.unsafe.mimallocDump prints to stderr", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(Bun.unsafe.mimallocDump())"],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("undefined\n");
  expect(stderr).toContain("blocks");
  expect(exitCode).toBe(0);
});
