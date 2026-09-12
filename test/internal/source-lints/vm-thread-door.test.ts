// The door out of a VM's thread (src/jsc/VmHandle.rs).
//
// A `VirtualMachine` is destroyed only after everything that left its thread
// has come back: work that runs on, or is referenced from, another thread on a
// VM's behalf holds a `bun_jsc::Ticket`, and the VM's teardown waits for every
// ticket. That is only a guarantee if there is no way *around* the door, so
// this lint freezes, for the VM crates (`jsc`, `runtime`, `event_loop`,
// `sql_jsc`, `http_jsc`), the two things that could open one:
//
//   1. `unsafe impl Send` / `unsafe impl Sync`, the `owned_task!` macro
//      (which emits one) and `intrusive_work_task!` (which is what makes a
//      type schedulable on the pool). `VirtualMachine`,
//      `EventLoop` and `JSGlobalObject` are `!Send + !Sync`, so VM state can
//      only reach another thread inside a type someone declared `Send` by hand.
//      Every such type must either carry a `Ticket` for the VM whose state it
//      holds, or hold no VM/JS state at all.
//   2. Direct calls to the raw thread-crossing primitives — the work pool, the
//      HTTP thread, thread spawning, `uv_queue_work`. VM code reaches these
//      through `bun_jsc::Job` or through a struct that holds a `Ticket` for
//      its in-flight duration; a new direct call site is a new path that has
//      to be shown to do the same.
//
// Each door is a query over the parsed Rust AST (scripts/rust-parser): the
// `Impl` items that declare a marker trait, the task macros' invocations, the
// paths and calls that name a primitive. Comments and string literals are
// never matched; rustfmt wrapping and qualified paths (`core::marker::Send`,
// `bun_threading::WorkPool::schedule`) are. A `macro_rules!` body is a token
// tree: only the marker impls are looked for in there, by token sequence.
//
// If this fails because you ADDED one: make the payload carry a `Ticket`
// (taken on the JS thread with `vm.ticket()`, dropped after the completion is
// posted) or show it is VM-free, say so in a `// SAFETY:` comment, then
// regenerate the inventory:
//   bun ./test/internal/source-lints/vm-thread-door.test.ts --update
// If it fails because you REMOVED one: regenerate the same way.

import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  flattenTokenTrees,
  parseRustFragment,
  pathEndsWith,
  unwrapParens,
  type Call,
  type Macro,
  type MethodCall,
  type Path,
  type RustFile,
  type TokenTree,
} from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

const INVENTORY = import.meta.dir + "/vm-thread-door.inventory.json";

const SCOPED = ["src/jsc/", "src/runtime/", "src/event_loop/", "src/sql_jsc/", "src/http_jsc/"];
// The door itself.
const DOOR = ["src/jsc/VmHandle.rs", "src/jsc/job.rs"];

/**
 * The self types of every `unsafe impl Send for T` / `unsafe impl Sync for T`,
 * as written: the `Impl` items of the tree, plus the ones spelled inside a
 * `macro_rules!` body (a token tree, not an item), where the same words open
 * the same door once the macro is expanded (`extern_crypto_job!` in
 * src/runtime/node/node_crypto_binding.rs).
 */
function unsafeMarkerImpls(file: RustFile, marker: "Send" | "Sync"): string[] {
  const out: string[] = [];
  for (const impl of file.find("Impl")) {
    if (!impl.unsafe || impl.trait === null || !pathEndsWith(impl.trait, marker)) continue;
    out.push(file.text(impl.selfTy).replace(/\s+/g, " "));
  }
  for (const rules of file.find("MacroRules")) out.push(...markerImplsInTokens(file, rules.tokens, marker));
  return out;
}

