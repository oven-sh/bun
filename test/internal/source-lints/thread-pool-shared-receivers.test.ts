import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The work-stealing pool in src/threading/ThreadPool.rs keeps each worker's
// `Thread` on that worker's stack and publishes a raw pointer to it
// (`ThreadPool::register`, the `CURRENT` thread-local, the bundler's
// `Worker.thread`). For as long as the worker runs, other threads go through
// that pointer: stealers read `next` and drain `run_queue` / `run_buffer`,
// `push_idle_task` pushes into `idle_queue`, and the join chain fires
// `join_event`. The queues are atomics, so there is no data race, but a
// `&mut self` method on any of these types forms a `&mut` over the whole
// struct, protected for the duration of the call, and a stealer's CAS landing
// anywhere in it while the call is in progress is UB under Tree Borrows (under
// Stacked Borrows even its loads are), whether or not the method itself touches
// that field. `Thread::pop` had exactly that shape: it wanted `&mut` for its
// private steal cursor while the other workers were stealing from the same
// `Thread`; the cursor is a `Cell` now.
//
// So the types a published `Thread` pointer leads to (`Thread` itself, its
// `Event`, and `node::Queue` / `node::Buffer`) take `&self` everywhere;
// owner-private state goes in a `Cell`. Only inherent impls are checked: the
// one trait receiver that is `&mut self` by language rule (`Drop`) runs after
// the join chain, when nothing else can reach the value. `ThreadPool` is
// reached the same way and is all `&self` too, but is not pinned here: a
// `&mut self` setter that runs before the first worker exists would be
// legitimate for it.
//
// Sibling guards: fn-long-mut-reborrow.test.ts (the same aliasing, formed on
// the owning thread by re-entrant callbacks), self-receiver-reclaim.test.ts.

const SOURCE = "src/threading/ThreadPool.rs";
const SHARED_TYPES = ["Thread", "Event", "Queue", "Buffer"] as const;

// `impl Thread {` at any indentation (`Queue` / `Buffer` live in `pub mod
// node`). `\s*\{` right after the name keeps trait impls (`impl Default for
// Event`, `unsafe impl Sync for Queue`) out; none of these impls is generic.
const INHERENT_IMPL = new RegExp(String.raw`^[ \t]*impl\s+(${SHARED_TYPES.join("|")})\s*\{`, "gm");

