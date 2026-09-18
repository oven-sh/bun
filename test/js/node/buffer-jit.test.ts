// JIT behavior of Buffer.prototype.read* / write*: these are native functions that JSC's DFG/FTL
// compile into bounds-checked loads/stores on the receiver's storage (JSBuffer.cpp +
// JavaScriptCore's BufferAccessorRegistry). Plain Buffer semantics live in buffer.test.js; this
// file pins the *compiler* behavior: that the JIT path is really taken and converges, that every
// speculation failure lands back on the correct host behavior, that loads and stores are not
// mis-ordered or mis-CSE'd, and that swapping the method is respected.
//
// Each scenario runs in a fresh subprocess and reports one JSON object (compile counts, outcomes)
// that the test compares as a whole.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { totalmem } from "node:os";

// One eager, deterministic tier-up policy for every subprocess. forceEagerCompilation compiles a
// function to baseline after 10 and to DFG and FTL after 20 execution counts (a call counts 15)
// and turns the concurrent JIT off, so a function reaches the FTL within a handful of calls and
// numberOfDFGCompiles() is exact. Optimized code that keeps exiting is jettisoned and recompiled
// after 20 exits instead of 100, so every exit -> recompile chain below settles within a few
// hundred calls. (Not jitPolicyScale: until #40583, Bun applied it once per BUN_JSC_ variable.)
const jitEnv = {
  ...bunEnv,
  BUN_JSC_forceEagerCompilation: "1",
  BUN_JSC_osrExitCountForReoptimization: "20",
};

