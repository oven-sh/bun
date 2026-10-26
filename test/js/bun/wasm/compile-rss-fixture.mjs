// Fixture for compile-rss.test.ts. A burst compiles a generated wasm module 6 times, discards each
// result, then polls RSS until it falls below the target (argv[2], MiB) or a deadline passes. The
// idle compiler threads exit after 10 s and release everything then, so a deadline stays well
// below that. argv[3] says which bursts count: "later" (two of the bursts after the first one) or
// "first" (one burst, the first one included). Prints one JSON line with, for each burst, the RSS
// growth right after the compiles and the lowest one seen after them, both relative to the RSS
// before the first compile.

class Bytes {
  constructor() {
    this.buf = new Uint8Array(1 << 20);
    this.len = 0;
  }
  push(...bytes) {
    for (const b of bytes) this.byte(b);
  }
  byte(b) {
    if (this.len === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = b;
  }
  leb(n) {
    do {
      let b = n & 0x7f;
      n >>>= 7;
      if (n !== 0) b |= 0x80;
      this.byte(b);
    } while (n !== 0);
  }
  append(other) {
    for (let i = 0; i < other.len; i++) this.byte(other.buf[i]);
  }
  section(id, payload) {
    this.byte(id);
    this.leb(payload.len);
    this.append(payload);
  }
  bytes() {
    return this.buf.subarray(0, this.len);
  }
}

// A module shaped like a tree-sitter parser: a few dozen functions of 20 to 30 KB of control-flow
// heavy code, plus one giant function. Compiling it makes each wasm compiler thread allocate and
// free tens of MB of temporaries. Uniform modules of many small functions do not show the
// retention: their pages end up fully free and mimalloc's scavenger purges them on its own.
function makeModule({ functionCount = 35, opsPerFunction = 1400, giantOps = 30000 } = {}) {
  const out = new Bytes();
  out.push(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);

  // type 0: (i32, i32) -> i32
  const types = new Bytes();
  types.push(1, 0x60, 2, 0x7f, 0x7f, 1, 0x7f);
  out.section(1, types);

  const funcs = new Bytes();
  funcs.leb(functionCount);
  for (let f = 0; f < functionCount; f++) funcs.byte(0);
  out.section(3, funcs);

  const exports = new Bytes();
  exports.push(1, 1, 0x66, 0x00, 0); // export "f" = func 0
  out.section(7, exports);

  const code = new Bytes();
  code.leb(functionCount);
  for (let f = 0; f < functionCount; f++) {
    const ops = f === 0 ? giantOps : opsPerFunction + ((f * 7919) % 400);
    const body = new Bytes();
    body.push(1, 1, 0x7f); // one local group: 1 x i32
    body.push(0x20, 0); // local.get 0
    for (let i = 0; i < ops; i++) {
      // block
      //   local.get 1; i32.const k; i32.add; local.tee 2
      //   br_table {0,0,0,0} 0
      //   local.get 2; local.get 0; call g; drop
      // end
      // local.get 2; i32.xor
      body.push(0x02, 0x40, 0x20, 1, 0x41);
      body.leb((f * 31 + i * 7) & 0x3f);
      body.push(0x6a, 0x22, 2, 0x0e, 4, 0, 0, 0, 0, 0, 0x20, 2, 0x20, 0, 0x10);
      body.leb((f + 1) % functionCount);
      body.push(0x1a, 0x0b, 0x20, 2, 0x73);
    }
    body.byte(0x0b); // end
    code.leb(body.len);
    code.append(body);
  }
  out.section(10, code);
  return out.bytes();
}

const targetMiB = Number(process.argv[2]);
if (!Number.isFinite(targetMiB)) throw new Error(`expected the target in MiB as argv[2], got ${process.argv[2]}`);
const countFirst = process.argv[3] === "first";
if (!countFirst && process.argv[3] !== "later") throw new Error(`expected "first" or "later" as argv[3]`);
// On Darwin mimalloc returns memory with MADV_FREE_REUSABLE, which the kernel keeps counted in RSS
// until it reuses the pages. phys_footprint drops at once, so measure that there. memoryFootprint()
// returns undefined when task_info fails, so fall back to RSS.
const rss = () =>
  (process.platform === "darwin" ? Bun.unsafe.memoryFootprint?.() : undefined) ?? process.memoryUsage.rss();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bytes = makeModule();

// Building the module leaves garbage behind. Wait until RSS stops falling before taking the
// baseline: mimalloc hands freed memory back on its own schedule, and there is no signal for it.
let base = Infinity;
const baseDeadline = performance.now() + 2000;
do {
  Bun.gc(true);
  await sleep(50);
  const now = rss();
  if (now >= base - 1048576) break;
  base = now;
} while (performance.now() < baseDeadline);

// No burst starts after this: a run that fails has to end inside the timeout of the test, so that
// the test prints what this measured.
const lastStart = performance.now() + 3000;

async function burst() {
  // A compile() call wakes every compiler thread before it returns, and a thread releases its
  // free memory when 100 ms have passed without a wake-up. So the longest time between two
  // wake-ups, or between the last one and the end of the collection below, says whether a thread
  // can have released before the collection freed the modules.
  let longestGapMs = 0;
  let woken = performance.now();
  // Each compile adds to what the compiler threads keep if they do not release (8 threads: 18 to
  // 27 MiB after 3 compiles, 35 to 39 MiB after 6) and costs about 20 ms.
  for (let i = 0; i < 6; i++) {
    const called = performance.now();
    const compiled = WebAssembly.compile(bytes);
    longestGapMs = Math.max(longestGapMs, performance.now() - woken);
    woken = called;
    await compiled;
  }
  // Read before anything is freed: the test checks that the compiles grew RSS at all.
  const peak = rss() - base;
  // The frame refers to the last module until the next await.
  await 0;
  // Free the modules. The main thread frees their metadata into the compiler threads' pages, and
  // only those threads can hand that memory back.
  Bun.gc(true);
  longestGapMs = Math.max(longestGapMs, performance.now() - woken);
  // A thread releases 100 ms after its last wake-up, and once or twice more, 100 ms apart, for
  // the large blocks that it was using a moment ago. Every burst gets the whole second: after
  // one release most of the memory is still there.
  const collected = performance.now();
  let min = Infinity;
  do {
    await sleep(100);
    Bun.gc(true);
    min = Math.min(min, rss() - base);
  } while (performance.now() < collected + 1000 && min / 1048576 >= targetMiB);
  return {
    peakDeltaMiB: peak / 1048576,
    idleDeltaMiB: min / 1048576,
    longestGapMs,
    polledMs: performance.now() - collected,
  };
}

// A burst counts when its memory came back. One that stays over the target ends the run, unless a
// thread can have released before the collection freed the modules: a stall of 100 ms on a busy
// machine is enough for that, and it says nothing about the release. That burst is repeated.
let released = 0;
let stop = false;
const count = burst => {
  if (burst.idleDeltaMiB < targetMiB) released++;
  else if (burst.longestGapMs < 100) stop = true;
};
// With "later" the first burst does not count. The allocator frees the large blocks of a thread
// at once while that thread has never released, so the first burst can return its memory when no
// later one does.
const first = await burst();
if (countFirst) count(first);
const needed = countFirst ? 1 : 2;
const bursts = [];
while (!stop && released < needed && performance.now() < lastStart) {
  const next = await burst();
  bursts.push(next);
  count(next);
}
console.log(JSON.stringify({ moduleMiB: bytes.length / 1048576, first, bursts }));