/** `unsafe impl [<generics>] [path::]Send for T [where ...] {` in a token tree: T as written. */
function markerImplsInTokens(file: RustFile, trees: TokenTree[], marker: "Send" | "Sync"): string[] {
  const out: string[] = [];
  const tokens = flattenTokenTrees(trees, trees.length > 0 ? trees[trees.length - 1].end : 0);
  const isIdent = (i: number, text: string) => tokens[i].kind === "ident" && tokens[i].text === text;
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (!isIdent(i, "unsafe") || !isIdent(i + 1, "impl")) continue;
    let j = i + 2;
    // Generic parameters.
    if (tokens[j].text === "<") {
      let depth = 0;
      do {
        if (tokens[j].text === "<") depth++;
        else if (tokens[j].text === ">") depth--;
        j++;
      } while (depth > 0 && j < tokens.length);
      if (j >= tokens.length) break;
    }
    // The trait path, possibly qualified.
    if (tokens[j].text === ":" && tokens[j + 1].text === ":") j += 2;
    while (tokens[j].kind === "ident" && tokens[j + 1].text === ":" && tokens[j + 2].text === ":") j += 3;
    if (!isIdent(j, marker) || !isIdent(j + 1, "for")) continue;
    j += 2;
    const start = tokens[j].start;
    let k = j;
    while (
      k < tokens.length &&
      !(tokens[k].kind === "open" && tokens[k].text === "{") &&
      !isIdent(k, "where") &&
      tokens[k].kind !== "eof"
    )
      k++;
    if (k === j) continue;
    out.push(file.source.slice(start, tokens[k - 1].end).replace(/\s+/g, " "));
  }
  return out;
}

/**
 * The task type of every `name!(Ty, field)` / `name!([generics] Ty, field)`
 * invocation: the tokens before the first comma, the `[generics]` group
 * skipped. The text match this replaced only read a leading identifier, so it
 * never saw the generic form (`owned_task!([const IS_SHELL: bool]
 * CpSingleTask<IS_SHELL>, task)`), which emits the same `unsafe impl Send`.
 */
function taskMacros(file: RustFile, name: string): string[] {
  return file
    .find("Macro")
    .filter(mac => pathEndsWith(mac.path, name))
    .map(mac => taskType(file, mac));
}

function taskType(file: RustFile, mac: Macro): string {
  const tokens = mac.tokens;
  const first = tokens[0];
  const from = first !== undefined && first.kind === "group" && first.delim === "[" ? 1 : 0;
  let to = from;
  for (; to < tokens.length; to++) {
    const token = tokens[to];
    if (token.kind === "punct" && token.text === ",") break;
  }
  if (to === from) return file.text(mac).replace(/\s+/g, " ");
  return file.source.slice(tokens[from].start, tokens[to - 1].end).replace(/\s+/g, " ");
}

// The work pool's entry points. Every path that names one counts, not only
// callees: `WorkPool::schedule` handed around as a value is the same door.
const WORK_POOL_ENTRY = ["WorkPool::schedule", "WorkPool::schedule_new", "WorkPool::schedule_owned", "WorkPool::go"];

function workPoolEntries(file: RustFile): Path[] {
  return file.find("Path").filter(p => WORK_POOL_ENTRY.some(name => pathEndsWith(p, name)));
}

/** `<pool-from-a-call>.schedule(Batch::from(...))`. */
function batchSchedules(file: RustFile): MethodCall[] {
  return file.find("MethodCall").filter(call => {
    if (call.method !== "schedule" || call.args.length === 0) return false;
    const pool = unwrapParens(call.receiver);
    if (pool.kind !== "Call" && pool.kind !== "MethodCall") return false;
    const batch = unwrapParens(call.args[0]);
    return batch.kind === "Call" && pathEndsWith(batch.callee, "Batch::from");
  });
}

/** Calls whose callee path ends with one of `names` (`std::thread::spawn`, `uv::uv_queue_work`). */
function callsTo(file: RustFile, names: readonly string[]): Call[] {
  return file.find("Call").filter(call => names.some(name => pathEndsWith(unwrapParens(call.callee), name)));
}

