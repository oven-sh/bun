import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

// generateChunksInParallel.rs runs two passes of thread-pool tasks against the
// single LinkerContext, all tasks of a pass at once:
//
// - The codegen fan-out: one task per part range of every chunk. Every task of
//   a chunk reads through the same `&LinkerContext` / `&Chunk`, which
//   `pending_part_range_prologue` (LinkerContext.rs) hands out; a task's only
//   writes are its own `compile_results_for_chunk` slot (an UnsafeCell, written
//   through that shared borrow by `CompileResultSlots::write`) and atomic
//   counters.
// - Post-processing: one task per chunk (`LinkerContext::generate_chunk`). A
//   task owns the chunk `each_ptr` hands it and writes it freely; everything
//   else reaches it through `PostProcessChunkCtx`, which holds the linker as a
//   plain `&LinkerContext` (so the owner cannot write to it between building
//   the ctx and running the pass either) plus a copy of the one thing a task
//   needs from the other chunks, which are being written by their own tasks.
//
// A task that forms `&mut LinkerContext` (or, in the fan-out, `&mut Chunk`)
// claims exclusive access to memory every peer task is reading at that moment.
// That is aliasing UB even while the writes stay disjoint, rustc cannot see it
// (the tasks reach the objects through `unsafe impl Send/Sync` types or raw
// pointers), and it has no runtime symptom, which is why it is checked by grep.
// Both passes used to do exactly this. Now the prologue and the ctx only offer
// shared borrows and everything the callbacks call takes `&`, so the ways back
// are changing those two hand-out points (checked against their source below)
// or laundering a shared borrow back into a `*mut` / `&mut` inside a callback
// (checked by grepping the callbacks).

const root = path.resolve(import.meta.dir, "..", "..", "..");
const linkerContextDir = "src/bundler/linker_context";

const FAN_OUT_CALLBACKS = [
  `${linkerContextDir}/generateCompileResultForCssChunk.rs`,
  `${linkerContextDir}/generateCompileResultForHtmlChunk.rs`,
  `${linkerContextDir}/generateCompileResultForJSChunk.rs`,
];

const POST_PROCESS_CALLBACKS = [
  `${linkerContextDir}/postProcessCSSChunk.rs`,
  `${linkerContextDir}/postProcessHTMLChunk.rs`,
  `${linkerContextDir}/postProcessJSChunk.rs`,
];

const LAUNDERING: RegExp[] = [/\.assume_mut\(/, /\.as_mut_ptr\(/, /\.cast_mut\(/, /\bas\s+\*\s*mut\b/];

const FAN_OUT_EXCLUSIVE_ACCESS: RegExp[] = [/&mut\s+LinkerContext\b/, /&mut\s+Chunk\b/, ...LAUNDERING];

// A post-process task is handed its chunk as `&mut Chunk`; only the linker is shared.
const POST_PROCESS_EXCLUSIVE_ACCESS: RegExp[] = [/&mut\s+LinkerContext\b/, ...LAUNDERING];

// Blank out full-line comments (the CONCURRENCY notes in these files describe
// the borrows they must not form) without changing line numbers.
const stripComments = (content: string) => content.replace(/^[ \t]*\/\/.*$/gm, "");

const linkerContextSources = new Map<string, string>();
for (const relative of new Bun.Glob(`${linkerContextDir}/*.rs`).scanSync({ cwd: root })) {
  const source = relative.replaceAll(path.sep, "/");
  linkerContextSources.set(source, stripComments(await file(path.join(root, source)).text()));
}
const linkerContext = stripComments(await file(path.join(root, "src/bundler/LinkerContext.rs")).text());

// Callbacks are found by how they receive their context, so a new one is linted
// automatically; the lists above keep this file's header honest, and keep the
// greps from passing vacuously should the hand-out points get renamed.
const sourcesUsing = (marker: RegExp) =>
  [...linkerContextSources.keys()].filter(source => marker.test(linkerContextSources.get(source)!)).sort();
const fanOutCallbacks = sourcesUsing(/\bpending_part_range_prologue\(/);
const postProcessCallbacks = sourcesUsing(/\bctx:\s*&PostProcessChunkCtx\b/);

function offenders(listed: string[], found: string[], patterns: RegExp[]): string[] {
  const lines: string[] = [];
  for (const source of new Set([...listed, ...found])) {
    linkerContextSources
      .get(source)!
      .split("\n")
      .forEach((line, i) => {
        if (patterns.some(re => re.test(line))) lines.push(`${source}:${i + 1}: ${line.trim()}`);
      });
  }
  return lines;
}

test("the prologue hands the fan-out callbacks shared borrows", () => {
  const signature = /fn pending_part_range_prologue<'a>\([\s\S]*?\)\s*->\s*\(([\s\S]*?)\)\s*\{/.exec(linkerContext);
  expect(signature).not.toBeNull();
  const returns = signature![1].replace(/\s+/g, " ");
  expect(returns).toContain("&'a LinkerContext<'a>,");
  expect(returns).toContain("&'a Chunk,");
  expect(returns).not.toContain("*mut");
});

test("every fan-out callback is covered", () => {
  expect(fanOutCallbacks).toEqual(FAN_OUT_CALLBACKS);
});

test("fan-out callbacks never take exclusive access to the LinkerContext or a Chunk", () => {
  expect(offenders(FAN_OUT_CALLBACKS, fanOutCallbacks, FAN_OUT_EXCLUSIVE_ACCESS)).toEqual([]);
});

test("the post-process ctx holds the linker as a shared borrow and no view of the chunks", () => {
  const struct = /\npub\(crate\) struct PostProcessChunkCtx<'c, 'a> \{\n([\s\S]*?)\n\}/.exec(linkerContext);
  expect(struct).not.toBeNull();
  const fields = struct![1]
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  expect(fields).toEqual([
    "pub(crate) c: &'c LinkerContext<'a>,",
    "pub(crate) chunk_unique_keys: &'c [&'static [u8]],",
  ]);

  // Its methods must not be a way to get more than the fields give.
  const impls = [...linkerContext.matchAll(/\nimpl(?:<[^>]*>)? PostProcessChunkCtx<[^>]*> \{\n([\s\S]*?)\n\}/g)];
  expect(impls.length).toBeGreaterThan(0);
  for (const [, body] of impls) {
    expect(body).not.toMatch(/\bmut\b|\bunsafe\b/);
  }
});

test("the post-process pass runs through that ctx", () => {
  const signature = /fn generate_chunk\(([^)]*)\)/.exec(linkerContext);
  expect(signature).not.toBeNull();
  const params = signature![1].replace(/\s+/g, " ").replace(/,? $/, "").trim();
  expect(params).toBe("ctx: &PostProcessChunkCtx, chunk: *mut Chunk, chunk_index: usize");
});

test("every post-process callback is covered", () => {
  expect(postProcessCallbacks).toEqual(POST_PROCESS_CALLBACKS);
});

test("post-process callbacks never take exclusive access to the LinkerContext", () => {
  expect(offenders(POST_PROCESS_CALLBACKS, postProcessCallbacks, POST_PROCESS_EXCLUSIVE_ACCESS)).toEqual([]);
});
