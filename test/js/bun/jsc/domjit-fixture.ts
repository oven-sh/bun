// The child process of domjit.test.ts. It calls host functions from every tier and prints one JSON line per case.
//
// A case is a function with one hot loop. `drive` calls it until JSC installs FTL code for it, and then some more.
// On the way the loop runs in LLInt, then in Baseline, then in DFG. domjit.test.ts sets the JSC options this needs:
//   BUN_JSC_useConcurrentJIT=0                       compiles run on this thread, so each run tiers up at the same loop
//   BUN_JSC_thresholdForFTLOptimizeAfterWarmUp=1000  DFG code asks for FTL code after about 1000 loops, not 64000
//   BUN_JSC_testTheFTL=1                             numberOfDFGCompiles() counts FTL compiles, not DFG compiles
import { ptr, read } from "bun:ffi";
// @ts-expect-error bun-types does not declare noInline
import { noInline, numberOfDFGCompiles, reoptimizationRetryCount } from "bun:jsc";
import crypto from "node:crypto";
import { statSync } from "node:fs";
import vm from "node:vm";

if (process.env.BUN_JSC_testTheFTL !== "1") throw new Error("domjit.test.ts must start this file");

const dirStats = statSync(import.meta.dir);
// Longer than 1024 bytes: see #13320.
const longString = Buffer.alloc(1030, "a").toString();
// Bytes 8 to 15 are 0x81 to 0x88, so every width has its sign bit set. domjit.test.ts decodes the same bytes with a
// DataView. Reading `ffiBuffer.buffer` to write them would move the array to another storage mode.
const ffiBuffer = new BigInt64Array(16);
ffiBuffer[1] = BigInt.asIntN(64, 0x8887868584838281n);

// The node:vm realms evaluate the source text of this function, so each name it does not declare is either a JavaScript
// builtin or a property of `sandbox`. Each case reads what its calls return: DFG deletes a `performance.now()` call
// when nothing reads its result.
function defineCases() {
  const encoder = new TextEncoder();
  const into = new Uint8Array(4);
  const random = new Uint8Array(4);
  const utf8 = new Uint8Array([116, 101, 115, 116]);
  // "é", a byte that is not UTF-8, "t": the result is a 16-bit string.
  const notUTF8 = new Uint8Array([0xc3, 0xa9, 0xff, 0x74]);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sameBytes = new Uint8Array([1, 2, 3, 4]);
  const otherBytes = new Uint8Array([1, 2, 3, 5]);
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const isA = byte => byte === 97;

  return {
    "Buffer.alloc"(n) {
      let last;
      let zeroed = true;
      for (let i = 0; i < n; i++) {
        last = Buffer.alloc(1);
        zeroed &&= last[0] === 0;
        // The next Buffer.alloc() that gets this byte must zero it again.
        last[0] = 255;
      }
      return { length: last.length, zeroed };
    },
    "Buffer.allocUnsafe"(n) {
      let last;
      for (let i = 0; i < n; i++) last = Buffer.allocUnsafe(1);
      return { length: last.length };
    },
    "Buffer.allocUnsafeSlow"(n) {
      let last;
      for (let i = 0; i < n; i++) last = Buffer.allocUnsafeSlow(1);
      return { length: last.length };
    },
    "Performance.now"(n) {
      let first = 0;
      let last = 0;
      let ordered = true;
      for (let i = 0; i < n; i++) {
        const now = performance.now();
        if (i === 0) first = now;
        ordered &&= now >= last;
        last = now;
      }
      // `advanced` is false if the compiler moves the call out of the loop.
      return { ordered, advanced: last > first };
    },
    "TextEncoder.encode"(n) {
      let last;
      for (let i = 0; i < n; i++) last = new TextEncoder().encode("test");
      return Array.from(last);
    },
    "TextEncoder.encode, 1030 bytes"(n) {
      let last;
      for (let i = 0; i < n; i++) last = encoder.encode(longString);
      return { length: last.length, allA: last.every(isA) };
    },
    "TextEncoder.encodeInto"(n) {
      let last;
      for (let i = 0; i < n; i++) {
        into.fill(0);
        last = new TextEncoder().encodeInto("test", into);
      }
      return { read: last.read, written: last.written, bytes: Array.from(into) };
    },
    "Crypto.timingSafeEqual"(n) {
      let identical = true;
      let equal = true;
      let unequal = false;
      for (let i = 0; i < n; i++) {
        identical &&= crypto.timingSafeEqual(bytes, bytes);
        equal &&= crypto.timingSafeEqual(bytes, sameBytes);
        unequal ||= crypto.timingSafeEqual(bytes, otherBytes);
      }
      return { identical, equal, unequal };
    },
    "Crypto.randomUUID"(n) {
      let last = "";
      let distinct = true;
      for (let i = 0; i < n; i++) {
        const uuid = crypto.randomUUID();
        distinct &&= uuid !== last;
        last = uuid;
      }
      return { v4: uuidV4.test(last), distinct };
    },
    "Crypto.getRandomValues"(n) {
      let last;
      let filled = false;
      for (let i = 0; i < n; i++) {
        random.fill(0);
        last = crypto.getRandomValues(random);
        // One call in 2^32 fills four bytes with zeros, so this asks for one non-zero fill in the loop, not for each.
        filled ||= (random[0] | random[1] | random[2] | random[3]) !== 0;
      }
      return { returnsItsArgument: last === random, filled };
    },
    "TextDecoder.decode"(n) {
      let last;
      for (let i = 0; i < n; i++) last = [new TextDecoder().decode(utf8), new TextDecoder().decode(notUTF8)];
      return last;
    },
    "Stats"(n) {
      let last;
      for (let i = 0; i < n; i++) {
        last = {
          isSymbolicLink: dirStats.isSymbolicLink(),
          isSocket: dirStats.isSocket(),
          isFile: dirStats.isFile(),
          isFIFO: dirStats.isFIFO(),
          isDirectory: dirStats.isDirectory(),
          isCharacterDevice: dirStats.isCharacterDevice(),
          isBlockDevice: dirStats.isBlockDevice(),
        };
      }
      return last;
    },
    "FFI ptr and read"(n) {
      let last;
      for (let i = 0; i < n; i++) {
        last = {
          intptr: read.intptr(ptr(ffiBuffer), 8),
          ptr: read.ptr(ptr(ffiBuffer), 8),
          f32: read.f32(ptr(ffiBuffer), 8),
          f64: read.f64(ptr(ffiBuffer), 8),
          i64: read.i64(ptr(ffiBuffer), 8),
          u64: read.u64(ptr(ffiBuffer), 8),
          i8: read.i8(ptr(ffiBuffer), 8),
          i16: read.i16(ptr(ffiBuffer), 8),
          i32: read.i32(ptr(ffiBuffer), 8),
          u8: read.u8(ptr(ffiBuffer), 8),
          u16: read.u16(ptr(ffiBuffer), 8),
          u32: read.u32(ptr(ffiBuffer), 8),
        };
      }
      return last;
    },
  };
}

