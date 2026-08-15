import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

// The chunk codegen fan-out in generateChunksInParallel.rs schedules one
// thread-pool task per part range of every chunk and runs all of them at once
// against the single LinkerContext and, per chunk, the single Chunk. Every task
// of a chunk therefore reads through the same `&LinkerContext` / `&Chunk`,
// which `pending_part_range_prologue` (LinkerContext.rs) hands out; a task's
// only writes are its own `compile_results_for_chunk` slot (an UnsafeCell,
// written through that shared borrow by `CompileResultSlots::write`) and
// atomic counters.
//
// A task that forms `&mut LinkerContext` or `&mut Chunk` instead claims
// exclusive access to memory every peer task is reading at that moment. That is
// aliasing UB even while the writes stay disjoint, rustc cannot see it (the
// tasks reach the objects through `unsafe impl Send/Sync` types), and it has no
// runtime symptom, which is why it is checked by grep. The JS callback used to
// do exactly this. Now the prologue only offers shared borrows and everything
// the callbacks call takes `&`, so the two ways back are changing the prologue
// or reaching past it: `GenerateChunkCtx::c()` / `ParentRef::assume_mut` /
// `as_mut_ptr` (which exist for the per-chunk post-process tasks in
// postProcess*Chunk.rs) or casting the shared borrow back to a raw `*mut`.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const linkerContextDir = "src/bundler/linker_context";

const FAN_OUT_CALLBACKS = [
  `${linkerContextDir}/generateCompileResultForCssChunk.rs`,
  `${linkerContextDir}/generateCompileResultForHtmlChunk.rs`,
  `${linkerContextDir}/generateCompileResultForJSChunk.rs`,
];

const EXCLUSIVE_ACCESS: RegExp[] = [
  /&mut\s+LinkerContext\b/,
  /&mut\s+Chunk\b/,
  /\.c\(\)/,
  /\.assume_mut\(/,
  /\.as_mut_ptr\(/,
  /\.cast_mut\(/,
  /\bas\s+\*\s*mut\b/,
];

// Blank out full-line comments (the CONCURRENCY notes in these files describe
// the borrows they must not form) without changing line numbers.
const stripComments = (content: string) => content.replace(/^[ \t]*\/\/.*$/gm, "");

const callbackSources = new Map<string, string>();
for (const relative of new Bun.Glob(`${linkerContextDir}/*.rs`).scanSync({ cwd: root })) {
  const source = relative.replaceAll(path.sep, "/");
  const stripped = stripComments(await file(path.join(root, source)).text());
  if (stripped.includes("pending_part_range_prologue(")) callbackSources.set(source, stripped);
}

test("the prologue hands the fan-out callbacks shared borrows", async () => {
  const linkerContext = stripComments(await file(path.join(root, "src/bundler/LinkerContext.rs")).text());
  const signature = /fn pending_part_range_prologue<'a>\([\s\S]*?\)\s*->\s*\(([\s\S]*?)\)\s*\{/.exec(linkerContext);
  expect(signature).not.toBeNull();
  const returns = signature![1].replace(/\s+/g, " ");
  expect(returns).toContain("&'a LinkerContext<'a>,");
  expect(returns).toContain("&'a Chunk,");
  expect(returns).not.toContain("*mut");
});

test("every fan-out callback is covered", () => {
  // The callbacks are found by their use of the prologue, so a new one is
  // linted automatically; this just keeps the list in the header honest.
  expect([...callbackSources.keys()].sort()).toEqual(FAN_OUT_CALLBACKS);
});

test("fan-out callbacks never take exclusive access to the LinkerContext or a Chunk", () => {
  const offenders: string[] = [];
  for (const [source, stripped] of callbackSources) {
    stripped.split("\n").forEach((line, i) => {
      if (EXCLUSIVE_ACCESS.some(re => re.test(line))) {
        offenders.push(`${source}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});