// `fn name(` followed by the first parameter, which for a method is the
// receiver. `[^,)]*` stops at the end of that parameter but lets it span the
// line break rustfmt inserts in a wrapped signature. Generic parameter lists
// may nest one level (`<T: Into<Batch>>`). Fn-pointer types
// (`unsafe fn(*mut Task)`) have no name and do not match.
const FN_FIRST_PARAM = /\bfn\s+(\w+)\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*([^,)]*)/g;
const RECEIVER = /^(?:&\s*(?:'\w+\s+)?(?:mut\s+)?self\b|(?:mut\s+)?self\b)/;
// `&mut self`, `&'a mut self`, `self: &mut Self`, `self: Pin<&mut Self>`, ...
const EXCLUSIVE_RECEIVER = /^(?:&\s*(?:'\w+\s+)?mut\s+self\b|(?:mut\s+)?self\s*:[^&]*&\s*(?:'\w+\s+)?mut\b)/;

function stripComments(source: string): string {
  // Full-line comments (including `///` docs) may talk about `&mut self`;
  // `[ \t]*` rather than `\s*` so blank lines survive and line numbers hold.
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Index just past the `}` matching the `{` at `open`. */
function blockEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  throw new Error(`unbalanced braces after offset ${open}`);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

type Method = { type: string; name: string; receiver: string; line: number };

/** Every receiver-taking method in the inherent impls of SHARED_TYPES. */
function receiverMethods(source: string): Method[] {
  const text = stripComments(source);
  const methods: Method[] = [];
  for (const impl of text.matchAll(INHERENT_IMPL)) {
    const open = impl.index + impl[0].length - 1;
    const body = text.slice(open, blockEnd(text, open));
    for (const fn of body.matchAll(FN_FIRST_PARAM)) {
      const receiver = fn[2].trim().replace(/\s+/g, " ");
      if (!RECEIVER.test(receiver)) continue;
      methods.push({ type: impl[1], name: fn[1], receiver, line: lineOf(text, open + fn.index) });
    }
  }
  return methods;
}

function exclusiveReceivers(source: string): string[] {
  return receiverMethods(source)
    .filter(m => EXCLUSIVE_RECEIVER.test(m.receiver))
    .map(m => `${SOURCE}:${m.line}: impl ${m.type}: fn ${m.name}(${m.receiver})`);
}

const source = readFileSync(path.resolve(import.meta.dir, "..", "..", "..", SOURCE), "utf8");

test("the patterns classify receivers the way they claim to", () => {
  const flagged = (body: string) => exclusiveReceivers(`impl Thread {\n${body}\n}\n`).length;
  expect(flagged("fn pop(&mut self, thread_pool: &ThreadPool) -> Option<node::Stole> {}")).toBe(1);
  expect(flagged("fn pop<'a>(&'a mut self) {}")).toBe(1);
  expect(flagged("fn push_all<T: Into<Batch>>(&mut self, batch: T) {}")).toBe(1);
  expect(flagged("fn pop(self: &mut Self) {}")).toBe(1);
  expect(flagged("fn pop(mut self: &mut Thread) {}")).toBe(1);
  expect(flagged("fn pop(self: Pin<&mut Self>) {}")).toBe(1);
  expect(flagged("fn pop(\n    &mut self,\n    thread_pool: &ThreadPool,\n) {}")).toBe(1);
  // Comments are stripped; a nested `unsafe extern` fn, a fn-pointer field
  // type and non-self `&mut` parameters are not receivers.
  expect(
    flagged(
      [
        "/// Once took `fn pop(&mut self)`.",
        "// fn old(&mut self) {}",
        "pub fn push_idle_task(&self, task: *mut Task) {}",
        "pub(super) fn push(&self, list: &mut List) -> Result<(), BufferPushError> {}",
        "fn with<'a>(&'a self) {}",
        "fn by_ref(self: &Self) {}",
        "fn by_value(self) {}",
        "fn current() -> *mut Thread {}",
        'fn run(thread_pool: bun_ptr::BackRef<ThreadPool>) { unsafe extern "C" { safe fn mi_thread_set_in_threadpool(); } }',
        "fn link(list: &mut List) {}",
        "const CB: unsafe fn(*mut Task) = cb;",
      ].join("\n"),
    ),
  ).toBe(0);
  // Trait impls are out of scope, and the impl-block scan must not leak past
  // the closing brace into a following item.
  expect(
    exclusiveReceivers(
      "impl Drop for Thread {\n    fn drop(&mut self) {}\n}\nimpl Event {\n    fn wait(&self) {}\n}\nimpl Consumer<'_> {\n    fn pop(&mut self) {}\n}\n",
    ),
  ).toEqual([]);
  expect(exclusiveReceivers("    impl Queue {\n        fn push(&mut self) {}\n    }\n")).toEqual([
    `${SOURCE}:2: impl Queue: fn push(&mut self)`,
  ]);
});

test(`${SOURCE} still defines the shared types this lint pins`, () => {
  // If one of these disappears the type was renamed or its impl restructured;
  // update SHARED_TYPES / INHERENT_IMPL rather than letting the ban below pass
  // on an empty set. `Thread::pop` is the method the ban exists for.
  const methods = receiverMethods(source);
  expect([...new Set(methods.map(m => m.type))].sort()).toEqual([...SHARED_TYPES].sort());
  expect(methods.filter(m => m.type === "Thread").map(m => m.name)).toContain("pop");
});

test("types reached through a published worker Thread pointer take &self", () => {
  expect(exclusiveReceivers(source)).toEqual([]);
});
