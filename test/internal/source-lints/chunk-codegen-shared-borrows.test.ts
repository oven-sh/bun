import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

// The chunk codegen fan-out in generateChunksInParallel.rs schedules one
// thread-pool task per part range of every chunk and runs all of them at once
// against the single LinkerContext and, per chunk, the single Chunk. Each task
// is handed the same raw `c_ptr` / `chunk_ptr` by `pending_part_range_prologue`;
// its only writes are its own `compile_results_for_chunk[i]` slot (through the
// raw pointer in `Chunk::write_compile_result_slot`) and atomic counters.
//
// A task that turns its raw pointer into `&mut LinkerContext` or `&mut Chunk`
// claims exclusive access to memory every peer task is reading at that moment.
// That is aliasing UB even while the writes stay disjoint, and rustc cannot see
// it: the tasks reach the pointers through `unsafe impl Send/Sync` types. It
// also has no runtime symptom today, which is why this is checked by grep. The
// JS callback did exactly this (the CSS and HTML callbacks already took `&`);
// now all three form shared borrows and the code they call takes `&` too, so
// reintroducing `&mut` in a callback is the only way to get it back.
//
// `GenerateChunkCtx::c()` hands out `&mut LinkerContext` for the per-chunk
// post-process tasks (postProcess*Chunk.rs); it must not be used from these
// fan-out callbacks either.

const root = path.resolve(import.meta.dir, "..", "..", "..");

const FAN_OUT_CALLBACKS = [
  "src/bundler/linker_context/generateCompileResultForJSChunk.rs",
  "src/bundler/linker_context/generateCompileResultForCssChunk.rs",
  "src/bundler/linker_context/generateCompileResultForHtmlChunk.rs",
];

const EXCLUSIVE_BORROWS: RegExp[] = [
  /&mut\s+\*\s*c_ptr\b/,
  /&mut\s+\*\s*chunk_ptr\b/,
  /&mut\s+LinkerContext\b/,
  /&mut\s+Chunk\b/,
  /\.c\(\)/,
  /\.assume_mut\(\)/,
];

const sources = new Map<string, string>();
for (const source of FAN_OUT_CALLBACKS) {
  const content = await file(path.join(root, source)).text();
  // Blank out full-line comments (the CONCURRENCY notes in these files describe
  // the borrows they must not form) without changing line numbers.
  sources.set(source, content.replace(/^[ \t]*\/\/.*$/gm, ""));
}

test("every fan-out callback still publishes through the raw slot writer", () => {
  // Anchors the list above to the code it is meant to cover: a callback that
  // moves or stops using the slot writer has to update this lint.
  for (const stripped of sources.values()) {
    expect(stripped).toContain("Chunk::write_compile_result_slot(");
  }
});

test("fan-out callbacks never form &mut LinkerContext or &mut Chunk", () => {
  const offenders: string[] = [];
  for (const [source, stripped] of sources) {
    stripped.split("\n").forEach((line, i) => {
      if (EXCLUSIVE_BORROWS.some(re => re.test(line))) {
        offenders.push(`${source}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});