// Inventory keys. A query that yields names (the marker impls' self types,
// the task macros' types) is recorded as a sorted list; the others as a count.
const PATTERNS: [name: string, query: (file: RustFile) => string[] | number][] = [
  ["unsafe impl Send", file => unsafeMarkerImpls(file, "Send")],
  ["unsafe impl Sync", file => unsafeMarkerImpls(file, "Sync")],
  ["owned_task!", file => taskMacros(file, "owned_task")],
  ["intrusive_work_task!", file => taskMacros(file, "intrusive_work_task")],
  ["WorkPool::schedule*", file => workPoolEntries(file).length],
  ["worker_pool.schedule(Batch)", file => batchSchedules(file).length],
  ["HTTPThread::schedule", file => callsTo(file, ["HTTPThread::schedule"]).length],
  ["thread spawn", file => callsTo(file, ["thread::spawn", "thread::Builder::new"]).length],
  ["uv_queue_work", file => callsTo(file, ["uv_queue_work"]).length],
];

type Inventory = Record<string, Record<string, string[] | number>>;
const found: Inventory = {};

const sources = rustSources({ scope: SCOPED, exclude: DOOR });
for (const src of sources) {
  for (const [name, query] of PATTERNS) {
    const result = query(src.file);
    if (Array.isArray(result) ? result.length === 0 : result === 0) continue;
    (found[src.path] ??= {})[name] = Array.isArray(result) ? result.sort() : result;
  }
}

const sortKeys = <T>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const normalized: Inventory = sortKeys(Object.fromEntries(Object.entries(found).map(([k, v]) => [k, sortKeys(v)])));

