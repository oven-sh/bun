// Fixture for compile-rss.test.ts. Compiles a generated wasm module 3 times, discards each result,
// then polls RSS until it falls below the target (argv[2], MiB) or the deadline passes. The idle
// compiler threads exit after 10 s and release everything then, so the deadline stays well below
// that. Prints one JSON line with the lowest RSS growth seen, relative to the RSS before the first
// compile.

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
// On Darwin mimalloc returns memory with MADV_FREE_REUSABLE, which the kernel keeps counted in RSS
// until it reuses the pages. phys_footprint drops at once, so measure that there.
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bytes = makeModule();

// Building the module leaves garbage behind. Wait until RSS stops falling before taking the
// baseline: mimalloc hands freed memory back on its own schedule, and there is no signal for it.
let base = Infinity;
for (const deadline = performance.now() + 2000; performance.now() < deadline; ) {
  Bun.gc(true);
  await sleep(50);
  const now = rss();
  if (now >= base - 1048576) break;
  base = now;
}
for (let i = 0; i < 3; i++) {
  let mod = await WebAssembly.compile(bytes);
  mod = null;
}
// Read before anything is freed: the test checks that the compiles grew RSS at all.
const peak = rss() - base;
// Free the modules. The main thread frees their metadata into the compiler threads' pages, and only
// those threads can hand that memory back. They do so once they have worked and gone idle again, so
// give each of them one trivial function to compile after the modules are gone.
Bun.gc(true);
await WebAssembly.compile(makeModule({ functionCount: 16, opsPerFunction: 1, giantOps: 1 }));
Bun.gc(true);
const afterCompiles = rss() - base;

const deadline = performance.now() + 3000;
let min = Infinity;
while (performance.now() < deadline && min / 1048576 >= targetMiB) {
  await sleep(100);
  Bun.gc(true);
  min = Math.min(min, rss() - base);
}
console.log(
  JSON.stringify({
    moduleMiB: bytes.length / 1048576,
    peakDeltaMiB: peak / 1048576,
    afterCompilesDeltaMiB: afterCompiles / 1048576,
    idleDeltaMiB: min / 1048576,
  }),
);
