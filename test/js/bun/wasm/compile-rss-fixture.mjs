// Compile one control-flow-heavy wasm module many times, drop every Module,
// then watch RSS. Prints one JSON line: how far above the pre-compile
// baseline RSS settled, and how long that took.
//
// The module is F functions, each `(local.get 0)` followed by OPS copies of
// `(block (br_if 0 (local.get 0)))`. Blocks and branches are what make the
// compiler threads allocate (control stack, IPInt metadata); straight-line
// arithmetic of the same byte size retains almost nothing.
const F = 1500;
const OPS = 600;
const COMPILES = 20;
const SETTLED_MIB = +process.env.SETTLED_MIB;
const DEADLINE_MS = +process.env.DEADLINE_MS;

function leb(n) {
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return out;
}

const bodyLen = 3 + OPS * 7 + 1;
const fnHeader = leb(bodyLen);
const codeCount = leb(F);
const codeLen = codeCount.length + F * (fnHeader.length + bodyLen);
const typeSec = [1, 0x60, 1, 0x7f, 1, 0x7f];
const funcSec = [...leb(F), ...new Array(F).fill(0)];
const sizeOf = sec => 1 + leb(sec.length).length + sec.length;
const total = 8 + sizeOf(typeSec) + sizeOf(funcSec) + 1 + leb(codeLen).length + codeLen;

// Write straight into one Uint8Array so the baseline is not inflated by
// megabytes of number arrays waiting to be collected.
const bytes = new Uint8Array(total);
let p = 0;
const put = arr => {
  for (const x of arr) bytes[p++] = x;
};
put([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
put([1, ...leb(typeSec.length), ...typeSec]);
put([3, ...leb(funcSec.length), ...funcSec]);
put([10, ...leb(codeLen), ...codeCount]);
for (let f = 0; f < F; f++) {
  put(fnHeader);
  put([0x00, 0x20, 0x00]);
  for (let i = 0; i < OPS; i++) put([0x02, 0x40, 0x20, 0x00, 0x0d, 0x00, 0x0b]);
  bytes[p++] = 0x0b;
}
if (p !== total) throw new Error(`module size mismatch: wrote ${p}, expected ${total}`);

// On macOS mimalloc returns memory with MADV_FREE_REUSABLE, which leaves RSS
// untouched until the kernel needs the pages. phys_footprint drops at once.
const footprint =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : () => process.memoryUsage().rss;
const rssMiB = () => footprint() / 1048576;
const sleep = ms => new Promise(r => setTimeout(r, ms));

Bun.gc(true);
await sleep(300);
Bun.gc(true);
const base = rssMiB();

for (let i = 0; i < COMPILES; i++) {
  let mod = await WebAssembly.compile(bytes);
  mod = null;
}
Bun.gc(true);
const peak = rssMiB() - base;

const start = performance.now();
let delta = peak;
let settledAfterMs = -1;
while (performance.now() - start < DEADLINE_MS) {
  await sleep(250);
  Bun.gc(true);
  delta = rssMiB() - base;
  if (delta <= SETTLED_MIB) {
    settledAfterMs = Math.round(performance.now() - start);
    break;
  }
}

console.log(
  JSON.stringify({
    moduleBytes: bytes.length,
    baseMiB: Math.round(base),
    peakMiB: Math.round(peak),
    deltaMiB: Math.round(delta),
    settledAfterMs,
  }),
);
