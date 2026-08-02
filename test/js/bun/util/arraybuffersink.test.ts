import { ArrayBufferSink } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, withoutAggressiveGC } from "harness";

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

  // Before the fix, write() after end() returned a byte count and the data was
  // buffered in the internal Vec, but end()/flush() would not return it, so the
  // caller saw "bytes written" accounting that never reached the output while
  // RSS grew with every write.
  it("write() after end() throws ERR_STREAM_WRITE_AFTER_END and does not buffer", () => {
    const sink = new ArrayBufferSink();
    sink.start({ asUint8Array: true });
    sink.write("a");
    const first = sink.end();
    expect(new TextDecoder().decode(first as Uint8Array)).toBe("a");

    let err: any;
    try {
      sink.write("Q");
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_STREAM_WRITE_AFTER_END");

    // A second end() still returns an empty buffer; nothing from the failed
    // write above should have been retained.
    expect((sink.end() as ArrayBuffer).byteLength).toBe(0);

    // start() resets the sink: writes succeed again and are returned by end().
    sink.start({ asUint8Array: true });
    expect(sink.write("hi")).toBe(2);
    expect(new TextDecoder().decode(sink.end() as Uint8Array)).toBe("hi");
  });

  // A caller that keeps writing after end() should not be able to grow RSS
  // without bound. Spawned as a subprocess so the RSS measurement is isolated
  // from the test runner.
  it("write() after end() does not retain the input in RSS", async () => {
    const src = `
      const sink = new Bun.ArrayBufferSink();
      sink.start({ asUint8Array: true });
      sink.write("a");
      sink.end();
      const rss0 = process.memoryUsage.rss();
      const chunk = Buffer.alloc(1 << 20, 0x51);
      let wrote = 0;
      let threw = 0;
      for (let i = 0; i < 100; i++) {
        try {
          wrote += sink.write(chunk);
        } catch (e) {
          if (e?.code !== "ERR_STREAM_WRITE_AFTER_END") throw e;
          threw++;
        }
      }
      const rss1 = process.memoryUsage.rss();
      const end2 = sink.end();
      process.stdout.write(JSON.stringify({
        wrote,
        threw,
        end2_len: end2.byteLength,
        rssDeltaMB: Math.round((rss1 - rss0) / 1048576),
      }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    // Before: { wrote: 104857600, threw: 0, end2_len: 0, rssDeltaMB: ~228 }
    expect({ wrote: result.wrote, threw: result.threw, end2_len: result.end2_len }).toEqual({
      wrote: 0,
      threw: 100,
      end2_len: 0,
    });
    // The 1 MiB chunk itself costs ~1 MiB; allow generous headroom for ASAN
    // quarantine and GC jitter. The unfixed build grows by >200 MiB here.
    expect(result.rssDeltaMB).toBeLessThan(isASAN || isDebug ? 64 : 32);
    expect(exitCode).toBe(0);
  });
});
