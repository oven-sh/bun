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

  // write() resolves the native sink only after the chunk is converted. A
  // String object's Symbol.toPrimitive / toString runs user JS, and that JS can
  // close() the sink, which frees it. Before, write() held the freed sink and
  // read it (ASAN: heap-use-after-free in ArrayBufferSink::write_latin1).
  describe("write() converts the chunk before it resolves the sink", () => {
    it("a conversion hook that closes the sink reports the closed sink", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          for (const key of ["toPrimitive", "toString"]) {
            for (const ret of ["payload", "pay\u4f60"]) {
              const s = new Bun.ArrayBufferSink();
              s.start({ highWaterMark: 64 });
              s.write("seed");
              const hook = () => { s.close(); return ret; };
              const chunk = Object.assign(new String("x"), key === "toPrimitive" ? { [Symbol.toPrimitive]: hook } : { toString: hook });
              for (const label of ["closing write", "write after"]) {
                const arg = label === "closing write" ? chunk : "y";
                try { console.log(key, ret.length, label, s.write(arg)); }
                catch (e) { console.log(key, ret.length, label, "threw", /already been closed/.test(e.message)); }
              }
            }
          }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const expected = ["toPrimitive", "toString"]
        .flatMap(key => [7, 4].flatMap(len => ["closing write", "write after"].map(l => `${key} ${len} ${l} threw true`)))
        .join("\n");
      expect(stdout.trim()).toBe(expected);
      if (exitCode !== 0) expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    // The accepted chunk types do not change: a String object still writes.
    it("still accepts a String object, Object(str) and a String subclass", () => {
      class Sub extends String {}
      const write = (chunk: any) => {
        const s = new ArrayBufferSink();
        s.start({});
        const n = s.write(chunk);
        return [n, new TextDecoder().decode(s.end() as ArrayBuffer)];
      };
      expect(write(new String("abc"))).toEqual([3, "abc"]);
      expect(write(Object("abc"))).toEqual([3, "abc"]);
      expect(write(new Sub("abc"))).toEqual([3, "abc"]);
      // An own hook decides the bytes, as it does for any string coercion.
      expect(write(Object.assign(new String("abc"), { [Symbol.toPrimitive]: () => "zz" }))).toEqual([2, "zz"]);
    });

    // An error of the receiver still wins over an error of the chunk, and a
    // chunk that needs no coercion never runs a hook.
    it("reports a closed sink and a bad `this` before a bad chunk", () => {
      const closed = new ArrayBufferSink();
      closed.start({});
      closed.close();
      for (const chunk of ["", new Uint8Array(0), undefined, 123, null]) {
        expect(() => closed.write(chunk as any)).toThrow(/already been closed/);
      }
      const live = new ArrayBufferSink();
      live.start({});
      expect(() => live.write.call({}, "x")).toThrow("Expected ArrayBufferSink");
      expect(() => live.write.call({}, 123 as any)).toThrow("Expected ArrayBufferSink");
      expect(() => live.write(123 as any)).toThrow("write() expects a string, ArrayBufferView, or ArrayBuffer");
      expect(() => live.write()).toThrow("write() expects a string, ArrayBufferView, or ArrayBuffer");
    });
  });
});
