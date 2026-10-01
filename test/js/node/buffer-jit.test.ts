// JIT behavior of Buffer.prototype.read* / write*: these are native functions that JSC's DFG/FTL
// compile into bounds-checked loads/stores on the receiver's storage (JSBuffer.cpp +
// JavaScriptCore's BufferAccessorRegistry). Plain Buffer semantics live in buffer.test.js; this
// file pins the *compiler* behavior: that the JIT path is really taken and converges, that every
// speculation failure lands back on the correct host behavior, that loads and stores are not
// mis-ordered or mis-CSE'd, and that swapping the method is respected.
//
// It runs each scenario in a fresh subprocess with the concurrent JIT off and a deterministic tier-up
// policy, so numberOfDFGCompiles() is meaningful.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(source: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: {
      ...bunEnv,
      BUN_JSC_useConcurrentJIT: "0",
      // Tier up quickly and deterministically, but not so eagerly that profiling is skipped.
      BUN_JSC_jitPolicyScale: "0.05",
      ...extraEnv,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Shared prelude: helpers + a deterministic buffer.
const prelude = `
const { numberOfDFGCompiles, noInline } = require("bun:jsc");
function assert(condition, message) { if (!condition) throw new Error("Assertion failed: " + message); }
const buf = Buffer.alloc(256);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
for (let i = 0; i < buf.length; i++) buf[i] = (i * 37 + 11) & 0xff;
const N = 20000;
`;

