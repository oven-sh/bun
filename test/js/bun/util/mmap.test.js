import { afterAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { statSync, truncateSync, writeFileSync } from "node:fs";
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

  it("mmap rejects negative offset", () => {
    expect(() => Bun.mmap(path, { offset: -1 })).toThrow("offset must be a non-negative integer");
  });

  it("mmap rejects negative size", () => {
    expect(() => Bun.mmap(path, { size: -1 })).toThrow("size must be a non-negative integer");
  });

  it("mmap rejects non-object options", () => {
    for (const options of [256, "foo", true, 1n, Symbol()]) {
      expect(() => Bun.mmap(path, options)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: "MMapOptions must be an object",
        }),
      );
    }
    expect(() => Bun.mmap(path, undefined)).not.toThrow();
    expect(() => Bun.mmap(path, null)).not.toThrow();
  });

  it("mmap rejects a path that is not a string", () => {
    for (const notAPath of [undefined, null, 1, {}, [], Buffer.from(path), new URL("file://" + path)]) {
      expect(() => Bun.mmap(notAPath)).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: "path must be a string" }),
      );
    }
    // The path is looked at first.
    expect(() => Bun.mmap(1, 1)).toThrow("path must be a string");
  });

  it("mmap rejects a path with a null byte, as Bun.file and node:fs do", () => {
    for (const withNull of [path + "\0", path + "\0x", "\0", "\0" + path]) {
      const expected = expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_VALUE",
        message: `The argument 'path' must be a string, Uint8Array, or URL without null bytes. Received ${JSON.stringify(withNull)}`,
      });
      expect(() => Bun.mmap(withNull)).toThrow(expected);
      expect(() => Bun.file(withNull)).toThrow(expected);
    }
  });

  it("mmap takes offset and size as a BigInt too", () => {
    const text = options => Buffer.from(Bun.mmap(path, options)).toString();
    const whole = text();
    expect(text({ size: 2n })).toBe(whole.slice(0, 2));
    expect(text({ size: Object(2n) })).toBe(whole.slice(0, 2));
    expect(text({ size: { valueOf: () => 2n } })).toBe(whole.slice(0, 2));
    expect(text({ offset: 1n })).toBe(whole.slice(1));
    expect(text({ offset: 1n, size: 2n })).toBe(whole.slice(1, 3));
    expect(text({ offset: 0n, size: statSync(path, { bigint: true }).size })).toBe(whole);
    // More than the file holds is all of it: nothing wraps.
    for (const size of [2n ** 32n + 2n, 2n ** 63n, 2n ** 64n + 2n, 10n ** 400n]) expect(text({ size })).toBe(whole);
    for (const offset of [2n ** 32n + 1n, 2n ** 64n + 1n]) expect(() => Bun.mmap(path, { offset })).toThrow("EINVAL");
    expect(() => Bun.mmap(path, { size: 0n })).toThrow("EINVAL");
    for (const member of ["size", "offset"]) {
      for (const value of [-1n, -(2n ** 64n) + 1n]) {
        expect(() => Bun.mmap(path, { [member]: value })).toThrow(`${member} must be a non-negative integer`);
      }
    }
  });

  it("mmap converts offset and size to numbers and drops the fraction", () => {
    const text = options => Buffer.from(Bun.mmap(path, options)).toString();
    const whole = text();
    expect(text({ size: 2 })).toBe(whole.slice(0, 2));
    expect(text({ size: 2.9 })).toBe(whole.slice(0, 2));
    expect(text({ size: "2" })).toBe(whole.slice(0, 2));
    expect(text({ size: { valueOf: () => 2 } })).toBe(whole.slice(0, 2));
    expect(text({ offset: 1.9 })).toBe(whole.slice(1));
    expect(text({ offset: -0.9 })).toBe(whole);
    expect(text({ offset: NaN })).toBe(whole);
    expect(text({ offset: {} })).toBe(whole);
    expect(text({ size: "4294967298" })).toBe(whole);
    expect(() => Bun.mmap(path, { offset: "4294967297" })).toThrow("EINVAL");
    // More than the file holds is all of it.
    expect(text({ size: 2 ** 53 })).toBe(whole);
    expect(text({ size: 2 ** 64 })).toBe(whole);
    expect(text({ size: Infinity })).toBe(whole);
    expect(() => Bun.mmap(path, { size: NaN })).toThrow("EINVAL");
    expect(() => Bun.mmap(path, { offset: Infinity })).toThrow("EINVAL");
    expect(() => Bun.mmap(path, { offset: -Infinity })).toThrow("offset must be a non-negative integer");
    for (const member of ["size", "offset"]) {
      expect(() => Bun.mmap(path, { [member]: Symbol() })).toThrow(
        expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a number" }),
      );
    }
  });

  it("mmap reads its options in order, each once, and not from Object.prototype", () => {
    const log = [];
    const options = {};
    for (const [member, value] of Object.entries({ offset: 0, size: 2, sync: false, shared: true })) {
      Object.defineProperty(options, member, {
        get() {
          log.push(member);
          return value;
        },
      });
    }
    expect(Bun.mmap(path, options).length).toBe(2);
    expect(log).toEqual(["shared", "sync", "size", "offset"]);

    expect(Bun.mmap(path, Object.create({ size: 2 })).length).toBe(2);
    expect(Bun.mmap(path, Object.assign([], { size: 2 })).length).toBe(2);
    expect(
      Bun.mmap(
        path,
        Object.assign(() => {}, { size: 2 }),
      ).length,
    ).toBe(2);
    Object.prototype.size = 2;
    try {
      expect(Bun.mmap(path, {}).length).toBe(Bun.mmap(path).length);
    } finally {
      delete Object.prototype.size;
    }
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

  it("a parser refuses a mapped file that is too long for it without a copy of the file", async () => {
    using dir = tempDir("mmap-too-long", {});
    const file = join(String(dir), "long.bin");
    // Sparse: the mapping costs address space, not memory or disk.
    writeFileSync(file, "");
    truncateSync(file, 2 ** 31 + 4096);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const view = Bun.mmap(${JSON.stringify(file)});
const before = process.memoryUsage.rss();
const errors = [Bun.XML.parse, Bun.TOML.parse, Bun.YAML.parse].map(parse => {
  try {
    parse(view);
    return "no error";
  } catch (error) {
    return error.name;
  }
});
console.log(JSON.stringify({ errors, grewByAGigabyte: process.memoryUsage.rss() - before > 2 ** 30 }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
      out: { errors: ["RangeError", "RangeError", "RangeError"], grewByAGigabyte: false },
      stderr: "",
      exitCode: 0,
    });
  });

  // Whatever else has the file open writes the bytes of a mapping, so what reads a byte twice reads a copy of them, as
  // it does of a SharedArrayBuffer. The fixture says what each of these does with a byte that changes in between.
  // One at a time: each fixture keeps two cores busy, and a debug build's own threads use the rest.
  describe("a mapping that another thread writes", () => {
    // A debug build that reads the mapping in place fails within a quarter of these calls.
    it.each([
      ["Bun.XML.parse", 300, "view"],
      ["Bun.TOML.parse", 200, "view"],
      ["Bun.YAML.parse", 100, "view"],
      ["Bun.markdown.html", 500, "view"],
      ["UTF-8 decoders", 60, "view"],
      // `transfer()` moves the mapping to another ArrayBuffer.
      ["UTF-8 decoders", 60, "transferred"],
      // A private mapping shows what another process writes to the file, on Linux until this process writes the page.
      ...(isLinux ? [["Bun.YAML.parse", 100, "private"]] : []),
    ])(
      "%s reads a copy of it (%i calls, %s)",
      async (consumer, calls, held) => {
        using dir = tempDir("mmap-racing-writer", {});
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            join(import.meta.dir, "mmap-racing-writer-fixture.ts"),
            consumer,
            join(String(dir), "mapped.bin"),
            String(calls),
            held,
          ],
          env: {
            ...bunEnv,
            // System malloc: a sanitizer does not see an overflow in memory that JavaScriptCore's own allocator gave out.
            Malloc: "1",
            // symbolize=0: symbolizing a sanitizer report takes longer than the test timeout.
            // detect_leaks=0: the fixture exits while its worker runs.
            ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "done", stderr: "", exitCode: 0 });
      },
      // A debug ASAN build takes about 3s just to start the worker.
      20_000,
    );
  });
});
