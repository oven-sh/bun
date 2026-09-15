// Run by heap.test.ts, with and without BUN_PPROF_HEAP_MAX_STACKS: what a session keeps is bounded, and
// what has no room is still counted.
import { decode, type Profile } from "./pprof-decode";

const KiB = 1024;
const each = 256 * KiB;
// Functions of different names: each allocates from a stack of its own.
const allocators: ((bytes: number) => Uint8Array)[] = Array.from({ length: 64 }, (_, i) =>
  new Function(`return function allocator${i}(bytes) { return new Uint8Array(bytes).fill(${i}); }`)(),
);

function summary(profile: Profile) {
  const isOther = (s: Profile["samples"][number]) => s.stack.length === 1 && s.stack[0].function === "(other stacks)";
  const other = profile.samples.filter(isOther);
  const named = new Set<string>();
  let truncatedFrames = 0;
  for (const s of profile.samples) {
    for (const f of s.stack) {
      if (f.function?.startsWith("allocator")) named.add(f.function);
      if (f.function === "(truncated)") truncatedFrames++;
    }
  }
  const count = (what: string) => Number(new RegExp(`\\b${what}=(\\d+)`).exec(profile.comments.join("\n"))?.[1]);
  return {
    comments: profile.comments,
    samples: profile.samples.length,
    allocSpace: profile.totals.alloc_space,
    otherSamples: other.length,
    otherAllocSpace: other.reduce((sum, s) => sum + s.values.alloc_space, 0),
    otherLabels: other.map(s => s.labels),
    namedAllocators: named.size,
    framesNamedTruncated: truncatedFrames,
    threadLabels: [...new Set(profile.samples.map(s => s.labels.thread))],
    truncatedFrames: count("truncated_frames"),
    truncatedStrings: count("truncated_strings"),
    jsLocations: count("js_locations"),
    strings: count("strings"),
    stacks: count("stacks"),
    stackWords: count("stack_words"),
    otherStacksBytes: count("other_stacks_bytes"),
    otherStacksObjects: count("other_stacks_objects"),
  };
}

const kept: Uint8Array[] = [];
Bun.pprof.heap.start({ sampleInterval: 64 * KiB });
for (const allocate of allocators.slice(0, 32)) kept.push(allocate(each));
const first = summary(decode(Bun.pprof.heap.profile()));
for (const allocate of allocators.slice(32)) kept.push(allocate(each));
const second = summary(decode(Bun.pprof.heap.stop()));
console.log(JSON.stringify({ allocatedEachHalf: 32 * each, kept: kept.length, first, second }));