async function run(source: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: { ...jitEnv, ...extraEnv },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Warm-up calls on the fast path: reaches the FTL many times over under this tier-up policy.
const N = 500;
// Repetitions of an input that makes optimized code exit, in the tests that pin compile counts
// after a change of receiver or method: enough for the exit, the jettison after 20 of them, the
// recompile, and a long run of the recompiled code.
const T = 300;
// Calls per host-semantics case. Each call exits the compiled site, so the jettison and the
// recompile without the intrinsic are over by call 50. The rest runs the recompiled code.
const R = 150;

// Shared prelude: helpers and a deterministic buffer.
const prelude = `
const { numberOfDFGCompiles, noInline, noFTL } = require("bun:jsc");
function assert(condition, message) { if (!condition) throw new Error("Assertion failed: " + message); }
function report(result) { console.log(JSON.stringify(result)); }
const buf = Buffer.alloc(256);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
for (let i = 0; i < buf.length; i++) buf[i] = (i * 37 + 11) & 0xff;
const N = ${N}, T = ${T}, R = ${R};
`;

// Runs a scenario and returns the object it passed to report(). The scenario body is the harness
// around the functions under test (which are noInline'd and compiled on their own), so it runs in
// the DFG only: FTL-compiling its loops costs seconds per scenario in a debug build and proves nothing.
async function scenario(source: string, extraEnv?: Record<string, string>) {
  const { stdout, stderr, exitCode } = await run(
    prelude + "function main() {" + source + "}\nnoFTL(main);\nmain();\n",
    extraEnv,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

describe.concurrent("Buffer accessor JIT", () => {
  test("the JIT path is taken and the fast path never exits", async () => {
    const result = await scenario(`
      function read(b, o) { return b.readInt32LE(o); }
      function write(b, v, o) { return b.writeInt32LE(v, o); }
      noInline(read); noInline(write);
      for (let i = 0; i < N; i++) {
        assert(read(buf, i & 63) === dv.getInt32(i & 63, true), "read at " + i);
        assert(write(buf, i, (i & 63) + 128) === (i & 63) + 132, "write at " + i);
        assert(dv.getInt32((i & 63) + 128, true) === i, "write store at " + i);
      }
      report({ read: numberOfDFGCompiles(read), write: numberOfDFGCompiles(write) });
    `);
    // Exactly one optimizing compile each: the intrinsic did not stop the DFG from taking the
    // function, and nothing on the fast path exited and forced a recompile.
    expect(result).toEqual({ read: 1, write: 1 });
  });

  // Each case gets its own call site: warm it on the fast path, then keep feeding it one input that
  // makes the optimized code exit, with a fast call in between, until the site has settled. Every
  // exit must land on the same answer as the host.
  //
  // Optimized code is jettisoned after osrExitCountForReoptimization exits, doubled for every
  // recompile the function already had (CodeBlock::adjustedExitCountThreshold), so a site whose
  // latest code still exits on every bad call recompiles again within 20 << (compiles - 1)
  // iterations plus a short re-warm. The loop runs until the compile count has held still for
  // longer than that, so the count it reports is final. A site that never settles reads 7 or more
  // at the 2000-iteration cap.
  //
  // compiles: 1 for the warm-up plus 1 per speculation the bad input defeats, each followed by a
  // recompile without it. outcomes: a single entry means every exit produced the host's answer,
  // from the first (optimized) call to the last (recompiled) one.
  const exitHelpers = `
    function outcome(fn, args) {
      try { return "value:" + String(fn(args[0], args[1], args[2])); }
      catch (e) { return "throw:" + e.constructor.name + ":" + e.code; }
    }
    noInline(outcome); noFTL(outcome);
    function exercise(fn, fast, bad) {
      noInline(fn);
      const expected = outcome(fn, fast);
      for (let i = 0; i < N; i++) assert(outcome(fn, fast) === expected, "warm-up");
      const seen = new Set();
      let compiles = numberOfDFGCompiles(fn), lastRecompile = 0;
      for (let i = 0; i < 2000 && i - lastRecompile <= (20 << (compiles - 1)) + 100; i++) {
        seen.add(outcome(fn, bad));
        assert(outcome(fn, fast) === expected, "the fast path between exits");
        const now = numberOfDFGCompiles(fn);
        if (now !== compiles) { compiles = now; lastRecompile = i; }
      }
      return { compiles, outcomes: [...seen] };
    }
    noInline(exercise); noFTL(exercise);
  `;

  test("an offset that defeats a speculation exits to the host error and converges", async () => {
    const result = await scenario(
      exitHelpers +
        `
      report({
        "past the end": exercise((b, o) => b.readInt32LE(o), [buf, 12], [buf, buf.length]),
        "negative": exercise((b, o) => b.readInt32LE(o), [buf, 12], [buf, -1]),
        "fractional": exercise((b, o) => b.readInt32LE(o), [buf, 12], [buf, 1.5]),
        "a string": exercise((b, o) => b.readInt32LE(o), [buf, 12], [buf, "4"]),
      });
    `,
    );
    // An out-of-bounds offset defeats one check. A fractional offset defeats three in turn: the
    // int32 speculation on the argument, then the double-to-int32 conversion, then the offset check
    // inside the intrinsic, after which the site calls the host directly.
    expect(result).toEqual({
      "past the end": { compiles: 2, outcomes: ["throw:RangeError:ERR_OUT_OF_RANGE"] },
      "negative": { compiles: 2, outcomes: ["throw:RangeError:ERR_OUT_OF_RANGE"] },
      "fractional": { compiles: 4, outcomes: ["throw:RangeError:ERR_OUT_OF_RANGE"] },
      "a string": { compiles: 3, outcomes: ["throw:TypeError:ERR_INVALID_ARG_TYPE"] },
    });
  });

  test("a receiver or value that defeats a speculation exits to the host behavior and converges", async () => {
    const result = await scenario(
      exitHelpers +
        `
      // Detach first: detaching any ArrayBuffer fires a watchpoint that jettisons every compiled
      // function that assumed no buffer had been detached, which would add a recompile to
      // whichever case happened to be running.
      const detached = Buffer.alloc(8);
      structuredClone(detached.buffer, { transfer: [detached.buffer] });
      // Carries the real accessor, so the call reaches it and fails the receiver check itself
      // (rather than throwing "not a function" at the property lookup).
      const plain = { length: 256, readInt32LE: Buffer.prototype.readInt32LE };
      report({
        "plain object receiver": exercise((b, o) => b.readInt32LE(o), [buf, 12], [plain, 0]),
        "detached receiver": exercise((b, o) => b.readInt32LE(o), [buf, 12], [detached, 0]),
        "value out of int8 range": exercise((b, v, o) => b.writeInt8(v, o), [buf, 5, 200], [buf, 200, 200]),
        "fractional value": exercise((b, v, o) => b.writeInt8(v, o), [buf, 5, 200], [buf, 1.5, 200]),
      });
    `,
    );
    // The plain object defeats the intrinsic's receiver check and, when the FTL compiled the site
    // after the property lookup's inline cache had filled, the structure check of that lookup too:
    // 2 or 3 compiles, depending on when the compiles landed. The other chains do not depend on it.
    expect(result).toEqual({
      "plain object receiver": { compiles: expect.any(Number), outcomes: ["throw:TypeError:ERR_INVALID_ARG_TYPE"] },
      "detached receiver": { compiles: 2, outcomes: ["throw:RangeError:ERR_BUFFER_OUT_OF_BOUNDS"] },
      "value out of int8 range": { compiles: 2, outcomes: ["throw:RangeError:ERR_OUT_OF_RANGE"] },
      "fractional value": { compiles: 3, outcomes: ["value:201"] }, // truncated to 1, no throw
    });
    expect(result["plain object receiver"].compiles).toBeGreaterThanOrEqual(2);
    expect(result["plain object receiver"].compiles).toBeLessThanOrEqual(3);
  });

  test("a value the compiler has proven non-integral exits once and does not recompile in a loop", async () => {
    const result = await scenario(`
      function writeHalfU32(b, v, o) { return b.writeUInt32LE(v * 0.5, o); }
      function writeHalfVarU32(b, v, o) { return b.writeUIntBE(v * 0.5, o, 4); }
      function writeHalfI8(b, v, o) { return b.writeInt8(v * 0.5, o); }
      noInline(writeHalfU32); noInline(writeHalfVarU32); noInline(writeHalfI8);
      for (let i = 0; i < N; i++) {
        const v = (i & 127) | 1; // odd, so v * 0.5 is never an integer
        assert(writeHalfU32(buf, v, 64) === 68 && dv.getUint32(64, true) === (v * 0.5) >>> 0, "writeUInt32LE(fraction) at " + i);
        assert(writeHalfVarU32(buf, v, 68) === 72 && dv.getUint32(68, false) === (v * 0.5) >>> 0, "writeUIntBE(fraction, 4) at " + i);
        assert(writeHalfI8(buf, v, 72) === 73 && dv.getInt8(72) === ((v * 0.5) | 0), "writeInt8(fraction) at " + i);
      }
      report({
        writeUInt32LE: numberOfDFGCompiles(writeHalfU32),
        writeUIntBE: numberOfDFGCompiles(writeHalfVarU32),
        writeInt8: numberOfDFGCompiles(writeHalfI8),
      });
    `);
    // The value reaches the call as an unboxed double the compiler knows is non-integral: the
    // uint32 writers' Int52 conversion exits with Int52Overflow and the int8 writer's Int32
    // conversion exits unconditionally (Uncountable). Neither is the BadType exit a boxed argument
    // produces, and both must stop the intrinsic from being inlined again: one exit, one recompile,
    // 2 compiles. A compiler that inlines it again after these exit kinds exits on every call and
    // reads 5 here (recompiles after 20, 60, 140 and 300 exits).
    expect(result).toEqual({ writeUInt32LE: 2, writeUIntBE: 2, writeInt8: 2 });
  });

  // Host semantics under the JIT: each case is its own function, so its constants are compiled into
  // the call site, and it runs R times on a zeroed scratch buffer. The outcome of a call is what it
  // returned and what the bytes say afterwards, or what it threw. One outcome per case means every
  // call gave the host's answer, from the first (interpreted) to the last (compiled, or recompiled
  // after an exit).
  const semanticsHelpers = `
    const s = Buffer.alloc(16);
    const sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    function bytesAfter(readBack) { return readBack ? ", bytes " + String(readBack()) : ""; }
    noInline(bytesAfter); noFTL(bytesAfter);
    function effect(fn, i, readBack) {
      try { return "returns " + String(fn(s, i)) + bytesAfter(readBack); }
      catch (e) { return "throws " + e.constructor.name + ":" + e.code + bytesAfter(readBack); }
    }
    noInline(effect); noFTL(effect);
    function outcomesOf(cases) {
      const outcomes = {};
      for (const [name, [fn, readBack]] of Object.entries(cases)) {
        noInline(fn);
        if (readBack) { noInline(readBack); noFTL(readBack); } // harness, like effect
        const seen = new Set();
        for (let i = 0; i < R; i++) {
          sv.setBigUint64(0, 0n, true); // the bytes a write may touch start out zero on every call
          seen.add(effect(fn, i, readBack));
        }
        assert(numberOfDFGCompiles(fn) >= 1, name + " was never compiled");
        outcomes[name] = [...seen];
      }
      return outcomes;
    }
    noInline(outcomesOf); noFTL(outcomesOf);
  `;

  test("host semantics survive the JIT: values that the accessor converts and stores", async () => {
    const result = await scenario(
      semanticsHelpers +
        `
      s.writeUInt16BE(0xbeef, 12);
      report(outcomesOf({
        // (i & 8) * 1.5 is 0 or 12: an integral offset that arrives as a double, not an int32.
        "integral double offset": [(b, i) => b.readUInt16BE((i & 8) * 1.5)],
        "fractional value truncates": [b => b.writeUInt16LE(1.5, 0), () => sv.getUint16(0, true)],
        "NaN stores 0 (uint16)": [b => b.writeUInt16LE(NaN, 0), () => sv.getUint16(0, true)],
        "NaN stores 0 (int8)": [b => b.writeInt8(NaN, 0), () => sv.getInt8(0)],
        "NaN stores 0 (variable width)": [b => b.writeUIntLE(NaN, 0, 3), () => sv.getUint32(0, true) & 0xffffff],
        "valueOf supplies the value": [b => b.writeUInt16LE({ valueOf() { return 7; } }, 2), () => sv.getUint16(2, true)],
        "int64 minimum": [b => b.writeBigInt64LE(-(2n ** 63n), 0), () => String(sv.getBigInt64(0, true))],
        "uint64 maximum": [b => b.writeBigUInt64BE(2n ** 64n - 1n, 0), () => String(sv.getBigUint64(0, false))],
      }));
    `,
    );
    expect(result).toEqual({
      "integral double offset": ["returns 0", "returns 48879"], // 0xbeef at offset 12
      "fractional value truncates": ["returns 2, bytes 1"],
      "NaN stores 0 (uint16)": ["returns 2, bytes 0"],
      "NaN stores 0 (int8)": ["returns 1, bytes 0"],
      "NaN stores 0 (variable width)": ["returns 3, bytes 0"],
      "valueOf supplies the value": ["returns 4, bytes 7"],
      "int64 minimum": ["returns 8, bytes -9223372036854775808"],
      "uint64 maximum": ["returns 8, bytes 18446744073709551615"],
    });
  });

  test("host semantics survive the JIT: values that the accessor rejects", async () => {
    const result = await scenario(
      semanticsHelpers +
        `
      let coerced = 0;
      const counting = { valueOf() { coerced++; return 300; } };
      const outcomes = outcomesOf({
        "out-of-range valueOf value": [b => b.writeInt8(counting, 0), () => sv.getInt8(0)],
        "out-of-range valueOf value at an out-of-range offset": [b => b.writeInt8(counting, 100), () => sv.getInt8(0)],
        "+Infinity (int8)": [b => b.writeInt8(Infinity, 0), () => sv.getInt8(0)],
        "-Infinity (int8)": [b => b.writeInt8(-Infinity, 0), () => sv.getInt8(0)],
        "+Infinity (variable width)": [b => b.writeIntLE(Infinity, 0, 4), () => sv.getInt32(0, true)],
        "int64 too large": [b => b.writeBigInt64LE(2n ** 63n, 0), () => String(sv.getBigInt64(0, true))],
        "uint64 negative": [b => b.writeBigUInt64LE(-1n, 0), () => String(sv.getBigUint64(0, true))],
      });
      report({ outcomes, coerced });
    `,
    );
    // Where the host throws, the bytes stay untouched.
    expect(result).toEqual({
      outcomes: {
        "out-of-range valueOf value": ["throws RangeError:ERR_OUT_OF_RANGE, bytes 0"],
        "out-of-range valueOf value at an out-of-range offset": ["throws RangeError:ERR_OUT_OF_RANGE, bytes 0"],
        "+Infinity (int8)": ["throws RangeError:ERR_OUT_OF_RANGE, bytes 0"],
        "-Infinity (int8)": ["throws RangeError:ERR_OUT_OF_RANGE, bytes 0"],
        "+Infinity (variable width)": ["throws RangeError:ERR_OUT_OF_RANGE, bytes 0"],
        "int64 too large": ["throws RangeError:ERR_OUT_OF_RANGE, bytes 0"],
        "uint64 negative": ["throws RangeError:ERR_OUT_OF_RANGE, bytes 0"],
      },
      // The value is coerced exactly once per call, even when the call then throws.
      coerced: 2 * R,
    });
  });

  test("no stale reads: a store between two loads of the same offset is observed", async () => {
    const result = await scenario(`
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
      report({ readWriteRead: numberOfDFGCompiles(readWriteRead), readAroundOtherStores: numberOfDFGCompiles(readAroundOtherStores) });
    `);
    expect(result).toEqual({ readWriteRead: 1, readAroundOtherStores: 1 });
  });

  test("two Buffers over the same ArrayBuffer are never mis-aliased", async () => {
    const result = await scenario(`
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
      let expected = 0, cell = 3;
      for (let i = 0; i < 500; i++) { expected += cell; cell = (expected + i) & 0xff; }
      for (let i = 0; i < 50; i++) {
        a.writeUInt8(3, 12);
        assert(sumWhileWriting(500) === expected, "loop with aliasing store at call " + i);
      }
      report({ crossViewReadAfterWrite: numberOfDFGCompiles(crossViewReadAfterWrite), sumWhileWriting: numberOfDFGCompiles(sumWhileWriting) });
    `);
    expect(result).toEqual({ crossViewReadAfterWrite: 1, sumWhileWriting: 1 });
  });

  test("a loop-carried load is not kept alive across a call that mutates the buffer", async () => {
    const result = await scenario(`
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
      for (let i = 0; i < 100; i++) {
        buf.writeUInt8(200, 0);
        mutations = 0;
        const last = readAroundCall(buf, 100);
        assert(last === 99, "the read is re-done each iteration after the call: got " + last + " at call " + i);
      }
      report({ mutate: numberOfDFGCompiles(mutate), readAroundCall: numberOfDFGCompiles(readAroundCall) });
    `);
    expect(result).toEqual({ mutate: 1, readAroundCall: 1 });
  });

  test("replacing or shadowing the method after tier-up takes effect", async () => {
    const result = await scenario(`
      function readViaMethod(b, o) { return b.readInt32LE(o); }
      noInline(readViaMethod);
      for (let i = 0; i < N; i++) assert(readViaMethod(buf, i & 63) === dv.getInt32(i & 63, true), "warm");
      const compiles = { warm: numberOfDFGCompiles(readViaMethod) };

      // 1. Shadow on one instance: only that receiver changes behavior.
      const special = Buffer.alloc(16);
      special.readInt32LE = function () { return 424242; };
      for (let i = 0; i < T; i++) {
        assert(readViaMethod(special, 0) === 424242, "instance shadow at " + i);
        assert(readViaMethod(buf, 4) === dv.getInt32(4, true), "normal buffer unaffected at " + i);
      }
      compiles.afterInstanceShadow = numberOfDFGCompiles(readViaMethod);

      // 2. Replace on the prototype: every receiver changes behavior, immediately.
      const original = Buffer.prototype.readInt32LE;
      Buffer.prototype.readInt32LE = function (o) { return -original.call(this, o) - 1; };
      for (let i = 0; i < T; i++) {
        assert(readViaMethod(buf, i & 63) === -dv.getInt32(i & 63, true) - 1, "prototype replaced at " + i);
      }
      compiles.afterPrototypeReplace = numberOfDFGCompiles(readViaMethod);
      Buffer.prototype.readInt32LE = original;
      for (let i = 0; i < T; i++) {
        assert(readViaMethod(buf, i & 63) === dv.getInt32(i & 63, true), "prototype restored at " + i);
      }
      compiles.afterPrototypeRestore = numberOfDFGCompiles(readViaMethod);
      report(compiles);
    `);
    // The warm site was compiled once, and each change of what b.readInt32LE resolves to costs it at
    // most one recompile. The first change always costs one (the callee the intrinsic was inlined for
    // is gone). Whether the later ones cost another depends on when the compiles landed: the site
    // may already check the structure of the lookup, or already handle both callees.
    expect(result).toMatchObject({ warm: 1, afterInstanceShadow: 2 });
    expect(result.afterPrototypeReplace).toBeLessThanOrEqual(3);
    expect(result.afterPrototypeRestore).toBeLessThanOrEqual(4);
  });

  test("resizable and growable receivers keep tracking the length after tier-up", async () => {
    const result = await scenario(`
      function readEnd(b) { return b.readUInt16LE(b.length - 2); }
      function readAt(b, o) { return b.readUInt16LE(o); }
      noInline(readEnd); noInline(readAt);
      // Warm on fixed-size buffers first so the resizable ones arrive after optimization.
      for (let i = 0; i < N; i++) { readEnd(buf); readAt(buf, i & 63); }
      const compiles = { warm: [numberOfDFGCompiles(readEnd), numberOfDFGCompiles(readAt)] };

      const rab = new ArrayBuffer(16, { maxByteLength: 128 });
      const tracking = Buffer.from(rab); // length-tracking view
      tracking.writeUInt16LE(0xabcd, 14);
      for (let i = 0; i < T; i++) assert(readEnd(tracking) === 0xabcd, "before grow at " + i);
      rab.resize(128);
      tracking.writeUInt16LE(0x1234, 126);
      for (let i = 0; i < T; i++) {
        assert(readEnd(tracking) === 0x1234, "after grow at " + i);
        assert(readAt(tracking, 126) === 0x1234, "read into the grown region at " + i);
      }
      rab.resize(8);
      const shrinkErrors = new Set();
      for (let i = 0; i < T; i++) {
        try { readAt(tracking, 14); shrinkErrors.add("no throw"); }
        catch (e) { shrinkErrors.add(e.code); }
      }
      compiles.afterResizable = [numberOfDFGCompiles(readEnd), numberOfDFGCompiles(readAt)];

      const gsab = new SharedArrayBuffer(16, { maxByteLength: 128 });
      const shared = Buffer.from(gsab);
      shared.writeUInt16LE(0x5678, 14);
      for (let i = 0; i < T; i++) assert(readEnd(shared) === 0x5678, "shared before grow at " + i);
      gsab.grow(128);
      shared.writeUInt16LE(0x9abc, 126);
      for (let i = 0; i < T; i++) assert(readEnd(shared) === 0x9abc, "shared after grow at " + i);
      compiles.afterGrowable = [numberOfDFGCompiles(readEnd), numberOfDFGCompiles(readAt)];
      report({ compiles, shrinkErrors: [...shrinkErrors] });
    `);
    // A view over a resizable buffer has its own structure, so each site recompiles once when it
    // first sees one, and readAt once more when the shrink puts its offset out of bounds. The
    // growable shared buffer is then handled by the code that already tracks the length.
    expect(result).toEqual({
      compiles: { warm: [1, 1], afterResizable: [2, 3], afterGrowable: [2, 3] },
      shrinkErrors: ["ERR_OUT_OF_RANGE"],
    });
  });

  // Differential fuzzer: an identical seeded operation stream runs once with the JIT and once with
  // BUN_JSC_useJIT=0; the two traces (return values, error class/code/message, and the receiver's
  // length and bytes after every operation) must match. Ported from
  // JSTests/stress/buffer-accessor-jit-differential.js.
  //
  // Debug builds compile 50-100x slower, so they run a short DFG-only round as a smoke test; the
  // release and release-ASAN lanes carry the full FTL coverage.
  const fuzzerEnv = isDebug ? { BUN_JSC_useFTLJIT: "0" } : {};
  const fuzzerSource = `
    const { noInline, noFTL } = require("bun:jsc");
    const ROUNDS = ${isDebug ? 6 : 40}, STEPS = ${isDebug ? 300 : 850};
    let seed = 0x9e3779b1;
    function rand() { seed ^= seed << 13; seed |= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0; return (seed >>> 0) / 4294967296; }
    function randInt(lo, hi) { return lo + ((rand() * (hi - lo + 1)) | 0); }
    function pick(list) { return list[(rand() * list.length) | 0]; }
    // The accessors under test, listed here rather than read off Buffer.prototype, so the seeded
    // stream depends on the seed alone and not on the order of the prototype's property table.
    const kinds = ["Int8", "UInt8", "Int16LE", "Int16BE", "UInt16LE", "UInt16BE", "Int32LE", "Int32BE", "UInt32LE", "UInt32BE",
      "BigInt64LE", "BigInt64BE", "BigUInt64LE", "BigUInt64BE", "FloatLE", "FloatBE", "DoubleLE", "DoubleBE", "IntLE", "IntBE", "UIntLE", "UIntBE"];
    const readers = kinds.map(k => "read" + k), writers = kinds.map(k => "write" + k);
    for (const name of [...readers, ...writers]) {
      if (typeof Buffer.prototype[name] !== "function") throw new Error(name + " is not a Buffer.prototype method");
    }
    function describeName(name) {
      const isWrite = name.startsWith("write"), isFloat = /Float|Double/.test(name), isBigInt = /Big/.test(name);
      const isVarWidth = /Int(LE|BE)$/.test(name) && !/(8|16|32|64)/.test(name), isSigned = !/UInt/.test(name);
      const byteSize = /Double/.test(name) ? 8 : /Float/.test(name) ? 4 : isBigInt ? 8 : isVarWidth ? 0 : Number(name.match(/(8|16|32|64)/)[0]) / 8;
      return { isWrite, isFloat, isBigInt, isVarWidth, isSigned, byteSize };
    }
    // A value the accessor accepts: the edges of its range and something in between.
    function cleanValue(shape, size) {
      if (shape.isBigInt) {
        switch (randInt(0, 3)) {
          case 0: return shape.isSigned ? -(2n ** 63n) : 0n;
          case 1: return shape.isSigned ? 2n ** 63n - 1n : 2n ** 64n - 1n;
          case 2: return shape.isSigned ? -1n : 12345678901234567890n;
          default: return BigInt(randInt(shape.isSigned ? -1e6 : 0, 1e6));
        }
      }
      if (shape.isFloat) {
        switch (randInt(0, 5)) {
          case 0: return rand() * 1e6 - 5e5;
          case 1: return Math.fround(rand() * 100);
          case 2: return -0;
          case 3: return Infinity;
          case 4: return 2 ** -1074;
          default: return 1e300;
        }
      }
      const min = shape.isSigned ? -(2 ** (8 * size - 1)) : 0, max = shape.isSigned ? 2 ** (8 * size - 1) - 1 : 2 ** (8 * size) - 1;
      switch (randInt(0, 4)) {
        case 0: return min;
        case 1: return max;
        case 2: return 0;
        default: return randInt(min, max);
      }
    }
    // Anything at all: out-of-range and non-integral numbers, every other primitive, BigInts of every size.
    function dirtyValue() {
      switch (randInt(0, 25)) {
        case 0: return (rand() * 2 ** 32) | 0;
        case 1: return -((rand() * 2 ** 31) | 0);
        case 2: return 2 ** 31;
        case 3: return 2 ** 32;
        case 4: return -(2 ** 31) - 1;
        case 5: return rand() * 1e6 - 5e5;
        case 6: return 0.5;
        case 7: return -0.5;
        case 8: return -0;
        case 9: return NaN;
        case 10: return Infinity;
        case 11: return -Infinity;
        case 12: return 2 ** 53 + 1;
        case 13: return "42";
        case 14: return "abc";
        case 15: return "";
        case 16: return true;
        case 17: return false;
        case 18: return null;
        case 19: return undefined;
        case 20: return 5n;
        case 21: return 2n ** 63n;
        case 22: return 2n ** 64n;
        case 23: return -1n;
        case 24: return -(2n ** 63n) - 1n;
        default: return Symbol("v");
      }
    }
    function dirtyOffset(length) {
      switch (randInt(0, 17)) {
        case 0: return randInt(0, length + 3);
        case 1: return -randInt(1, 8);
        case 2: return length - randInt(0, 8);
        case 3: return rand() * length;
        case 4: return -0;
        case 5: return 2 ** 31 + randInt(0, 8);
        case 6: return 2 ** 32;
        case 7: return 2 ** 53 + 2;
        case 8: return NaN;
        case 9: return Infinity;
        case 10: return -Infinity;
        case 11: return undefined;
        case 12: return null;
        case 13: return String(randInt(0, length));
        case 14: return "not a number";
        case 15: return true;
        case 16: return Symbol("s");
        default: return 3n;
      }
    }
    function dirtyByteLength() {
      switch (randInt(0, 8)) {
        case 0: return randInt(1, 6);
        case 1: return 0;
        case 2: return 7;
        case 3: return -1;
        case 4: return 2.5;
        case 5: return NaN;
        case 6: return "4";
        case 7: return undefined;
        default: return 9n;
      }
    }
    function makeReceiver() {
      switch (randInt(0, 4)) {
        case 0: return Buffer.alloc(32);
        case 1: return Buffer.from(new ArrayBuffer(64), 8, 24);
        case 2: return Buffer.alloc(7);
        case 3: return Buffer.from(new ArrayBuffer(16, { maxByteLength: 64 }));
        default: return Buffer.from(new ArrayBuffer(48, { maxByteLength: 64 }), 8, 16);
      }
    }
    // One call site per accessor. noInline keeps it out of the driver loop, so the driver is not
    // recompiled every round and the accessor call is compiled (and recompiled after exits) on its own.
    function makeInvoker(name) {
      if (!/^[A-Za-z0-9]+$/.test(name)) throw new Error("bad name " + name);
      const invoke = new Function("return function invoke_" + name + "(receiver, args, box) { try { let result;" +
        " switch (args.length) { case 0: result = receiver." + name + "(); break;" +
        " case 1: result = receiver." + name + "(args[0]); break;" +
        " case 2: result = receiver." + name + "(args[0], args[1]); break;" +
        " default: result = receiver." + name + "(args[0], args[1], args[2]); break; }" +
        " box.value = result; box.error = null; } catch (e) { box.value = undefined;" +
        " box.error = e === null || typeof e !== 'object' ? 'throw:' + String(e) : 'throw:' + e.constructor.name + ':' + (e.code === undefined ? '' : e.code) + ':' + e.message; } };")();
      noInline(invoke);
      return invoke;
    }
    const invokers = new Map();
    const invokerFor = name => { let f = invokers.get(name); if (!f) invokers.set(name, (f = makeInvoker(name))); return f; };
    // FNV-1a over 32-bit words. A number enters as its exact bits (so -0 and 0 differ), an error or
    // a BigInt as the crc32 of its text, and the receiver as its length and the crc32 of its bytes.
    let digest = 0x811c9dc5;
    const mix = word => { digest = Math.imul(digest ^ word, 0x01000193); };
    const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
    let throws = 0;
    function mixOutcome(box) {
      if (box.error !== null) { throws++; mix(1); mix(Bun.hash.crc32(box.error)); return; }
      const value = box.value;
      switch (typeof value) {
        case "number": bits[0] = value; mix(2); mix(words[0]); mix(words[1]); return;
        case "bigint": mix(3); mix(Bun.hash.crc32(String(value))); return;
        case "undefined": mix(4); return;
        default: throw new Error("unexpected result type " + typeof value);
      }
    }
    const box = { value: undefined, error: null };
    let ops = 0, resizes = 0;
    // The driver is the harness around the invokers, which are compiled on their own: it runs in the
    // DFG only, since FTL-compiling it proves nothing and costs seconds in a debug build.
    function drive() {
      for (let round = 0; round < ROUNDS; ++round) {
        const receiver = makeReceiver();
        const name = pick(rand() < 0.5 ? readers : writers);
        const shape = describeName(name), clean = rand() < 0.6, invoke = invokerFor(name);
        const width = shape.isVarWidth ? randInt(1, 6) : shape.byteSize;
        let resizeCountdown = clean ? Infinity : 100 + randInt(0, 400);
        for (let step = 0; step < STEPS; ++step) {
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
          mixOutcome(box);
          mix(receiver.length);
          mix(Bun.hash.crc32(receiver));
          if (--resizeCountdown === 0) {
            resizeCountdown = 100 + randInt(0, 400);
            const ab = receiver.buffer;
            if (typeof ab.resize === "function" && ab.resizable) { resizes++; try { ab.resize(randInt(0, ab.maxByteLength)); } catch {} }
          }
        }
      }
    }
    noFTL(drive);
    drive();
    console.log(JSON.stringify({ digest: (digest >>> 0).toString(16), ops, throws, resizes, accessors: invokers.size }));
  `;

  test("differential fuzzer: JIT and useJIT=0 agree on every result, error and byte", async () => {
    const [jit, reference] = await Promise.all([
      run(fuzzerSource, fuzzerEnv),
      run(fuzzerSource, { ...fuzzerEnv, BUN_JSC_useJIT: "0" }),
    ]);
    expect(jit.stderr).toBe("");
    expect(reference.stderr).toBe("");
    expect(jit.exitCode).toBe(0);
    expect(reference.exitCode).toBe(0);
    const jitResult = JSON.parse(jit.stdout);
    const referenceResult = JSON.parse(reference.stdout);
    // The JIT arm reproduces the interpreter's trace exactly.
    expect(jitResult).toEqual(referenceResult);
    // The stream is a function of the seed and the accessor list alone, so its shape is fixed: how
    // many operations ran, how many distinct accessors they hit, how many receivers were resized.
    // Which dirty inputs throw is the host's decision, so that count only has to be large.
    expect(referenceResult).toMatchObject(
      isDebug ? { ops: 1800, accessors: 4, resizes: 0 } : { ops: 34000, accessors: 30, resizes: 13 },
    );
    expect(referenceResult.throws).toBeGreaterThan(isDebug ? 500 : 9_000);
  });

  // The two large-view scenarios allocate 3GB and 4GB. The pages are never touched, so the cost is
  // address space, not RSS, but the kernel refuses an allocation larger than physical memory up
  // front. 6GB admits the 8GB-class CI runners and excludes machines where 4GB would not fit.
  const enoughMemory = totalmem() >= 6 * 1024 ** 3;

  test.skipIf(!enoughMemory)("a >2GB receiver stays optimized: no exit storm, and OOB still throws", async () => {
    const result = await scenario(`
      const big = new Uint8Array(3 * 2**30);
      Object.setPrototypeOf(big, Buffer.prototype);
      const small = Buffer.alloc(64);
      function readAt(b, o) { return b.readInt32LE(o); }
      function writeAt(b, v, o) { return b.writeInt32LE(v, o); }
      noInline(readAt); noInline(writeAt);
      const top = 2 ** 31 - 4;
      for (let i = 0; i < N; i++) {
        assert(writeAt(big, i, 100) === 104, "write low at " + i);
        assert(readAt(big, 100) === i, "read low at " + i);
        assert(writeAt(big, ~i, top) === top + 4, "write at the int32 offset ceiling at " + i);
        assert(readAt(big, top) === ~i, "read at the int32 offset ceiling at " + i);
        assert(writeAt(small, i, 60) === 64 && readAt(small, 60) === i, "the same site with a small receiver at " + i);
      }
      const straddling = new Set();
      for (let i = 0; i < T; i++) { try { readAt(big, big.length - 3); straddling.add("no throw"); } catch (e) { straddling.add(e.code); } }
      report({ compiles: { readAt: numberOfDFGCompiles(readAt), writeAt: numberOfDFGCompiles(writeAt) }, straddling: [...straddling] });
    `);
    // The site sees three things worth one recompile each, in an order that depends on when the
    // first compile lands: offset + 4 overflowing int32 at the ceiling, a second receiver shape, and
    // a straddling offset that is not an int32. A site that keeps exiting on every call has 1800
    // exits to spend here and reads 6 or 7 (the exit budget doubles with every recompile).
    expect(result.straddling).toEqual(["ERR_OUT_OF_RANGE"]);
    expect(result.compiles.readAt).toBeLessThanOrEqual(5);
    expect(result.compiles.writeAt).toBeLessThanOrEqual(5);
  });

  test.skipIf(!enoughMemory)("views with 2GB and ~4GB byteOffsets read and write correctly after tier-up", async () => {
    const result = await scenario(`
      const ab = new ArrayBuffer(4 * 2**30);
      const tailOffset = 4 * 2**30 - 64;
      const tail = Buffer.from(ab, tailOffset, 64);
      const wide = Buffer.from(ab, 2**31);
      const raw = new DataView(ab);
      function readAt(v, o) { return v.readInt32LE(o); }
      function writeAt(v, x, o) { return v.writeInt32LE(x, o); }
      noInline(readAt); noInline(writeAt);
      for (let i = 0; i < N; i++) {
        assert(writeAt(tail, i, 8) === 12 && readAt(tail, 8) === i, "~4GB byteOffset view at " + i);
        assert(writeAt(wide, ~i, wide.length - 4) === wide.length && readAt(wide, wide.length - 4) === ~i, "2GB byteOffset view at " + i);
      }
      let straddling;
      try { readAt(tail, 61); straddling = "no throw"; } catch (e) { straddling = e.code; }
      report({
        tailStore: raw.getInt32(tailOffset + 8, true),
        wideStore: raw.getInt32(2**31 + wide.length - 4, true),
        compiles: { readAt: numberOfDFGCompiles(readAt), writeAt: numberOfDFGCompiles(writeAt) },
        straddling,
      });
    `);
    // The last stores landed at byteOffset + offset (seen through a DataView over the whole 4GB
    // buffer), and a read past the end of the tiny high-offset view throws. wide.length is 2**31,
    // not an int32, so offsets computed from it cost the site a recompile or two; a site that keeps
    // exiting on every call has 1000 exits to spend here and reads 6.
    expect(result).toMatchObject({ tailStore: N - 1, wideStore: ~(N - 1), straddling: "ERR_OUT_OF_RANGE" });
    expect(result.compiles.readAt).toBeLessThanOrEqual(5);
    expect(result.compiles.writeAt).toBeLessThanOrEqual(5);
  });
});
