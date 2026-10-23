import { expect, it, jest } from "bun:test";
import { bunEnv, bunExe, gc, isLinux, isMacOS, isWindows, tempDir, unalignedTypedArraySource } from "harness";
import { readFileSync, truncateSync } from "node:fs";
import { join } from "node:path";

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

// In a child, so that an abort fails this test and not the test runner.
it("Bun.unsafe.arrayBufferToString reads 16-bit units from an ArrayBuffer at an odd address", async () => {
  const units = [104, 0x65e5, 0xd83d, 0xde00];
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `${unalignedTypedArraySource}
      const { buffer } = unaligned(Uint16Array, ${JSON.stringify(units)});
      const strings = [new Uint16Array(buffer), new Int16Array(buffer), new Uint16Array(buffer, 2, 0)].map(view =>
        Bun.unsafe.arrayBufferToString(view),
      );
      console.log(JSON.stringify(strings.map(string => Array.from(string.split(""), unit => unit.charCodeAt(0)))));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify([units, units, []]) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

// 2 ** 31 units are one more than a string can hold. The file is sparse, so a view of it takes no
// memory until something reads it. Bun.mmap is not on Windows.
it.skipIf(isWindows)(
  "Bun.unsafe.arrayBufferToString returns an empty string for more 16-bit units than a string can hold",
  async () => {
    using dir = tempDir("unsafe-array-buffer-to-string", { "sparse.bin": "" });
    truncateSync(join(String(dir), "sparse.bin"), 2 ** 32 + 2);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const before = process.memoryUsage.rss();
        // The view at offset 0 is at an even address, the view at offset 1 at an odd address.
        const lengths = [0, 1].map(offset => {
          const view = new Uint16Array(Bun.mmap("sparse.bin", { offset, size: 2 ** 32 }).buffer);
          return [view.length, Bun.unsafe.arrayBufferToString(view).length];
        });
        const copied = process.memoryUsage.rss() - before > 2 ** 30;
        console.log(JSON.stringify({ lengths, copied }));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        JSON.stringify({
          lengths: [
            [2 ** 31, 0],
            [2 ** 31, 0],
          ],
          copied: false,
        }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  },
);

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