if (process.argv.includes("--update")) {
  await Bun.write(INVENTORY, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(normalized).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await Bun.file(INVENTORY).json();

describe("VM thread door", () => {
  test("scans a non-empty set of tracked Rust sources", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  test("the queries recognize the spellings they claim to", () => {
    const hits = (name: string, snippet: string) => {
      const [, query] = PATTERNS.find(([n]) => n === name)!;
      return query(parseRustFragment(snippet));
    };
    const isEmpty = (result: string[] | number) => (Array.isArray(result) ? result.length === 0 : result === 0);
    const banned: [name: string, snippet: string, expected: string[] | number][] = [
      ["unsafe impl Send", "unsafe impl Send for ThreadStart {}", ["ThreadStart"]],
      ["unsafe impl Send", "unsafe impl<T> Send for SendPtr<T> {}", ["SendPtr<T>"]],
      ["unsafe impl Send", "unsafe impl<T> core::marker::Send for Queue<T> where T: Send {}", ["Queue<T>"]],
      // rustfmt-wrapped.
      [
        "unsafe impl Send",
        "unsafe impl<R: FsReturn, A: ThreadIsolatedArg, const F: NodeFSFunctionEnum> Send\n    for AsyncFSTask<R, A, F>\n{\n}",
        ["AsyncFSTask<R, A, F>"],
      ],
      ["unsafe impl Sync", "unsafe impl Sync for JsPoster {}", ["JsPoster"]],
      // Inside a macro template.
      [
        "unsafe impl Send",
        "macro_rules! job { ($n:ident) => { struct OwnedCtx(*mut $n); unsafe impl Send for OwnedCtx {} }; }",
        ["OwnedCtx"],
      ],
      [
        "unsafe impl Sync",
        "macro_rules! m { () => { unsafe impl<T: 'static> ::core::marker::Sync for Cell<T> where T: Send {} }; }",
        ["Cell<T>"],
      ],
      ["owned_task!", "bun_threading::owned_task!(AsyncMkdirp, task);", ["AsyncMkdirp"]],
      ["owned_task!", "owned_task!([const IS_SHELL: bool] CpSingleTask<IS_SHELL>, task);", ["CpSingleTask<IS_SHELL>"]],
      ["intrusive_work_task!", "bun_threading::intrusive_work_task!(ReadFile, task);", ["ReadFile"]],
      ["WorkPool::schedule*", "WorkPool::schedule(&mut self.task);", 1],
      ["WorkPool::schedule*", "bun_threading::WorkPool::schedule_new(task);", 1],
      ["WorkPool::schedule*", "let go: fn(&mut Task) = WorkPool::go;", 1],
      ["worker_pool.schedule(Batch)", "vm.worker_pool().schedule(Batch::from(&mut self.task));", 1],
      ["worker_pool.schedule(Batch)", "pool().schedule(bun_threading::thread_pool::Batch::from(task));", 1],
      ["HTTPThread::schedule", "HTTPThread::schedule(&mut self.http);", 1],
      ["thread spawn", "std::thread::spawn(move || run(ctx));", 1],
      ["thread spawn", 'thread::Builder::new().name("watcher".into()).spawn(f);', 1],
      ["uv_queue_work", "unsafe { uv::uv_queue_work(loop_, req, work_cb, after_cb) };", 1],
    ];
    const allowed: [name: string, snippet: string][] = [
      // A safe impl is the compiler's business, a negative one closes the door.
      ["unsafe impl Send", "impl Send for Plain {}"],
      ["unsafe impl Send", "impl !Send for VirtualMachine {}"],
      ["unsafe impl Send", "unsafe impl Sync for OnlySync {}"],
      ["unsafe impl Sync", "unsafe impl Send for OnlySend {}"],
      ["owned_task!", "intrusive_work_task!(ReadFile, task);"],
      ["WorkPool::schedule*", "self.pool.schedule(task);"],
      ["WorkPool::schedule*", "WorkPool::scheduled_count();"],
      ["worker_pool.schedule(Batch)", "vm.worker_pool().schedule(task);"],
      ["worker_pool.schedule(Batch)", "bun.worker_pool.schedule(Batch::from(task));"],
      ["thread spawn", "tokio::spawn(fut);"],
      // The declaration is not a call.
      ["uv_queue_work", 'extern "C" {\n    fn uv_queue_work(l: *mut uv_loop_t, r: *mut uv_work_t) -> c_int;\n}'],
      // Prose about a door is not a door.
      ["unsafe impl Send", "// unsafe impl Send for Ghost {}"],
      ["thread spawn", 'log("std::thread::spawn(...)");'],
      ["WorkPool::schedule*", "macro_rules! m { () => { WorkPool::schedule(t) }; }"],
    ];
    expect(banned.map(([name, snippet]) => hits(name, snippet))).toEqual(banned.map(([, , expected]) => expected));
    expect(allowed.filter(([name, snippet]) => !isEmpty(hits(name, snippet)))).toEqual([]);
  });

  const files = [...new Set([...Object.keys(inventory), ...Object.keys(normalized)])].sort();
  test.each(files)("%s", source => {
    const expected = inventory[source] ?? {};
    const actual = normalized[source] ?? {};
    if (!Bun.deepEquals(actual, expected)) {
      throw new Error(
        `${source}: thread-crossing inventory changed.\n` +
          `  expected: ${JSON.stringify(expected)}\n` +
          `  actual:   ${JSON.stringify(actual)}\n` +
          `A new \`unsafe impl Send/Sync\` or a new direct call to a thread-crossing primitive in a VM crate ` +
          `must carry a \`bun_jsc::Ticket\` for the VM whose state it holds (or hold none) — see src/jsc/VmHandle.rs. ` +
          `Then regenerate: bun ./test/internal/source-lints/vm-thread-door.test.ts --update`,
      );
    }
  });

  test("VirtualMachine stays !Send + !Sync", () => {
    const [vm] = rustSources({ scope: ["src/jsc/VirtualMachine.rs"] });
    expect(vm).toBeDefined();
    const markers = [...unsafeMarkerImpls(vm.file, "Send"), ...unsafeMarkerImpls(vm.file, "Sync")];
    expect(markers).not.toContain("VirtualMachine");
    expect(vm.text).toContain("<VirtualMachine as AmbiguousIfImpl<_>>::some_item");
  });
});
