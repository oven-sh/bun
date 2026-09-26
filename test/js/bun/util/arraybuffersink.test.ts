import { ArrayBufferSink } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, withoutAggressiveGC } from "harness";
import { join } from "node:path";

describe("ArrayBufferSink", () => {
  const fixtures = [
    [
      ["abcdefghijklmnopqrstuvwxyz"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
      "abcdefghijklmnopqrstuvwxyz",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"),
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    [
      ["😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋", " Get Emoji — All Emojis", " to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "(rope) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      [
        new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
        "😋",
        " Get Emoji — All Emojis",
        " to ✂️ Copy and 📋 Paste 👌",
      ],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "(array) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
  ] as const;

  for (const [input, expected, label] of fixtures) {
    it(`${JSON.stringify(label)}`, () => {
      const sink = new ArrayBufferSink();
      withoutAggressiveGC(() => {
        for (let i = 0; i < input.length; i++) {
          const el = input[i];
          if (typeof el !== "number") {
            sink.write(el);
          }
        }
      });
      const output = new Uint8Array(sink.end());
      withoutAggressiveGC(() => {
        for (let i = 0; i < expected.length; i++) {
          expect(output[i]).toBe(expected[i]);
        }
      });
      expect(output.byteLength).toBe(expected.byteLength);
    });
  }

  it("the constructor has a prototype property, so instanceof works", () => {
    const sink = new ArrayBufferSink();
    const proto = Object.getPrototypeOf(sink);

    expect(Object.getOwnPropertyDescriptor(ArrayBufferSink, "prototype")).toEqual({
      value: proto,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    expect(ArrayBufferSink.prototype.constructor).toBe(ArrayBufferSink);
    expect(typeof ArrayBufferSink.prototype.write).toBe("function");

    expect(sink).toBeInstanceOf(ArrayBufferSink);
    expect(sink instanceof ArrayBufferSink).toBe(true);
    expect({} instanceof ArrayBufferSink).toBe(false);
    expect(Object.create(proto)).toBeInstanceOf(ArrayBufferSink);
  });

  // WHATWG streams accept Infinity as a highWaterMark. Bun 1.3.14 clamped it
  // and carried on; the Rust port passed i64::MAX to reserve_exact and aborted.
  // Spawned as a subprocess because the failure mode is SIGABRT.
  it.each([
    ["Infinity", "Infinity"],
    ["1e15", "1e15"],
    ["Number.MAX_SAFE_INTEGER", "Number.MAX_SAFE_INTEGER"],
    ["-1", "-1"],
    ["NaN", "NaN"],
  ])("start({ highWaterMark: %s }) does not abort the process", async (_, expr) => {
    const src = `
      const sink = new Bun.ArrayBufferSink();
      let caught;
      try {
        sink.start({ highWaterMark: ${expr} });
      } catch (err) {
        caught = err?.code ?? err?.name;
      }
      sink.write("hello");
      const out = new TextDecoder().decode(new Uint8Array(sink.end()));
      process.stdout.write(JSON.stringify({ caught, out }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("memory allocation");
    expect(JSON.parse(stdout)).toEqual({ out: "hello" });
    expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });

  // The generated ${name}__doClose detached the JS wrapper (nulling m_sinkPtr)
  // and then called __close, but never __finalize. The wrapper's destructor
  // skips __finalize when m_sinkPtr is null, so every close() leaked the boxed
  // ArrayBufferSink plus its Vec<u8> buffer. The repro runs off a setImmediate
  // so the allocation stack does not fall under the module-loader suppression.
  // LSAN symbolization of the leak stacks can take several seconds on its own,
  // hence the explicit per-test timeout.
  it.skipIf(!isASAN)(
    "close() does not leak the native sink (LSAN)",
    async () => {
      const src = `
        await new Promise(resolve => setImmediate(resolve));
        for (let i = 0; i < 4; i++) {
          const s = new Bun.ArrayBufferSink();
          s.start({ stream: true, asUint8Array: true });
          s.write(Buffer.alloc(4096, 0x61).toString());
          s.close();
        }
        Bun.gc(true);
        console.log("done");
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: {
          ...bunEnv,
          ASAN_OPTIONS: "detect_leaks=1",
          LSAN_OPTIONS: `suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("done");
      const summary = /SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked/.exec(stderr);
      const leaked = summary ? Number(summary[1]) : 0;
      // Before the fix each iteration leaked the ~48-byte struct and the
      // 4 KiB write buffer (>16 KiB total for 4 iterations).
      expect({ leaked, exitCode }).toEqual({ leaked: 0, exitCode: 0 });
    },
    30_000,
  );

  it("close() followed by further calls does not crash", () => {
    const s = new ArrayBufferSink();
    s.write("hello");
    s.close();
    // After close() the wrapper is detached; every method that needs the
    // native backing throws the "already been closed" error rather than
    // dereferencing a freed pointer.
    expect(() => s.write("x")).toThrow(/already been closed/);
    expect(() => s.flush()).toThrow(/already been closed/);
    expect(() => s.end()).toThrow(/already been closed/);
    expect(s.close()).toBeUndefined();
  });

  it("start() with an option getter that closes the sink throws instead of crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        for (const key of ["highWaterMark", "asUint8Array", "stream"]) {
          const s = new Bun.ArrayBufferSink();
          s.write("hello");
          let err;
          try {
            s.start({ get [key]() { s.close(); return key === "highWaterMark" ? 1024 : true; } });
          } catch (e) { err = e; }
          console.log(key, /already been closed/.test(err?.message));
          try { s.write("x"); console.log("write ok"); } catch (e) { console.log("write", /already been closed/.test(e.message)); }
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("highWaterMark true\nwrite true\nasUint8Array true\nwrite true\nstream true\nwrite true\n");
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
