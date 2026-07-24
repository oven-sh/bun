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

async function run(source: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: {
      ...bunEnv,
      BUN_JSC_useConcurrentJIT: "0",
      // Tier up quickly and deterministically, but not so eagerly that profiling is skipped.
      BUN_JSC_jitPolicyScale: "0.05",
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

describe("Buffer accessor JIT", () => {
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
  });

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
      const badReceiver = { length: 4 };
      const detached = Buffer.alloc(8);
      structuredClone(detached.buffer, { transfer: [detached.buffer] });
      const exits = [
        () => readAt(buf, buf.length),        // out of bounds
        () => readAt(buf, -1),                // negative offset
        () => readAt(buf, 1.5),               // fractional offset
        () => readAt(buf, "4"),               // wrong offset type
        () => readAt.call(null, badReceiver, 0), // wrong receiver (a plain object as this-arg buffer)
        () => detached.readInt32LE(0),        // detached
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
  });

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
        try { scratch.writeInt8(counting, 0); } catch (e) { assert(e.code === "ERR_OUT_OF_RANGE", "range code"); }
        try { scratch.writeInt8(counting, 100); } catch (e) { assert(e.code === "ERR_OUT_OF_RANGE", "value checked before offset for 1-byte writes? no: offset first"); }
      }
      assert(coerced === 2000, "value coerced exactly once per call, even when it then throws: " + coerced);
      // The BigInt writers: too-wide BigInts throw; the widest valid ones store.
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
  });

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
  });

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
  });

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
  });

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
  });

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
  });
});
