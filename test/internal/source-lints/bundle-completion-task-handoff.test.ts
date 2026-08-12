import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

// One `JSBundleCompletionTask` allocation is shared between the JS thread that
// called `Bun.build()` (or is serving an HTML route) and the bundle thread for
// as long as the build runs:
//
//   - the JS thread hands it over with `singleton::enqueue`, and from then on
//     may still cancel it (`stop_for_vm_teardown`, `HTMLBundle::State::deinit`)
//     or release it while it is queued, all through its own pointer;
//   - the bundler writes the task's `log` for the whole build through the raw
//     pointer `create_and_configure_transpiler` hands `Transpiler::init`.
//
// A reference argument is protected for the duration of its call under both
// aliasing models (Tree Borrows is what `bun run rust:miri` uses), so every one
// of those accesses is UB while the bundle thread is inside a method that took
// the task by `&mut self`; `init_and_run`'s call used to span the entire build.
// Symmetrically, a JS-side field write after the enqueue lands while the bundle
// thread may already be inside such a call. Neither shape is something the
// compiler rejects, so this pins the signatures that rule them out:
//
//   1. `CompletionStruct` (src/bundler/BundleThread.rs), the bundle thread's
//      whole view of the task, takes it as `this: *mut Self` in every method
//      and projects fields; no `self` receivers, and nothing in BundleThread.rs
//      reborrows the dequeued task (the dequeue loop used to form
//      `let completion = unsafe { &mut *completion };` for the whole build;
//      fn-long-mut-reborrow.test.ts is the tree-wide lint for that shape under
//      the callback-parameter names it knows about).
//   2. `create_and_schedule_completion_task` (src/runtime/api/
//      js_bundle_completion_task.rs) does not touch the task after enqueuing
//      it, and the per-owner fields its callers used to fill in afterwards
//      (`promise`, `html_build_task`, `started_at_ns`) are private to the
//      module, so an owner can only get them in through the `Deliver`
//      argument, i.e. before the enqueue.

const root = path.resolve(import.meta.dir, "..", "..", "..");