describe.concurrent("Buffer accessor JIT", () => {
  test("the JIT path is actually taken, and compile counts converge", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      function read(b, o) { return b.readInt32LE(o); }
      function write(b, v, o) { return b.writeInt32LE(v, o); }
      noInline(read); noInline(write);
      for (let i = 0; i < N; i++) {
        assert(read(buf, i & 63) === dv.getInt32(i & 63, true), "read");
        assert(write(buf, i, (i & 63) + 128) === (i & 63) + 132, "write");
        assert(dv.getInt32((i & 63) + 128, true) === i, "write store");
      }
      const readCompiles = numberOfDFGCompiles(read);
      const writeCompiles = numberOfDFGCompiles(write);
      // Compiled at least once (the intrinsic did not stop the DFG from taking these), and no
      // OSR-exit -> recompile storm: a well-behaved call site converges in a handful of compiles.
      assert(readCompiles >= 1 && readCompiles <= 4, "read compiles: " + readCompiles);
      assert(writeCompiles >= 1 && writeCompiles <= 4, "write compiles: " + writeCompiles);
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("each speculation exit converges instead of looping", async () => {
    // Warm up on the fast path, then keep triggering one exit kind at the same call site: the
    // site must fall back to a stable state (bounded recompiles), not exit -> recompile forever.
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      function readAt(b, o) { return b.readInt32LE(o); }
      noInline(readAt);
      function writeAt(b, v, o) { return b.writeInt8(v, o); }
      noInline(writeAt);
      for (let i = 0; i < N; i++) {
        readAt(buf, i & 63);
        writeAt(buf, i & 127, i & 63);
      }
      // Carries the real accessor, so the call reaches it and fails the receiver check itself
      // (rather than throwing "not a function" at the property lookup).
      const badReceiver = { length: 4, readInt32LE: Buffer.prototype.readInt32LE };
      const detached = Buffer.alloc(8);
      structuredClone(detached.buffer, { transfer: [detached.buffer] });
      const exits = [
        () => readAt(buf, buf.length),        // out of bounds
        () => readAt(buf, -1),                // negative offset
        () => readAt(buf, 1.5),               // fractional offset
        () => readAt(buf, "4"),               // wrong offset type
        () => readAt(badReceiver, 0),         // wrong receiver: a plain object
        () => readAt(detached, 0),            // detached
        () => writeAt(buf, 200, 0),           // value out of int8 range
        () => writeAt(buf, 1.5, 0),           // fractional value (host truncates; no throw)
      ];
      for (const trigger of exits) {
        for (let i = 0; i < 2000; i++) {
          try { trigger(); } catch {}
          readAt(buf, i & 63); // and the fast path keeps working in between
        }
      }
      const compiles = Math.max(numberOfDFGCompiles(readAt), numberOfDFGCompiles(writeAt));
      assert(compiles <= 8, "compile count did not converge: " + compiles);
      assert(readAt(buf, 12) === dv.getInt32(12, true), "still correct after all the exits");
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("a fractional value the compiler has proven non-integral does not cause a recompile loop", async () => {
    // The integer writers truncate a fractional number (no throw). When the value reaches the call as
    // an unboxed double that is known to be non-integral, the uint32 writers' Int52 conversion exits
    // with Int52Overflow and the int8 writer's Int32 conversion exits unconditionally (Uncountable);
    // neither is the BadType exit a boxed argument produces, and both must stop the site from being
    // inlined again. Runs at the default tier-up policy, where the loop shows up as ~10 compiles.
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      function writeHalfU32(b, v, o) { return b.writeUInt32LE(v * 0.5, o); }
      noInline(writeHalfU32);
      function writeHalfVarU32(b, v, o) { return b.writeUIntBE(v * 0.5, o, 4); }
      noInline(writeHalfVarU32);
      function writeHalfI8(b, v, o) { return b.writeInt8(v * 0.5, o); }
      noInline(writeHalfI8);
      for (let i = 0; i < N * 10; i++) {
        const v = (i & 127) | 1;
        assert(writeHalfU32(buf, v, 64) === 68 && dv.getUint32(64, true) === (v * 0.5) >>> 0, "writeUInt32LE(fraction)");
        assert(writeHalfVarU32(buf, v, 68) === 72 && dv.getUint32(68, false) === (v * 0.5) >>> 0, "writeUIntBE(fraction, 4)");
        assert(writeHalfI8(buf, v, 72) === 73 && dv.getInt8(72) === ((v * 0.5) | 0), "writeInt8(fraction)");
      }
      const compiles = Math.max(numberOfDFGCompiles(writeHalfU32), numberOfDFGCompiles(writeHalfVarU32), numberOfDFGCompiles(writeHalfI8));
      assert(compiles <= 4, "compile count did not converge: " + compiles);
      console.log("OK");
    `,
      { BUN_JSC_jitPolicyScale: "1" },
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("host semantics survive every exit path (results, not just compile counts)", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      function read(b, o) { return b.readUInt16BE(o); }
      function write(b, v, o) { return b.writeUInt16LE(v, o); }
      noInline(read); noInline(write);
      for (let i = 0; i < N; i++) { read(buf, i & 63); write(buf, i & 0xffff, (i & 63) + 128); }
      // Non-int32 but valid inputs the JIT does not speculate on must produce the host result.
      assert(read(buf, 4.0) === dv.getUint16(4, false), "integral double offset");
      const scratch = Buffer.alloc(8);
      assert(scratch.writeUInt16LE(1.5, 0) === 2, "fractional value returns offset + 2");
      assert(scratch.readUInt16LE(0) === 1, "fractional value truncates");
      assert(scratch.writeUInt16LE(NaN, 0) === 2 && scratch.readUInt16LE(0) === 0, "NaN stores 0");
      assert(scratch.writeUInt16LE({ valueOf() { return 7; } }, 2) === 4 && scratch.readUInt16LE(2) === 7, "valueOf value");
      let coerced = 0;
      const counting = { valueOf() { coerced++; return 300; } };
      for (let i = 0; i < 1000; i++) {
        try { scratch.writeInt8(counting, 0); assert(false, "should throw"); } catch (e) { assert(e.code === "ERR_OUT_OF_RANGE", "range code"); }
        try { scratch.writeInt8(counting, 100); assert(false, "should throw"); } catch (e) { assert(e.code === "ERR_OUT_OF_RANGE", "an out-of-range value at an out-of-range offset is still ERR_OUT_OF_RANGE"); }
      }
      assert(coerced === 2000, "value coerced exactly once per call, even when it then throws: " + coerced);
      // The BigInt writers: too-wide BigInts throw; the widest valid ones store.
      // NaN and +-Infinity, which the value range check treats differently (Node stores 0 for NaN
      // but throws for the infinities), must keep doing so once the write is JIT-compiled.
      for (let i = 0; i < 2000; i++) {
        assert(scratch.writeInt8(NaN, 0) === 1 && scratch.readInt8(0) === 0, "NaN stores 0 (int8)");
        assert(scratch.writeUInt16LE(NaN, 0) === 2 && scratch.readUInt16LE(0) === 0, "NaN stores 0 (uint16)");
        assert(scratch.writeUIntLE(NaN, 0, 3) === 3 && scratch.readUIntLE(0, 3) === 0, "NaN stores 0 (var width)");
        for (const [f, what] of [[() => scratch.writeInt8(Infinity, 0), "int8 +Inf"], [() => scratch.writeInt8(-Infinity, 0), "int8 -Inf"], [() => scratch.writeIntLE(Infinity, 0, 4), "var-width +Inf"]]) {
          try { f(); assert(false, what + " should throw"); } catch (e) { assert(e.code === "ERR_OUT_OF_RANGE", what + ": " + e.code); }
        }
      }

      const bb = Buffer.alloc(8);
      const bd = new DataView(bb.buffer, bb.byteOffset, 8);
      for (let i = 0; i < 2000; i++) {
        assert(bb.writeBigInt64LE(-(2n ** 63n), 0) === 8 && bd.getBigInt64(0, true) === -(2n ** 63n), "int64 min");
        assert(bb.writeBigUInt64BE(2n ** 64n - 1n, 0) === 8 && bd.getBigUint64(0, false) === 2n ** 64n - 1n, "uint64 max");
        try { bb.writeBigInt64LE(2n ** 63n, 0); assert(false, "should throw"); } catch (e) { assert(e.code === "ERR_OUT_OF_RANGE", "int64 too big"); }
        try { bb.writeBigUInt64LE(-1n, 0); assert(false, "should throw"); } catch (e) { assert(e.code === "ERR_OUT_OF_RANGE", "uint64 negative"); }
      }
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("no stale reads: a store between two loads of the same offset is observed", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      function readWriteRead(b, o, v) {
        const before = b.readInt32LE(o);
        b.writeInt32LE(v, o);
        const after = b.readInt32LE(o); // must not be CSE'd with 'before'
        return before * 3 + after;      // use both so neither is dead
      }
      noInline(readWriteRead);
      for (let i = 0; i < N; i++) {
        const o = (i & 31) * 4;
        const before = dv.getInt32(o, true);
        assert(readWriteRead(buf, o, i) === before * 3 + i, "write between reads at iteration " + i);
      }
      // Same, but the store goes through a plain typed-array element write and a DataView.
      function readAroundOtherStores(b, o, v) {
        const a = b.readUInt8(o);
        b[o] = v & 0xff;
        const c = b.readUInt8(o);
        dv.setUint8(o, (v + 1) & 0xff);
        const d = b.readUInt8(o);
        return [a, c, d];
      }
      noInline(readAroundOtherStores);
      for (let i = 0; i < N; i++) {
        const o = i & 127;
        const a0 = buf[o];
        const [a, c, d] = readAroundOtherStores(buf, o, i);
        assert(a === a0 && c === (i & 0xff) && d === ((i + 1) & 0xff), "typed array / DataView stores observed at " + i);
      }
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("two Buffers over the same ArrayBuffer are never mis-aliased", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      const backing = new ArrayBuffer(64);
      const a = Buffer.from(backing);          // views over the SAME memory
      const b = Buffer.from(backing, 8, 32);
      const raw = new Uint8Array(backing);
      function crossViewReadAfterWrite(x) {
        const before = a.readInt32LE(8);        // a[8..12) is b[0..4)
        b.writeInt32LE(x, 0);                    // store through the other view
        const after = a.readInt32LE(8);         // must observe it: no CSE across the store
        return { before, after };
      }
      noInline(crossViewReadAfterWrite);
      let previous = raw[8] | (raw[9] << 8) | (raw[10] << 16) | (raw[11] << 24);
      for (let i = 0; i < N; i++) {
        const { before, after } = crossViewReadAfterWrite(i);
        assert(before === previous && after === i, "cross-view store observed at " + i + ": " + before + "/" + after);
        previous = i;
      }
      // Overlapping views + a loop the compiler will try to hoist loads out of.
      function sumWhileWriting(iters) {
        let sum = 0;
        for (let i = 0; i < iters; i++) {
          sum += a.readUInt8(12);
          b.writeUInt8((sum + i) & 0xff, 4); // b[4] is a[12]: the load above cannot be hoisted
        }
        return sum;
      }
      noInline(sumWhileWriting);
      a.writeUInt8(3, 12);
      let expected = 0, cell = 3;
      for (let i = 0; i < 500; i++) { expected += cell; cell = (expected + i) & 0xff; }
      for (let i = 0; i < 200; i++) {
        a.writeUInt8(3, 12);
        assert(sumWhileWriting(500) === expected, "loop with aliasing store");
      }
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("a loop-carried load is not kept alive across a call that mutates the buffer", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      let mutations = 0;
      function mutate(b) { b.writeUInt8((++mutations) & 0xff, 0); }
      noInline(mutate);
      function readAroundCall(b, iters) {
        let last = 0;
        for (let i = 0; i < iters; i++) {
          const v = b.readUInt8(0); // loop-invariant address, but the call below may write it
          mutate(b);
          last = v;
        }
        return last;
      }
      noInline(readAroundCall);
      for (let i = 0; i < 300; i++) {
        buf.writeUInt8(200, 0);
        mutations = 0;
        const last = readAroundCall(buf, 100);
        assert(last === (99 & 0xff), "the read is re-done each iteration after the call: got " + last);
      }
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("replacing or shadowing the method after tier-up takes effect", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      function readViaMethod(b, o) { return b.readInt32LE(o); }
      noInline(readViaMethod);
      for (let i = 0; i < N; i++) assert(readViaMethod(buf, i & 63) === dv.getInt32(i & 63, true), "warm");

      // 1. Shadow on one instance: only that receiver changes behavior.
      const special = Buffer.alloc(16);
      special.readInt32LE = function () { return 424242; };
      for (let i = 0; i < 5000; i++) {
        assert(readViaMethod(special, 0) === 424242, "instance shadow at " + i);
        assert(readViaMethod(buf, 4) === dv.getInt32(4, true), "normal buffer unaffected at " + i);
      }

      // 2. Replace on the prototype: every receiver changes behavior, immediately.
      const original = Buffer.prototype.readInt32LE;
      Buffer.prototype.readInt32LE = function (o) { return -original.call(this, o) - 1; };
      for (let i = 0; i < 5000; i++) {
        assert(readViaMethod(buf, i & 63) === -dv.getInt32(i & 63, true) - 1, "prototype replaced at " + i);
      }
      Buffer.prototype.readInt32LE = original;
      for (let i = 0; i < 5000; i++) {
        assert(readViaMethod(buf, i & 63) === dv.getInt32(i & 63, true), "prototype restored at " + i);
      }
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("resizable and growable receivers keep tracking the length after tier-up", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      function readEnd(b) { return b.readUInt16LE(b.length - 2); }
      function readAt(b, o) { return b.readUInt16LE(o); }
      noInline(readEnd); noInline(readAt);
      // Warm on fixed-size buffers first so the resizable ones arrive after optimization.
      for (let i = 0; i < N; i++) { readEnd(buf); readAt(buf, i & 63); }

      const rab = new ArrayBuffer(16, { maxByteLength: 128 });
      const tracking = Buffer.from(rab); // length-tracking view
      tracking.writeUInt16LE(0xabcd, 14);
      for (let i = 0; i < 5000; i++) assert(readEnd(tracking) === 0xabcd, "before grow");
      rab.resize(128);
      tracking.writeUInt16LE(0x1234, 126);
      for (let i = 0; i < 5000; i++) {
        assert(readEnd(tracking) === 0x1234, "after grow");
        assert(readAt(tracking, 126) === 0x1234, "read into the grown region");
      }
      rab.resize(8);
      for (let i = 0; i < 2000; i++) {
        try { readAt(tracking, 14); assert(false, "must throw after shrink"); }
        catch (e) { assert(e.code === "ERR_OUT_OF_RANGE" || e.code === "ERR_BUFFER_OUT_OF_BOUNDS", "shrink error: " + e.code); }
      }

      const gsab = new SharedArrayBuffer(16, { maxByteLength: 128 });
      const shared = Buffer.from(gsab);
      shared.writeUInt16LE(0x5678, 14);
      for (let i = 0; i < 5000; i++) assert(readEnd(shared) === 0x5678, "shared before grow");
      gsab.grow(128);
      shared.writeUInt16LE(0x9abc, 126);
      for (let i = 0; i < 5000; i++) assert(readEnd(shared) === 0x9abc, "shared after grow");
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 30_000);

  // Differential fuzzer: an identical seeded operation stream runs once with the JIT and once with
  // BUN_JSC_useJIT=0; the two traces (return values, error codes/messages, and the buffer bytes
  // after every write) must match. Ported from JSTests/stress/buffer-accessor-jit-differential.js.
  const fuzzerSource = `
    let seed = 0x9e3779b1;
    function rand() { seed ^= seed << 13; seed |= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0; return (seed >>> 0) / 4294967296; }
    function pick(list) { return list[(rand() * list.length) | 0]; }
    function randInt(lo, hi) { return lo + ((rand() * (hi - lo + 1)) | 0); }
    const names = Object.getOwnPropertyNames(Buffer.prototype).filter(n => /^(read|write)(U?Int|Float|Double|Big)/.test(n));
    const readers = names.filter(n => n.startsWith("read")), writers = names.filter(n => n.startsWith("write"));
    function describeName(name) {
      const isWrite = name.startsWith("write"), isFloat = /Float|Double/.test(name), isBigInt = /Big/.test(name);
      const isVarWidth = /Int(LE|BE)$/.test(name) && !/(8|16|32|64)/.test(name), isSigned = !/UInt/.test(name);
      const byteSize = /Double/.test(name) ? 8 : /Float/.test(name) ? 4 : isBigInt ? 8 : isVarWidth ? 0 : Number(name.match(/(8|16|32|64)/)[0]) / 8;
      return { isWrite, isFloat, isBigInt, isVarWidth, isSigned, byteSize };
    }
    function cleanValue(shape, size) {
      if (shape.isBigInt) return pick(shape.isSigned ? [-(2n ** 63n), 2n ** 63n - 1n, 0n, -1n, BigInt(randInt(-1e6, 1e6))] : [0n, 2n ** 64n - 1n, 12345678901234567890n, BigInt(randInt(0, 1e6))]);
      if (shape.isFloat) return pick([() => rand() * 1e6 - 5e5, () => Math.fround(rand() * 100), () => -0, () => Infinity, () => 2 ** -1074, () => 1e300])();
      const min = shape.isSigned ? -(2 ** (8 * size - 1)) : 0, max = shape.isSigned ? 2 ** (8 * size - 1) - 1 : 2 ** (8 * size) - 1;
      return pick([() => min, () => max, () => randInt(min, max), () => randInt(min, max), () => 0])();
    }
    const dirtyValue = () => pick([() => (rand() * 2 ** 32) | 0, () => -((rand() * 2 ** 31) | 0), () => 2 ** 31, () => 2 ** 32, () => -(2 ** 31) - 1,
      () => rand() * 1e6 - 5e5, () => 0.5, () => -0.5, () => -0, () => NaN, () => Infinity, () => -Infinity, () => 2 ** 53 + 1,
      () => "42", () => "abc", () => "", () => true, () => false, () => null, () => undefined,
      () => 5n, () => 2n ** 63n, () => 2n ** 64n, () => -1n, () => -(2n ** 63n) - 1n, () => Symbol("v")])();
    const dirtyOffset = length => pick([() => randInt(0, length + 3), () => -randInt(1, 8), () => length - randInt(0, 8), () => rand() * length,
      () => -0, () => 2 ** 31 + randInt(0, 8), () => 2 ** 32, () => 2 ** 53 + 2, () => NaN, () => Infinity, () => -Infinity,
      () => undefined, () => null, () => String(randInt(0, length)), () => "not a number", () => true, () => Symbol("s"), () => 3n])();
    const dirtyByteLength = () => pick([() => randInt(1, 6), () => 0, () => 7, () => -1, () => 2.5, () => NaN, () => "4", () => undefined, () => 9n])();
    function makeReceiver() {
      return pick([() => Buffer.alloc(32), () => Buffer.from(new ArrayBuffer(64), 8, 24), () => Buffer.alloc(7),
        () => Buffer.from(new ArrayBuffer(16, { maxByteLength: 64 })),
        () => Buffer.from(new ArrayBuffer(48, { maxByteLength: 64 }), 8, 16)])();
    }
    function makeInvoker(name) {
      if (!/^[A-Za-z0-9]+$/.test(name)) throw new Error("bad name " + name);
      return new Function("return function invoke_" + name + "(receiver, args, box) { try { let result;" +
        " switch (args.length) { case 0: result = receiver." + name + "(); break;" +
        " case 1: result = receiver." + name + "(args[0]); break;" +
        " case 2: result = receiver." + name + "(args[0], args[1]); break;" +
        " default: result = receiver." + name + "(args[0], args[1], args[2]); break; }" +
        " box.value = result; box.error = null; } catch (e) { box.value = undefined;" +
        " box.error = e === null || typeof e !== 'object' ? 'throw:' + String(e) : 'throw:' + e.constructor.name + ':' + (e.code === undefined ? '' : e.code) + ':' + e.message; } };")();
    }
    const invokers = new Map();
    const invokerFor = name => { let f = invokers.get(name); if (!f) invokers.set(name, (f = makeInvoker(name))); return f; };
    const fmt = v => typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "Symbol" : Object.is(v, -0) ? "-0" : String(v);
    let digest = 0x811c9dc5;
    const mix = str => { for (let i = 0; i < str.length; i++) { digest ^= str.charCodeAt(i); digest = Math.imul(digest, 0x01000193); } };
    const box = { value: undefined, error: null };
    let ops = 0;
    for (let round = 0; round < 40; ++round) {
      const receiver = makeReceiver();
      const name = pick(rand() < 0.5 ? readers : writers);
      const shape = describeName(name), clean = rand() < 0.6, invoke = invokerFor(name);
      const width = shape.isVarWidth ? randInt(1, 6) : shape.byteSize;
      let resizeCountdown = clean ? Infinity : 100 + randInt(0, 400);
      for (let step = 0; step < 850; ++step) {
        const args = [];
        const maxOffset = receiver.length - width;
        if (clean) {
          if (maxOffset < 0) break;
          if (shape.isWrite) args.push(cleanValue(shape, width));
          args.push(randInt(0, maxOffset));
          if (shape.isVarWidth) args.push(width);
        } else {
          if (shape.isWrite) args.push(dirtyValue());
          if (rand() < 0.9 || shape.isVarWidth) args.push(dirtyOffset(receiver.length));
          if (shape.isVarWidth) args.push(dirtyByteLength());
          while (args.length && args[args.length - 1] === undefined && rand() < 0.3) args.pop();
          if (args.length && typeof args[args.length - 1] === "symbol" && rand() < 0.5) args[args.length - 1] = 0;
        }
        invoke(receiver, args, box);
        ops++;
        let bytes;
        try { bytes = Array.prototype.join.call(receiver, ","); } catch { bytes = "<oob>"; }
        mix(name + "|" + args.map(fmt).join(",") + "=>" + (box.error === null ? fmt(box.value) : box.error) + "|" + bytes);
        if (--resizeCountdown === 0) {
          resizeCountdown = 100 + randInt(0, 400);
          const ab = receiver.buffer;
          if (typeof ab.resize === "function" && ab.resizable) { try { ab.resize(randInt(0, ab.maxByteLength)); } catch {} }
        }
      }
    }
    console.log("digest=" + (digest >>> 0).toString(16) + " ops=" + ops);
  `;

  test("differential fuzzer: JIT and useJIT=0 agree on every result, error and byte", async () => {
    const [jit, reference] = await Promise.all([run(fuzzerSource), run(fuzzerSource, { BUN_JSC_useJIT: "0" })]);
    expect(jit.stderr).toBe("");
    expect(reference.stderr).toBe("");
    expect(jit.exitCode).toBe(0);
    expect(reference.exitCode).toBe(0);
    const parse = (out: string) =>
      Object.fromEntries(
        out
          .trim()
          .split(/\s+/)
          .map(kv => kv.split("=")),
      );
    const jitResult = parse(jit.stdout),
      referenceResult = parse(reference.stdout);
    // A meaningful volume actually ran, and the JIT arm reproduces the interpreter's trace exactly.
    expect(Number(referenceResult.ops)).toBeGreaterThan(20_000);
    expect(jitResult.ops).toBe(referenceResult.ops);
    expect(jitResult.digest).toBe(referenceResult.digest);
  }, 120_000);

  test("a >2GB receiver stays optimized: no exit storm, and OOB still throws", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      let big;
      try { big = new Uint8Array(3 * 2**30); } catch { console.log("OK"); process.exit(0); }
      Object.setPrototypeOf(big, Buffer.prototype);
      const small = Buffer.alloc(64);
      function readAt(b, o) { return b.readInt32LE(o); }
      function writeAt(b, v, o) { return b.writeInt32LE(v, o); }
      noInline(readAt); noInline(writeAt);
      const top = 2 ** 31 - 4;
      for (let i = 0; i < N * 10; i++) {
        assert(writeAt(big, i, 100) === 104, "write low");
        assert(readAt(big, 100) === i, "read low");
        assert(writeAt(big, ~i, top) === top + 4, "write at the int32 offset ceiling");
        assert(readAt(big, top) === ~i, "read at the int32 offset ceiling");
        assert(writeAt(small, i, 60) === 64 && readAt(small, 60) === i, "the same site with a small receiver");
      }
      const compiles = Math.max(numberOfDFGCompiles(readAt), numberOfDFGCompiles(writeAt));
      assert(compiles <= 3, "the large receiver caused recompiles: " + compiles);
      let threw = 0;
      for (let i = 0; i < 200; i++) { try { readAt(big, big.length - 3); } catch (e) { threw += e.code === "ERR_OUT_OF_RANGE"; } }
      assert(threw === 200, "straddling the end of a >2GB view throws");
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 120_000);

  test("views with 2GB and ~4GB byteOffsets read and write correctly after tier-up", async () => {
    const { stdout, stderr, exitCode } = await run(
      prelude +
        `
      let ab;
      try { ab = new ArrayBuffer(4 * 2**30); } catch { console.log("OK"); process.exit(0); }
      const tailOffset = 4 * 2**30 - 64;
      const tail = Buffer.from(ab, tailOffset, 64);
      const wide = Buffer.from(ab, 2**31);
      const raw = new DataView(ab);
      function readAt(v, o) { return v.readInt32LE(o); }
      function writeAt(v, x, o) { return v.writeInt32LE(x, o); }
      noInline(readAt); noInline(writeAt);
      for (let i = 0; i < N; i++) {
        assert(writeAt(tail, i, 8) === 12 && readAt(tail, 8) === i, "~4GB byteOffset view");
        assert(writeAt(wide, ~i, wide.length - 4) === wide.length && readAt(wide, wide.length - 4) === ~i, "2GB byteOffset view");
      }
      assert(raw.getInt32(tailOffset + 8, true) === N - 1, "the store landed at byteOffset + offset");
      assert(raw.getInt32(2**31 + wide.length - 4, true) === ~(N - 1), "the store landed at the 2GB byteOffset");
      let threw = false;
      try { readAt(tail, 61); } catch (e) { threw = e.code === "ERR_OUT_OF_RANGE"; }
      assert(threw, "straddling the end of the tiny high-offset view throws");
      console.log("OK");
    `,
    );
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }, 120_000);
});
