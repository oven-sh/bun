import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// TOCTOU guards for Buffer#copy and Buffer#fill. Both functions coerce their
// numeric (and encoding) arguments via user-visible toNumber / toString /
// toInt32 / toPrimitive callbacks. Those callbacks can detach or resize the
// backing ArrayBuffer between the time length and pointer are captured and
// the time memmove / memset runs. Without the guard, a detach turns into a
// NULL-deref crash and a resize turns into an out-of-bounds read from the
// physical (still-mapped) allocation.
//
// Each case runs the PoC in a fresh subprocess via `bun -e`. If the current
// build lacks the fix, the subprocess segfaults (exit 139 / SIGSEGV) and
// the test fails with a readable error — rather than taking the in-process
// test runner down mid-run. The expected semantics match Node.js: copy()
// returns 0 / fill() returns the same Buffer when the target is no longer
// writable, and both clamp the range to the post-resize logical length.

// stderr lines emitted by the runtime itself (ASAN / JSC banners) that don't
// indicate a test failure. Under bun bd, ASAN prints a WARNING on startup;
// anything else on stderr (Bun crash banner, sanitizer DEADLYSIGNAL dump,
// thrown exception text) is a real failure.
const BENIGN_STDERR = /^WARNING: ASAN interferes with JSC signal handlers;[^\n]*\n$/;

async function runPoc(script: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const stderr = BENIGN_STDERR.test(rawStderr) ? "" : rawStderr;
  return { stdout, stderr, exitCode };
}

