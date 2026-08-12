import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `ThreadPool` in src/threading/ThreadPool.rs is the owner's handle to a pool;
// the state the workers write to lives in `ThreadPoolInner`, behind an `Arc`
// that every worker holds as well. It used to live inline in `ThreadPool`, so
// `Drop for ThreadPool` (which shuts the workers down and waits for them) and
// every `&mut self` method of a struct embedding a pool by value held a
// protected `&mut` over memory the workers were writing into at that moment,
// which both Stacked Borrows and Tree Borrows (the model `bun run rust:miri`
// uses) reject; atomics do not change that. The layout half of the invariant
// is pinned at compile time by the `const _` size assertion under the struct;
// this pins it by name, so what the workers write to is listed in one place and
// moving any of it back into the handle (or renaming it) has to come past here.
//
// Sibling guards: self-receiver-reclaim.test.ts, fn-long-mut-reborrow.test.ts.

const SOURCE = "src/threading/ThreadPool.rs";

// Fields of `ThreadPoolInner` that worker threads write to while the pool runs.
const WORKER_WRITTEN_FIELDS = [
  "sync",
  "idle_event",
  "join_event",
  "run_queue",
  "threads",
  "wait_group",
  "is_running",
  "stats",
];

/** Names of the fields declared in the body of `struct <name>` ("" body for a unit or tuple struct). */
function declaredFields(source: string, name: string): string[] {
  const text = source.replace(/^[ \t]*\/\/.*$/gm, "");
  const def = new RegExp(String.raw`^[ \t]*(?:pub(?:\([^)]*\))?\s+)?struct\s+${name}\b[^{;]*`, "m").exec(text);
  if (def === null) throw new Error(`${SOURCE}: no struct ${name}`);
  const open = def.index + def[0].length;
  if (text[open] !== "{") return [];
  let depth = 0;
  let close = open;
  while (close < text.length && (text[close] !== "}" || --depth !== 0)) {
    if (text[close] === "{") depth++;
    close++;
  }
  const body = text.slice(open + 1, close);
  return [...body.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(\w+)[ \t]*:/gm)].map(m => m[1]);
}

const source = readFileSync(path.resolve(import.meta.dir, "..", "..", "..", SOURCE), "utf8");

test("declaredFields reads struct bodies the way the checks below assume", () => {
  // The previous shape of `ThreadPool`: comments and visibility are ignored,
  // and a struct defined later in the file does not bleed into the result.
  const previous = [
    "pub struct ThreadPool {",
    "    /// Docs mentioning other: Thing, do not count.",
    "    pub(crate) max_threads: u32, // trailing comment",
    "    sync: AtomicSync,",
    "    stats: PoolStats {",
    "    },",
    "}",
    "struct ThreadRegistration<'a> {",
    "    pool: &'a ThreadPoolInner,",
    "}",
    "pub struct Handle(Arc<Inner>);",
    "",
  ].join("\n");
  expect(declaredFields(previous, "ThreadPool")).toEqual(["max_threads", "sync", "stats"]);
  expect(declaredFields(previous, "ThreadRegistration")).toEqual(["pool"]);
  expect(declaredFields(previous, "Handle")).toEqual([]);
  expect(() => declaredFields(previous, "Gone")).toThrow("no struct Gone");
});

test("ThreadPoolInner still declares everything this lint lists", () => {
  expect(declaredFields(source, "ThreadPoolInner")).toEqual(expect.arrayContaining(WORKER_WRITTEN_FIELDS));
});

test("the ThreadPool handle holds nothing the workers write to", () => {
  const inline = declaredFields(source, "ThreadPool").filter(f => WORKER_WRITTEN_FIELDS.includes(f));
  expect(inline).toEqual([]);
});