type Case = (loops: number) => unknown;

const source = `(${defineCases})()`;
const sandbox = { Buffer, performance, TextEncoder, TextDecoder, crypto, dirStats, ptr, read, ffiBuffer, longString };
const realms: Record<string, () => Record<string, Case>> = {
  "main": () => defineCases(),
  "Script.runInNewContext": () => new vm.Script(source).runInNewContext(sandbox),
  "vm.runInNewContext": () => vm.runInNewContext(source, sandbox),
};

const loopsPerCall = 50;
// JSC throws optimized code away after more than 100 bail-outs from it, and counts that as a reoptimization. So FTL
// code that bails out on every call does not survive this many calls.
const callsInFTL = 128;
// The largest case gets FTL code after about 100 calls.
const maxCalls = 1000;

// With testTheFTL, numberOfDFGCompiles() is 1 once the FTL code of `fn` is installed, plus the number of
// reoptimizations. It is 1000000 if `fn` cannot get FTL code.
const hasFTLCode = (fn: Case) => numberOfDFGCompiles(fn) - reoptimizationRetryCount(fn) === 1;

function drive(fn: Case) {
  // The loop must tier up in the code of `fn`, not in a copy of it inside the caller.
  noInline(fn);
  const results = new Set<string>();
  let calls = 0;
  const call = () => {
    results.add(JSON.stringify(fn(loopsPerCall), (_, value) => (typeof value === "bigint" ? `${value}n` : value)));
    calls++;
  };

  while (!hasFTLCode(fn) && calls < maxCalls) call();
  let tier = hasFTLCode(fn) ? "FTL" : `no FTL code after ${calls} calls`;
  for (let i = 0; i < callsInFTL; i++) call();
  // Read before the next case runs. JSC also counts one when a later case makes this code invalid, as the first use of
  // Buffer.allocUnsafe does to the code of the Buffer.alloc case.
  const reoptimizations = reoptimizationRetryCount(fn);
  if (reoptimizations) tier += `, reoptimized ${reoptimizations} times`;

  // One element if every call, in every tier, returned the same value.
  return { tier, results: Array.from(results, result => JSON.parse(result)) };
}

for (const [name, fn] of Object.entries(realms[process.argv[2]]())) {
  console.log(JSON.stringify({ name, ...drive(fn) }));
}