describe("Buffer.copy with detach / resize via valueOf", () => {
  test("copy returns 0 when source is detached via sourceStart valueOf (crash repro)", async () => {
    const { stdout, stderr, exitCode } = await runPoc(`
      const source = Buffer.alloc(1024, 0xab);
      const target = Buffer.alloc(1024, 0x00);
      const sideEffect = { valueOf() { source.buffer.transfer(0); return 0; } };
      const copied = source.copy(target, 0, sideEffect);
      console.log(JSON.stringify({ copied, sourceByteLength: source.byteLength, t0: target[0], t500: target[500] }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 0, sourceByteLength: 0, t0: 0x00, t500: 0x00 });
  });

  test("copy returns 0 when source is detached via targetStart valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const source = Buffer.alloc(1024, 0xab);
      const target = Buffer.alloc(1024, 0x00);
      const sideEffect = { valueOf() { source.buffer.transfer(0); return 0; } };
      const copied = source.copy(target, sideEffect, 0, 1024);
      console.log(JSON.stringify({ copied, t0: target[0] }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 0, t0: 0x00 });
  });

  test("copy returns 0 when source is detached via sourceEnd valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const source = Buffer.alloc(1024, 0xab);
      const target = Buffer.alloc(1024, 0x00);
      const sideEffect = { valueOf() { source.buffer.transfer(0); return 1024; } };
      const copied = source.copy(target, 0, 0, sideEffect);
      console.log(JSON.stringify({ copied, t0: target[0], t500: target[500] }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 0, t0: 0x00, t500: 0x00 });
  });

  test("copy returns 0 when target is detached via sourceStart valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const source = Buffer.alloc(1024, 0xab);
      const target = Buffer.alloc(1024, 0x00);
      const sideEffect = { valueOf() { target.buffer.transfer(0); return 0; } };
      const copied = source.copy(target, 0, sideEffect);
      console.log(JSON.stringify({ copied, targetByteLength: target.byteLength }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 0, targetByteLength: 0 });
  });

  test("copy clamps to post-resize logical length when source is resized in sourceStart valueOf (OOB read repro)", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const rab = new ArrayBuffer(1024, { maxByteLength: 1024 });
      const source = Buffer.from(rab);
      source.fill(0xab);
      const target = Buffer.alloc(1024, 0x00);
      const sideEffect = { valueOf() { rab.resize(10); return 0; } };
      const copied = source.copy(target, 0, sideEffect, 1024);
      let oob = 0;
      for (let i = 10; i < 1024; i++) if (target[i] !== 0x00) oob++;
      console.log(JSON.stringify({ copied, sourceLength: source.length, t0: target[0], t9: target[9], oob }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    // copied == 10, only first 10 bytes written, no OOB
    expect(JSON.parse(stdout)).toEqual({ copied: 10, sourceLength: 10, t0: 0xab, t9: 0xab, oob: 0 });
  });

  test("copy clamps to post-resize length when source is resized in targetStart valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const rab = new ArrayBuffer(1024, { maxByteLength: 1024 });
      const source = Buffer.from(rab);
      source.fill(0xab);
      const target = Buffer.alloc(1024, 0x00);
      const sideEffect = { valueOf() { rab.resize(10); return 0; } };
      const copied = source.copy(target, sideEffect, 0, 1024);
      let oob = 0;
      for (let i = 10; i < 1024; i++) if (target[i] !== 0x00) oob++;
      console.log(JSON.stringify({ copied, t0: target[0], t9: target[9], oob }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 10, t0: 0xab, t9: 0xab, oob: 0 });
  });

  test("copy clamps to post-resize length when source is resized in sourceEnd valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const rab = new ArrayBuffer(1024, { maxByteLength: 1024 });
      const source = Buffer.from(rab);
      source.fill(0xab);
      const target = Buffer.alloc(1024, 0x00);
      const sideEffect = { valueOf() { rab.resize(10); return 1024; } };
      const copied = source.copy(target, 0, 0, sideEffect);
      let oob = 0;
      for (let i = 10; i < 1024; i++) if (target[i] !== 0x00) oob++;
      console.log(JSON.stringify({ copied, t0: target[0], t9: target[9], oob }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 10, t0: 0xab, t9: 0xab, oob: 0 });
  });

  test("copy clamps to post-resize target length when target is resized via valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const source = Buffer.alloc(1024, 0xab);
      const rab = new ArrayBuffer(1024, { maxByteLength: 1024 });
      const target = Buffer.from(rab);
      target.fill(0x00);
      const sideEffect = { valueOf() { rab.resize(10); return 0; } };
      const copied = source.copy(target, 0, sideEffect, 1024);
      console.log(JSON.stringify({ copied, targetLength: target.length }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 10, targetLength: 10 });
  });

  test("copy still works correctly with a non-detaching valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const source = Buffer.from("hello world");
      const target = Buffer.alloc(11, 0);
      const copied = source.copy(target, 0, { valueOf() { return 0; } });
      console.log(JSON.stringify({ copied, str: target.toString() }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 11, str: "hello world" });
  });

  test("copy with plain integer arguments keeps working", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const b = Buffer.allocUnsafe(1024);
      const c = Buffer.allocUnsafe(512);
      b.fill(1);
      c.fill(2);
      const copied = b.copy(c, 0, 0, 512);
      let mismatch = 0;
      for (let i = 0; i < c.length; i++) if (c[i] !== b[i]) mismatch++;
      console.log(JSON.stringify({ copied, mismatch }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 512, mismatch: 0 });
  });
});

describe("Buffer.fill with detach / resize via valueOf", () => {
  test("fill does not crash when buffer is detached via value valueOf (number branch, crash repro)", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const buf = Buffer.alloc(100, 0xcc);
      const sideEffect = { valueOf() { buf.buffer.transfer(0); return 0x42; } };
      const result = buf.fill(sideEffect);
      console.log(JSON.stringify({ sameBuf: result === buf, byteLength: buf.byteLength }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ sameBuf: true, byteLength: 0 });
  });

  test("fill does not crash when buffer is detached via value toString (via toInt32 number branch)", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const buf = Buffer.alloc(100, 0xcc);
      const sideEffect = { toString() { buf.buffer.transfer(0); return "42"; } };
      const result = buf.fill(sideEffect);
      console.log(JSON.stringify({ sameBuf: result === buf, byteLength: buf.byteLength }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ sameBuf: true, byteLength: 0 });
  });

  test("fill clamps to post-resize length when buffer is resized via value valueOf (number branch)", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const rab = new ArrayBuffer(1024, { maxByteLength: 1024 });
      const buf = Buffer.from(rab);
      buf.fill(0x00);
      const sideEffect = { valueOf() { rab.resize(10); return 0x42; } };
      const result = buf.fill(sideEffect);
      let ok = result === buf && buf.length === 10;
      for (let i = 0; i < 10; i++) if (buf[i] !== 0x42) ok = false;
      console.log(JSON.stringify({ ok, length: buf.length, b0: buf[0], b9: buf[9] }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true, length: 10, b0: 0x42, b9: 0x42 });
  });

  test("fill still works correctly with a non-detaching valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const buf = Buffer.alloc(10, 0x00);
      const result = buf.fill({ valueOf() { return 0x37; } });
      let ok = result === buf;
      for (let i = 0; i < 10; i++) if (buf[i] !== 0x37) ok = false;
      console.log(JSON.stringify({ ok }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true });
  });

  test("fill with plain integer keeps working", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const buf = Buffer.alloc(10);
      buf.fill(0xff);
      let ok = true;
      for (let i = 0; i < 10; i++) if (buf[i] !== 0xff) ok = false;
      console.log(JSON.stringify({ ok }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true });
  });
});

// The string branch of fill() is reached when `value` is a primitive string;
// inside that branch, parseEncoding() on the 4th argument is what runs user
// toString callbacks. Node rejects non-string encoding with
// ERR_INVALID_ARG_TYPE so it never sees this TOCTOU. Bun currently coerces
// the encoding via toString, so the detach/resize is observable and the
// guard must cover it.
describe("Buffer.fill string branch with detaching encoding toString", () => {
  test("fill(str, 0, end, {toString: detach}) does not crash", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const buf = Buffer.alloc(100, 0xcc);
      const sideEffect = { toString() { buf.buffer.transfer(0); return "utf8"; } };
      const result = buf.fill("A", 0, 100, sideEffect);
      console.log(JSON.stringify({ sameBuf: result === buf, byteLength: buf.byteLength }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ sameBuf: true, byteLength: 0 });
  });

  test("fill(str, 0, end, {toString: resize}) clamps to post-resize length", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const rab = new ArrayBuffer(1024, { maxByteLength: 1024 });
      const buf = Buffer.from(rab);
      buf.fill(0x00);
      const sideEffect = { toString() { rab.resize(10); return "utf8"; } };
      buf.fill("A", 0, 1024, sideEffect);
      let ok = buf.length === 10;
      for (let i = 0; i < 10; i++) if (buf[i] !== 0x41) ok = false;
      console.log(JSON.stringify({ ok, length: buf.length }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true, length: 10 });
  });
});

// Argument evaluation order must match Node.js: a later argument's
// valueOf / coercion must not run when an earlier argument is already
// trivially invalid, and an empty write range must short-circuit before
// coercing `value` at all.
describe("Buffer.copy / fill argument evaluation order (Node-compat)", () => {
  test("copy(target, -1, {valueOf:throws}) rejects targetStart before calling sourceStart valueOf", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const source = Buffer.alloc(10);
      const target = Buffer.alloc(10);
      let called = false;
      try {
        source.copy(target, -1, { valueOf() { called = true; throw new Error("boom"); } });
        console.log(JSON.stringify({ threw: false, called }));
      } catch (e) {
        console.log(JSON.stringify({ threw: true, code: e.code ?? null, called }));
      }
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ threw: true, code: "ERR_OUT_OF_RANGE", called: false });
  });

  test("fill({valueOf:throws}, 5, 3) returns buf without coercing value (empty range)", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const buf = Buffer.alloc(10, 0x11);
      let called = false;
      const result = buf.fill({ valueOf() { called = true; throw new Error("boom"); } }, 5, 3);
      console.log(JSON.stringify({ sameBuf: result === buf, called, b0: buf[0] }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ sameBuf: true, called: false, b0: 0x11 });
  });

  test("fill(emptyUint8Array, 5, 3) returns buf without ERR_INVALID_ARG_VALUE (empty range)", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const buf = Buffer.alloc(10, 0x11);
      const result = buf.fill(new Uint8Array(0), 5, 3);
      console.log(JSON.stringify({ sameBuf: result === buf, b0: buf[0] }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ sameBuf: true, b0: 0x11 });
  });

  test("fill(detachedView, 5, 3) returns buf without TypeError (empty range)", async () => {
    const { stderr, exitCode, stdout } = await runPoc(`
      const ab = new ArrayBuffer(10);
      const view = new Uint8Array(ab);
      ab.transfer(0);
      const buf = Buffer.alloc(10, 0x11);
      const result = buf.fill(view, 5, 3);
      console.log(JSON.stringify({ sameBuf: result === buf, b0: buf[0] }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ sameBuf: true, b0: 0x11 });
  });

  test("copy: sourceStart primitive stays valid when sourceEnd valueOf shrinks source", async () => {
    // sourceStart=100 is valid against original length 1024. sourceEnd's
    // valueOf resizes to 50, then returns 200. Node bounds-checks
    // sourceStart against the pre-sourceEnd-coercion length (1024, so
    // passing) and the copy then computes 0 bytes. Bun must not throw
    // ERR_OUT_OF_RANGE against the post-resize length (50).
    const { stderr, exitCode, stdout } = await runPoc(`
      const rab = new ArrayBuffer(1024, { maxByteLength: 1024 });
      const source = Buffer.from(rab); source.fill(0xab);
      const target = Buffer.alloc(1024);
      const copied = source.copy(target, 0, 100, { valueOf() { rab.resize(50); return 200; } });
      console.log(JSON.stringify({ copied, sourceLength: source.length }));
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ copied: 0, sourceLength: 50 });
  });

  test("fill: invalid encoding throws ERR_UNKNOWN_ENCODING even when offset/end are out of range", async () => {
    // Node validates encoding BEFORE validateNumber(offset/end), so when
    // both are wrong the encoding error wins. Without this ordering my
    // rewrite was throwing ERR_OUT_OF_RANGE instead.
    const { stderr, exitCode, stdout } = await runPoc(`
      const buf = Buffer.alloc(10);
      try { buf.fill("a", 0, 11, "bogus"); console.log("no throw"); }
      catch (e) { console.log(JSON.stringify({ code: e.code })); }
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ code: "ERR_UNKNOWN_ENCODING" });
  });
});
