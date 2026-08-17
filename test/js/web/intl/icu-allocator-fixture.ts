// Child process for icu-allocator.test.ts (Windows only).
//
// The parent puts this process in a Job Object with a per-process commit limit
// a little above the commit reported in READY, lifts it shortly after EDGE and
// then sends LIFTED. While the limit is in place this process clones ICU break
// iterators (Intl.Segmenter#segment) in a loop, arranged so that those clones
// are the only thing that needs fresh commit:
//  - the IntlSegments JS cells come from free cells left by a warm-up pass, so
//    JSC does not have to commit new blocks,
//  - the break iterators freed by that warm-up are taken up again by live
//    segment iterators, so ICU's heap has no spare room,
//  - the remaining headroom is taken with raw VirtualAlloc(MEM_COMMIT).
import { dlopen, FFIType, ptr } from "bun:ffi";

const k32 = dlopen("kernel32.dll", {
  GetCurrentProcess: { args: [], returns: FFIType.ptr },
  K32GetProcessMemoryInfo: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  VirtualAlloc: { args: [FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.ptr },
}).symbols;
const counters = new Uint8Array(80); // PROCESS_MEMORY_COUNTERS_EX
const countersView = new DataView(counters.buffer);
function commitMB(): number {
  countersView.setUint32(0, 80, true);
  if (!k32.K32GetProcessMemoryInfo(k32.GetCurrentProcess(), ptr(counters), 80)) {
    throw new Error("K32GetProcessMemoryInfo failed");
  }
  return Number(countersView.getBigUint64(72, true)) / 1048576; // PrivateUsage
}
const MEM_COMMIT_RESERVE = 0x1000 | 0x2000;
const PAGE_READWRITE = 0x04;

let stdinReader: ReturnType<ReturnType<typeof Bun.stdin.stream>["getReader"]> | undefined;
let buffered = "";
async function waitFor(word: string): Promise<string> {
  const fromArgv = process.argv.find(a => a.startsWith(word + "="));
  if (fromArgv) return fromArgv.slice(word.length + 1);
  stdinReader ??= Bun.stdin.stream().getReader();
  for (;;) {
    const nl = buffered.indexOf("\n");
    if (nl >= 0) {
      const line = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      if (line.startsWith(word)) return line.slice(word.length).trim();
      continue;
    }
    const { value, done } = await stdinReader.read();
    if (done) throw new Error("stdin closed while waiting for " + word);
    buffered += new TextDecoder().decode(value);
  }
}

const N = 60_000;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

{
  let warm: unknown[] = [];
  for (let i = 0; i < N; i++) warm.push(segmenter.segment("x"));
  warm = [];
  Bun.gc(true);
}
const pinned = segmenter.segment("x");
const iterators: unknown[] = [];
for (let i = 0; i < N; i++) iterators.push(pinned[Symbol.iterator]());

const keep: unknown[] = new Array(N).fill(null);
let kept = 0;
let errors = 0;
const messages = new Set<string>();

process.stdout.write(`READY ${Math.ceil(commitMB())}\n`);
const limitMB = Number(await waitFor("GO"));

// Commit charge is what the job limit counts, so untouched MEM_COMMIT pages
// are enough; stop at the first refusal.
for (const chunk of [4 << 20, 256 << 10, 64 << 10]) {
  while (commitMB() + chunk / 1048576 < limitMB && k32.VirtualAlloc(null, chunk, MEM_COMMIT_RESERVE, PAGE_READWRITE)) {}
}
const edgeMB = +commitMB().toFixed(2);

process.stdout.write("EDGE\n");
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  try {
    keep[kept++] = segmenter.segment("x");
  } catch (e) {
    errors++;
    messages.add(String(e));
  }
}
const elapsed = Math.round(performance.now() - t0);
process.stdout.write(`LOOP ${errors}\n`);

await waitFor("LIFTED");

// ICU must still be usable afterwards.
let after = "";
try {
  let n = 0;
  for (const _ of segmenter.segment("después 👍🏽 ok")) n++;
  after += `${n} `;
  after += [...new Intl.Segmenter("ja", { granularity: "word" }).segment("テスト中")].length;
  after += " " + new Intl.NumberFormat("en").format(1234567.891);
} catch (e) {
  errors++;
  messages.add("after: " + String(e));
}

process.stdout.write(
  `RESULT ${JSON.stringify({ errors, messages: [...messages], kept, after, limitMB, edgeMB, elapsed })}\n`,
);
process.exit(0);
