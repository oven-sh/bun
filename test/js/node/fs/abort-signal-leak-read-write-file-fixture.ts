// Fixture for abort-signal-leak-read-write-file.test.ts.
//
// Calls fs.promises.readFile() or fs.promises.writeFile() in rounds, each call
// with an AbortSignal of its own. Each round ends with a full GC and one sample
// of the resident memory. Prints one JSON line: how the calls settled, the
// samples and whether they are exact, the AbortSignal wrappers left on the
// heap, and the RSS at the end. The test decides what is a leak.
//
// argv: <readFile|writeFile> <signal> <rounds> <calls per round> <calls in flight>
// cwd:  a directory that holds the file "blah"
import { heapStats } from "bun:jsc";
import fs from "node:fs";

const [method, signalState, ...counts] = process.argv.slice(2);
const [rounds, callsPerRound, callsInFlight] = counts.map(Number);

const signals: Record<string, () => AbortSignal> = {
  // The call is rejected before anything is scheduled.
  "is already aborted": () => AbortSignal.abort(),
  // The call is scheduled on the thread pool. The signal aborts before the
  // result is back.
  "aborts on the next tick": () => {
    const controller = new AbortController();
    process.nextTick(() => controller.abort());
    return controller.signal;
  },
  // The call runs to its end. A signal that is not aborted and has an "abort"
  // listener keeps its wrapper for as long as native code holds a pending
  // activity count on it (JSAbortSignalOwner::isReachableFromOpaqueRoots).
  "never aborts": () => {
    const { signal } = new AbortController();
    signal.addEventListener("abort", () => {});
    return signal;
  },
};
const methods: Record<string, (signal: AbortSignal, slot: number) => Promise<unknown>> = {
  readFile: signal => fs.promises.readFile("blah", { signal }),
  writeFile: (signal, slot) => fs.promises.writeFile(`out-${slot}`, "blah", { signal }),
};
const newSignal = signals[signalState];
const call = methods[method];

// One call. Resolves to how it settled.
const outcomeOfCall = (slot: number) => {
  const signal = newSignal();
  return call(signal, slot).then(
    value =>
      value === undefined ? "resolved" : `resolved with ${Buffer.isBuffer(value) ? "Buffer" : typeof value} "${value}"`,
    error => `${error.name} ${error.code}${error.cause === signal.reason ? "" : ", cause is not signal.reason"}`,
  );
};

// On Linux, process.memoryUsage.rss() reads /proc/self/stat. Since Linux 6.2
// the kernel keeps that counter per CPU and adds each CPU's part to the total
// in batches, so the total is off by several MB and the error changes from one
// read to the next. smaps_rollup walks the page tables, so it is exact.
// `Anonymous` leaves out the pages of the bun binary, which the kernel can
// evict at any time.
//
// A walk that gives way to an mmap() or munmap() on another thread can leave
// mappings out. That is common on an ASAN build just after a GC. No walk counts
// a page twice, so the highest of a few reads is the number. About one sample
// in a hundred still comes out low, and the median in the test takes those.
function anonymousBytes(): number {
  let highest = 0;
  for (let read = 0; read < 8; read++) {
    const rollup = fs.readFileSync("/proc/self/smaps_rollup", "utf8");
    highest = Math.max(highest, Number(/^Anonymous:\s+(\d+) kB$/m.exec(rollup)![1]) * 1024);
  }
  return highest;
}

// Kernels before 4.14 and some sandboxes have no smaps_rollup. One source
// serves the whole run, because the two do not count the same pages.
let residentBytes: () => number = process.memoryUsage.rss;
let exact = false;
if (process.platform === "linux") {
  try {
    anonymousBytes();
    residentBytes = anonymousBytes;
    exact = true;
  } catch {}
}

const outcomes: Record<string, number> = {};
const samples: number[] = [];
for (let round = 0; round < rounds; round++) {
  // Several calls are in flight at a time. One at a time, each scheduled call
  // waits for two thread wakeups, and on an idle machine that is most of its
  // time.
  for (let started = 0; started < callsPerRound; started += callsInFlight) {
    const batch = Array.from({ length: Math.min(callsInFlight, callsPerRound - started) }, (_, slot) =>
      outcomeOfCall(slot),
    );
    for (const outcome of await Promise.all(batch)) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  Bun.gc(true);
  samples.push(residentBytes());
}

console.log(
  JSON.stringify({
    outcomes,
    samples,
    exact,
    abortSignals: heapStats().objectTypeCounts.AbortSignal ?? 0,
    rss: process.memoryUsage.rss(),
  }),
);
