import { afterAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isWindows, tempDir, tmpdirSync } from "harness";
import { truncateSync, writeFileSync } from "node:fs";
import { join } from "path";

// TODO: We do not support mmap() on Windows. Maybe we can add it later.
describe.skipIf(isWindows)("Bun.mmap", async () => {
  await gcTick();
  const path = join(tmpdirSync(), "bun-mmap-test.txt");
  await gcTick();
  await Bun.write(path, "hello");
  await gcTick();

  it("mmap finalizer", async () => {
    let map = Bun.mmap(path);
    await gcTick();
    const map2 = Bun.mmap(path);

    map = null;
    await gcTick();
  });

  it("mmap passed to other syscalls", async () => {
    const map = Bun.mmap(path);
    await gcTick();
    await Bun.write(path + "1", map);
    await gcTick();
    const text = await (await Bun.file(path + "1")).text();
    await gcTick();

    expect(text).toBe(new TextDecoder().decode(map));
  });

  it("mmap sync", async () => {
    const map = Bun.mmap(path);
    await gcTick();
    const map2 = Bun.mmap(path);
    await gcTick();

    const old = map[0];
    await gcTick();
    map[0] = 0;
    await gcTick();
    expect(map2[0]).toBe(0);

    map2[0] = old;
    await gcTick();
    expect(map[0]).toBe(old);
    await gcTick();
    await Bun.write(path, "olleh");
    await gcTick();
    expect(new TextDecoder().decode(map)).toBe("olleh");
    await gcTick();
  });

  it("mmap private", async () => {
    await gcTick();
    const map = Bun.mmap(path, { shared: true });
    await gcTick();
    const map2 = Bun.mmap(path, { shared: false });
    await gcTick();
    const old = map[0];

    await gcTick();
    map2[0] = 0;
    await gcTick();
    expect(map2[0]).toBe(0);
    await gcTick();
    expect(map[0]).toBe(old);
    await gcTick();
  });

  describe("mmap offset returns bytes starting at the requested position", () => {
    const fileSize = 4096 * 3;
    const buf = Buffer.alloc(fileSize);
    for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;
    const dir = tempDir("mmap-offset", {});
    const file = join(String(dir), "data.bin");
    writeFileSync(file, buf);
    afterAll(() => dir[Symbol.dispose]());

    it.each([
      { offset: 0, size: undefined },
      { offset: 1, size: undefined },
      { offset: 100, size: undefined },
      { offset: 4095, size: undefined },
      { offset: 4096, size: undefined },
      { offset: 4097, size: undefined },
      { offset: 100, size: 200 },
      { offset: 4097, size: 10 },
      { offset: 1, size: fileSize * 2 },
    ])("offset=$offset size=$size", async ({ offset, size }) => {
      const map = Bun.mmap(file, size === undefined ? { offset } : { offset, size });
      const wantLen = Math.min(fileSize - offset, size ?? Infinity);
      expect({ length: map.length, first: map[0], last: map[map.length - 1] }).toEqual({
        length: wantLen,
        first: buf[offset],
        last: buf[offset + wantLen - 1],
      });
      expect(Buffer.from(map).equals(buf.subarray(offset, offset + wantLen))).toBe(true);
      await gcTick();
    });
  });

  it("mmap offset with shared mapping writes land at the requested position", () => {
    using dir = tempDir("mmap-offset-write", {});
    const file = join(String(dir), "data.bin");
    writeFileSync(file, Buffer.alloc(4096 * 2, 0));

    const map = Bun.mmap(file, { offset: 100, shared: true });
    map[0] = 0xab;
    map[1] = 0xcd;

    const full = Bun.mmap(file);
    expect({ at0: full[0], at99: full[99], at100: full[100], at101: full[101] }).toEqual({
      at0: 0,
      at99: 0,
      at100: 0xab,
      at101: 0xcd,
    });
  });

  it("mmap offset past EOF throws EINVAL", () => {
    using dir = tempDir("mmap-offset-eof", {});
    const file = join(String(dir), "data.bin");
    writeFileSync(file, Buffer.alloc(50, 0));

    expect(() => Bun.mmap(file, { offset: 100 })).toThrow("EINVAL");
    expect(() => Bun.mmap(file, { offset: 50 })).toThrow("EINVAL");
    expect(() => Bun.mmap(file, { offset: 1, size: 0 })).toThrow("EINVAL");
  });

  it("mmap throws a catchable error when the resolved path does not fit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const max = process.platform === "linux" ? 4096 : 1024;
const rel = Buffer.alloc(max - 1, "a").toString();
try {
  Bun.mmap(rel);
  console.log("no throw");
} catch (e) {
  console.log(e.message);
}`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("Path too long\n");
    expect(exitCode).toBe(0);
  });

  it("mmap of more than 2^32 bytes throws a RangeError instead of aborting", async () => {
    using dir = tempDir("mmap-4gib", {});
    const file = join(String(dir), "big.bin");
    // Sparse: the mappings below cost address space, not memory or disk.
    writeFileSync(file, "");
    truncateSync(file, 2 ** 32 + 4096);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const file = ${JSON.stringify(file)};
const out = {};
try {
  out.wholeFile = Bun.mmap(file).length;
} catch (e) {
  out.wholeFile = e.name;
}
try {
  out.sizeAboveLimit = Bun.mmap(file, { size: 2 ** 32 + 1 }).length;
} catch (e) {
  out.sizeAboveLimit = e.name;
}
out.sizeAtLimit = Bun.mmap(file, { size: 2 ** 32 }).length;
out.smallWindow = Bun.mmap(file, { size: 4096 }).length;
console.log(JSON.stringify(out));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      out: {
        wholeFile: "RangeError",
        sizeAboveLimit: "RangeError",
        sizeAtLimit: 2 ** 32,
        smallWindow: 4096,
      },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  it("mmap rejects paths with null bytes", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try {
  Bun.mmap("/tmp/a\\0b");
  console.log("no throw");
} catch (e) {
  console.log(e.code, e.message);
}`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      `ERR_INVALID_ARG_VALUE The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received "/tmp/a\\u0000b"\n`,
    );
    expect(exitCode).toBe(0);
  });

  it("mmap rejects negative offset", () => {
    expect(() => Bun.mmap(path, { offset: -1 })).toThrow("offset must be a non-negative integer");
  });

  it("mmap rejects negative size", () => {
    expect(() => Bun.mmap(path, { size: -1 })).toThrow("size must be a non-negative integer");
  });

  it("mmap rejects non-object options", () => {
    expect(() => Bun.mmap(path, 256)).toThrow("Expected options to be an object");
    expect(() => Bun.mmap(path, "foo")).toThrow("Expected options to be an object");
    expect(() => Bun.mmap(path, true)).toThrow("Expected options to be an object");
    expect(() => Bun.mmap(path, undefined)).not.toThrow();
    expect(() => Bun.mmap(path, null)).not.toThrow();
  });

  it("mmap handles non-number offset/size without crashing", () => {
    // These should not crash - non-number values coerce to 0 per JavaScript semantics
    // Previously these caused assertion failures (issue ENG-22413)

    // null coerces to 0, which is valid for offset
    expect(() => {
      Bun.mmap(path, { offset: null });
    }).not.toThrow();

    // size: null coerces to 0, which is invalid (EINVAL), but shouldn't crash
    expect(() => {
      Bun.mmap(path, { size: null });
    }).toThrow("EINVAL");

    // undefined is ignored (property not set)
    expect(() => {
      Bun.mmap(path, { offset: undefined });
    }).not.toThrow();
  });
});