async function stripped(rel: string): Promise<string> {
  const source = await file(path.join(root, rel)).text();
  // Full-line comments only (`[ \t]*`, not `\s*`, so blank lines and hence
  // line numbers survive); the shapes below never share a line with code.
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The first top-level item whose header matches `header`, from that header
 * to the next `}` at column 0. */
function topLevelItem(source: string, header: RegExp, what: string): string {
  const m = header.exec(source);
  if (m === null) throw new Error(`${what} not found; update this lint if it moved`);
  const end = source.indexOf("\n}", m.index);
  if (end === -1) throw new Error(`${what}: unterminated item`);
  return source.slice(m.index, end + 2);
}

/** Every `fn` header in `block` with the text of its first parameter: a
 * receiver shows up as `&mut self` / `&self` / `self` / `mut self`, a
 * pointer-taking method as `this: *mut Self`, however rustfmt wrapped it. */
function methodReceivers(block: string): Array<{ name: string; first: string }> {
  return [...block.matchAll(/\bfn\s+(\w+)\s*(?:<[^>]*>)?\s*\(\s*([^,)]*)/g)].map(m => ({
    name: m[1],
    first: m[2].trim(),
  }));
}

const THIS_PTR = /^this\s*:\s*\*\s*mut\s+Self$/;

/** Reborrows of a binding named `completion` (`&mut *completion`,
 * `&*completion`) in `code`, with their line numbers. */
function reborrows(code: string): string[] {
  return [...code.matchAll(/&\s*(?:mut\s+)?\*\s*completion\b/g)].map(m => {
    const line = code.slice(0, m.index).split("\n").length;
    return `${line}: ${m[0]}`;
  });
}

/** Uses of the task binding `task` in `code`: `(*task)` and `task.method(..)`. */
function taskTouches(code: string, task: string): string[] {
  const touch = new RegExp(String.raw`\(\s*\*\s*${task}\s*\)|\b${task}\s*\.\s*\w+`, "g");
  return [...code.matchAll(touch)].map(m => m[0].replace(/\s+/g, " "));
}

test("the scans recognize the shapes they claim to", () => {
  const receivers = methodReceivers(
    [
      "fn a(&mut self) -> bool;",
      "fn b(&self) -> u8;",
      "fn c(self);",
      "fn d(mut self);",
      "fn e<'a>(\n        &mut self,\n        bump: &'a Arena,\n    ) -> Result<(), E>;",
      "fn f(this: *mut Self);",
      "unsafe fn g<'a>(\n        this: *mut Self,\n        bump: &'a Arena,\n    ) -> Result<&'a mut T<'a>, E>;",
      "fn h();",
    ].join("\n"),
  );
  expect(receivers.map(r => r.name)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  expect(receivers.filter(r => !THIS_PTR.test(r.first)).map(r => r.name)).toEqual(["a", "b", "c", "d", "e", "h"]);

  expect(reborrows("let x = 1;\nlet completion = unsafe { &mut *completion };")).toEqual(["2: &mut *completion"]);
  expect(reborrows("Self::run(unsafe { &*completion })")).toEqual(["1: &*completion"]);
  expect(reborrows("C::try_start(completion);\n(*completion).try_start();\n&mut *completion_task")).toEqual([]);

  // The tail of `create_and_schedule_completion_task` as it used to be.
  expect(
    taskTouches(
      "\n    unsafe {\n        (*completion)\n            .poll_ref\n            .ref_(ctx)\n    };\n\n    Ok(completion)\n}",
      "completion",
    ),
  ).toEqual(["(*completion)"]);
  expect(taskTouches("\n    completion.as_ptr()\n}", "completion")).toEqual(["completion.as_ptr"]);
  expect(taskTouches("\n    completion\n}", "completion")).toEqual([]);
  expect(taskTouches("\n    Ok(completion)\n}", "completion")).toEqual([]);
  expect(taskTouches("\n    other_completion.ref_()\n}", "completion")).toEqual([]);
});

test("CompletionStruct takes the task by pointer in every method", async () => {
  const source = await stripped("src/bundler/BundleThread.rs");
  const trait = topLevelItem(source, /^pub trait CompletionStruct\b.*\{$/m, "trait CompletionStruct");
  const receivers = methodReceivers(trait);
  // The calls that bracket the build. If they are gone the trait has been
  // reshaped and this lint needs a fresh look, not a vacuous pass.
  expect(receivers.map(r => r.name)).toEqual(
    expect.arrayContaining([
      "try_start",
      "create_and_configure_transpiler",
      "init_and_run",
      "complete_on_bundle_thread",
    ]),
  );
  expect(receivers.filter(r => !THIS_PTR.test(r.first)).map(r => `${r.name}(${r.first})`)).toEqual([]);
});

test("BundleThread.rs never reborrows the dequeued task", async () => {
  expect(reborrows(await stripped("src/bundler/BundleThread.rs"))).toEqual([]);
});

test("create_and_schedule_completion_task does not touch the task after enqueuing it", async () => {
  const source = await stripped("src/runtime/api/js_bundle_completion_task.rs");
  const body = topLevelItem(
    source,
    /^pub\(crate\) fn create_and_schedule_completion_task\b/m,
    "fn create_and_schedule_completion_task",
  );
  const enqueue = /\benqueue::<JSBundleCompletionTask>\(\s*(\w+)[^;]*\);/.exec(body);
  if (enqueue === null) throw new Error("enqueue call not found; update this lint if it was reshaped");
  // From here the task is the bundle thread's; returning the pointer is fine.
  const tail = body.slice(enqueue.index + enqueue[0].length);
  expect(taskTouches(tail, enqueue[1])).toEqual([]);
});

test("the per-owner fields are private, so they can only be set through Deliver", async () => {
  const source = await stripped("src/runtime/api/js_bundle_completion_task.rs");
  const struct = topLevelItem(source, /^pub struct JSBundleCompletionTask\b.*\{$/m, "struct JSBundleCompletionTask");
  const visibility: Record<string, string> = {};
  for (const name of ["promise", "html_build_task", "started_at_ns"]) {
    const decl = new RegExp(String.raw`^[ \t]+((?:pub(?:\([^)]*\))?[ \t]+)?)${name}[ \t]*:`, "m").exec(struct);
    if (decl === null) throw new Error(`field \`${name}\` not found; update this lint if it was renamed`);
    visibility[name] = decl[1].trim();
  }
  expect(visibility).toEqual({ promise: "", html_build_task: "", started_at_ns: "" });
  expect(source).toMatch(/^pub\(crate\) enum Deliver\b/m);
});
