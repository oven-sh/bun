import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A worker's `Thread` in src/threading/ThreadPool.rs is published to the other
// workers (and to the bundler, via `Worker.thread`) the moment it registers,
// and they steal from it and push into it through that pointer for as long as
// it runs. A `&mut self` method on it, or on anything it leads to (`Event`,
// `node::Queue`, `node::Buffer`), is a protected
// `&mut` over the whole struct for the duration of the call, which a stealer's
// CAS landing anywhere in it makes UB under Tree Borrows (under Stacked Borrows
// even its loads do), whether or not the method touches that field.
// `Thread::pop` had that shape, wanting `&mut` for its private steal cursor;
// the cursor is a `Cell` now, and this pins every receiver on those types to
// `&self`.
//
// Scope: inherent impls only. The one trait receiver that is `&mut self` by
// language rule (`Drop`) runs after the join chain, when nothing else reaches
// the value. `ThreadPool` is reached the same way and is all `&self` too, but a
// `&mut self` setter that runs before the first worker exists would be
// legitimate for it, so it is not pinned. The scan fails closed: an impl block
// or fn header it cannot parse fails the lint instead of exempting the method.
//
// Sibling guards: fn-long-mut-reborrow.test.ts (the same aliasing, formed on
// the owning thread by re-entrant callbacks), self-receiver-reclaim.test.ts.

const SOURCE = "src/threading/ThreadPool.rs";
const SHARED_TYPES = ["Thread", "Event", "Queue", "Buffer"] as const;

// Header of an inherent impl of one of SHARED_TYPES, capturing its indentation
// (`Queue` / `Buffer` sit inside `pub mod node`). The type name has to follow
// `impl` directly (modulo generics and a module path), which is where a trait
// impl has its trait instead (`impl Default for Event`, `unsafe impl Sync for
// Queue`); `\b` keeps `impl ThreadPool` out. `[^{;]*` admits a `where` clause;
// rustfmt leaves the `{` last on its line.
const INHERENT_IMPL = new RegExp(
  String.raw`^([ \t]*)impl(?:<[^>]*>)?\s+(?:\w+::)*(${SHARED_TYPES.join("|")})\b[^{;]*\{[ \t]*$`,
  "gm",
);

// Every fn item in a block, and the anchored parse of its header up to the
// first parameter (the receiver, for a method). Generic lists may nest one
// level and contain `->` (`<F: FnMut(*mut Task) -> bool>`); anything the
// second pattern does not accept is reported, not skipped. Fn-pointer types
// (`unsafe fn(*mut Task)`) have no name and are not items.
const FN_ITEM = /\bfn\s+(?:r#)?\w+/g;
const FN_HEADER = /fn\s+((?:r#)?\w+)\s*(?:<(?:->|[^<>]|<(?:->|[^<>])*>)*>)?\s*\(\s*([^,)]*)/y;
const RECEIVER = /^(?:&\s*(?:'\w+\s+)?(?:mut\s+)?self\b|(?:mut\s+)?self\b)/;
// `&mut self`, `&'a mut self`, `self: &mut Self`, `self: Pin<&mut Self>`, ...
const EXCLUSIVE_RECEIVER = /^(?:&\s*(?:'\w+\s+)?mut\s+self\b|(?:mut\s+)?self\s*:[^&]*&\s*(?:'\w+\s+)?mut\b)/;

function stripComments(source: string): string {
  // Full-line comments (including `///` docs) may talk about `&mut self`;
  // `[ \t]*` rather than `\s*` so blank lines survive and line numbers hold.
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
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
    const [header, indent, type] = impl;
    const label = `impl ${type} at ${SOURCE}:${lineOf(text, impl.index)}`;
    const start = impl.index + header.length;
    // rustfmt puts an impl's closing brace alone on a line at the header's
    // indentation, and nothing inside the block at that indentation, so the
    // block ends at the first such line. Immune to braces in string literals.
    const end = text.indexOf(`\n${indent}}`, start);
    if (end === -1) throw new Error(`${label}: no closing brace at its indentation`);
    const body = text.slice(start, end);
    for (const item of body.matchAll(FN_ITEM)) {
      FN_HEADER.lastIndex = item.index;
      const parsed = FN_HEADER.exec(body);
      if (parsed === null) {
        const line = body.slice(item.index).split("\n", 1)[0].trim();
        throw new Error(`${label}: cannot parse the receiver of \`${line}\`; extend FN_HEADER`);
      }
      const [, name, firstParam] = parsed;
      const receiver = firstParam.trim().replace(/\s+/g, " ");
      if (!RECEIVER.test(receiver)) continue;
      methods.push({ type, name, receiver, line: lineOf(text, start + item.index) });
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
  const flagged = (...items: string[]) => exclusiveReceivers(`impl Thread {\n    ${items.join("\n    ")}\n}\n`);
  for (const item of [
    "pub(crate) fn pop(&mut self, thread_pool: &ThreadPool) -> Option<node::Stole> {}",
    "fn pop<'a>(&'a mut self) {}",
    "fn push_all<T: Into<Batch>>(&mut self, batch: T) {}",
    "fn retain<F: FnMut(*mut Task) -> bool>(&mut self, keep: F) {}",
    "fn r#ref(&mut self) {}",
    "fn pop(self: &mut Self) {}",
    "fn pop(mut self: &mut Thread) {}",
    "fn pop(self: Pin<&mut Self>) {}",
    "fn pop(\n        &mut self,\n        thread_pool: &ThreadPool,\n    ) {}",
  ]) {
    expect(flagged(item)).toHaveLength(1);
  }
  // Comments are stripped; a nested `unsafe extern` fn, a fn-pointer type and
  // non-`self` `&mut` parameters are not receivers.
  expect(
    flagged(
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
    ),
  ).toEqual([]);
  // Headers the parser does not understand fail the lint rather than exempting
  // the method.
  expect(() => flagged("fn pop<T: Into<Option<Batch>>>(&mut self) {}")).toThrow(
    /impl Thread at .*: cannot parse .*fn pop</,
  );
  expect(() => exclusiveReceivers("impl Event {\n    fn wait(&mut self) {}\n")).toThrow(
    /impl Event at .*: no closing brace/,
  );
});

test("the impl scan covers inherent impls of the shared types and nothing else", () => {
  const block = (header: string, indent = "") => `${header}\n${indent}    fn f(&mut self) {}\n${indent}}\n`;
  expect(exclusiveReceivers(block("impl Thread {"))).toEqual([`${SOURCE}:2: impl Thread: fn f(&mut self)`]);
  expect(exclusiveReceivers(block("    impl Queue {", "    "))).toEqual([`${SOURCE}:2: impl Queue: fn f(&mut self)`]);
  expect(exclusiveReceivers(block("impl node::Buffer {"))).toEqual([`${SOURCE}:2: impl Buffer: fn f(&mut self)`]);
  expect(exclusiveReceivers(block("impl Event\nwhere\n    Self: Sized,\n{"))).toEqual([
    `${SOURCE}:5: impl Event: fn f(&mut self)`,
  ]);
  // Trait impls, other types (including `ThreadPool`, which starts with a
  // pinned name) and the item after a block's closing brace are out of scope.
  expect(
    exclusiveReceivers(
      [
        block("impl Drop for Thread {"),
        block("unsafe impl Sync for Queue {"),
        block("impl ThreadPool {"),
        block("impl Consumer<'_> {"),
        "impl Event {\n    fn wait(&self) {}\n}\n",
        block("impl Batch {"),
      ].join(""),
    ),
  ).toEqual([]);
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
