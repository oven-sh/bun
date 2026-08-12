import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The bundler's plugin requests are handed to the plugins' thread by the
// pointer the pass keeps, never through a `self` receiver.
//
// `Resolve::dispatch` and `Load::dispatch` (src/bundler/bundle_v2.rs) each
// link one arena-allocated request into `Graph::outstanding_resolves` /
// `outstanding_loads` and post it to the JS thread that runs the plugins
// (`enqueue_on_js_loop_for_plugins`). From the moment the post lands, the
// request is used from two threads through two stored pointers: the JS thread
// writes its `value` (and posts it back) through the one in the task, while
// the bundle thread writes its `outstanding` link through the one in the list
// whenever a neighbouring request is pushed or unlinked, and fails the request
// through it if the pass is cancelled. Under the aliasing model that only
// works if the list and the task hold the same pointer. When the two
// functions took `&mut self`, the list got one reborrow of the receiver
// (`push(self)`) and the task another (`Task::init(ptr::from_mut(self))`):
// dispatching the next request wrote this one's link through the list's
// pointer, which invalidated the task's, and the answer was then consumed
// through the task's (Miri rejects that reborrow under Tree Borrows and under
// Stacked Borrows). The `&mut self` argument also asserted exclusive access
// for a call during which the other thread may already have been writing the
// request. (The free variant of the same mistake is
// self-receiver-reclaim.test.ts.)
//
// So the two functions take `this: *mut Self`, and the body passes `this`
// itself both to the list and to `Task::init`. Banned inside them: a `self`
// receiver, and forming a reference to the request (`&mut *this`, `&*this`,
// `ptr::from_mut` / `from_ref`), which is the same two-pointer shape spelled
// differently. The pass itself (`&mut *(*this).bv2`) is not covered: dispatch
// runs on the thread that owns it.
//
// The answer path (`on_resolve_async` / `on_load_async` and the thunks in
// src/runtime/api/JSBundler.rs) and `DeferredBatchTask::schedule` are
// separate populations and not covered here.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const bundlerSources = globAllSources().rust.filter(
  p => p.endsWith(".rs") && path.relative(root, p).replaceAll(path.sep, "/").startsWith("src/bundler/"),
);

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

const DISPATCH = /\bfn\s+dispatch\s*\(([^)]*)\)/g;
// `this: *mut Self` (any parameter name; `*mut Resolve` / `*mut Load` would do
// as well). Captures the name so the body checks can look for it.
const RAW_REQUEST_PARAM = /^\s*(\w+)\s*:\s*\*\s*mut\s+\w+\s*$/;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** The `{ .. }` block starting at the first `{` at or after `from`. */
function blockAfter(text: string, from: number): { start: number; body: string } | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { start, body: text.slice(start, i + 1) };
  }
  return null;
}

/** Strip comments so prose about the banned shapes (this file's own header
 * is paraphrased in the doc comments) does not count. Full-line comments
 * first, keeping the newline so line numbers hold; then trailing ones. The
 * bodies contain no string literals, which is what this would misread. */
function stripComments(text: string): string {
  return text.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]\/\/.*$/gm, "");
}

/** Every `fn dispatch` in `text` and what is wrong with each (nothing, for a
 * conforming one). */
function audit(text: string): { line: number; complaints: string[] }[] {
  const stripped = stripComments(text);
  const out: { line: number; complaints: string[] }[] = [];
  for (const m of stripped.matchAll(DISPATCH)) {
    const line = lineOf(stripped, m.index);
    const complaints: string[] = [];
    const params = m[1];
    const raw = RAW_REQUEST_PARAM.exec(params);
    if (/\bself\b/.test(params)) {
      complaints.push(`takes a self receiver: \`${params.trim()}\``);
    } else if (raw === null) {
      complaints.push(`does not take the request as its one \`*mut\` parameter: \`${params.trim()}\``);
    }
    const block = blockAfter(stripped, m.index + m[0].length);
    if (block === null) {
      complaints.push("could not find the body");
    } else {
      const { body } = block;
      if (/\bself\b/.test(body)) complaints.push("body uses `self`");
      if (raw !== null) {
        const name = raw[1];
        const reborrow = new RegExp(String.raw`&\s*(?:mut\s+)?\*\s*${name}\b`);
        if (reborrow.test(body) || /\bfrom_(?:mut|ref)\b/.test(body)) {
          complaints.push("body forms a reference to the request");
        }
        const linked = new RegExp(String.raw`\boutstanding_\w+\s*\.\s*push\(\s*${name}\s*\)`);
        if (!linked.test(body)) complaints.push(`body does not link \`${name}\` itself into the outstanding list`);
        const posted = new RegExp(String.raw`\bTask::init\(\s*${name}\s*\)`);
        if (!posted.test(body)) complaints.push(`body does not post \`${name}\` itself`);
      }
    }
    out.push({ line, complaints });
  }
  return out;
}

const found: string[] = [];
const offenders: string[] = [];
let scanned = 0;
for (const abs of bundlerSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  for (const { line, complaints } of audit(await file(abs).text())) {
    found.push(source);
    for (const c of complaints) offenders.push(`${source}:${line}: ${c}`);
  }
}

test("scans the tracked sources of the bundler crate", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertions below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("Resolve::dispatch and Load::dispatch are still where this lint looks for them", () => {
  // If this changes, a request type was added, removed or moved: update this
  // list (and the header) rather than the checks below.
  expect(found).toEqual(["src/bundler/bundle_v2.rs", "src/bundler/bundle_v2.rs"]);
});

test("the audit recognizes the shapes it claims to", () => {
  const conforming = `
    pub(crate) unsafe fn dispatch(this: *mut Self) {
        // SAFETY: see above; \`&mut *this\` is mentioned here only in prose.
        unsafe {
            let bv2 = &mut *(*this).bv2;
            bv2.graph.outstanding_resolves.push(this);
            if bv2.graph.cancelled {
                bv2.wake_own_loop();
                return;
            }
            let task = bun_event_loop::ConcurrentTask::ConcurrentTask::create(
                bun_event_loop::Task::init(this),
            );
            bv2.enqueue_on_js_loop_for_plugins(task);
        }
    }`;
  expect(audit(conforming)).toEqual([{ line: 2, complaints: [] }]);
  // Another parameter name and a spelled-out type are fine too.
  expect(audit("unsafe fn dispatch(load: *mut Load) { outstanding_loads.push(load); Task::init(load); }")).toEqual([
    { line: 1, complaints: [] },
  ]);

  const complaintsOf = (snippet: string) => audit(snippet).flatMap(f => f.complaints);

  // The shape this lint was written against: the receiver gets reborrowed once
  // for the list and once for the task.
  expect(
    complaintsOf(`
      pub(crate) fn dispatch(&mut self) {
          unsafe {
              let bv2 = &mut *self.bv2;
              bv2.graph.outstanding_loads.push(self);
              let task = ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(self)));
              bv2.enqueue_on_js_loop_for_plugins(task);
          }
      }`),
  ).toEqual(["takes a self receiver: `&mut self`", "body uses `self`"]);
  expect(complaintsOf("fn dispatch(self: &mut Self) {}")).toContain("takes a self receiver: `self: &mut Self`");
  expect(complaintsOf("fn dispatch(this: &mut Self) {}")).toContain(
    "does not take the request as its one `*mut` parameter: `this: &mut Self`",
  );
  expect(complaintsOf("fn dispatch(this: *mut Self, bv2: &mut BundleV2) {}")).toContain(
    "does not take the request as its one `*mut` parameter: `this: *mut Self, bv2: &mut BundleV2`",
  );
  // Raw receiver, but the body reintroduces a second pointer derivation.
  expect(
    complaintsOf(`
      unsafe fn dispatch(this: *mut Self) {
          let this_ref = &mut *this;
          bv2.graph.outstanding_resolves.push(this);
          Task::init(this);
      }`),
  ).toEqual(["body forms a reference to the request"]);
  expect(
    complaintsOf(`
      unsafe fn dispatch(this: *mut Self) {
          bv2.graph.outstanding_resolves.push(this);
          Task::init(std::ptr::from_mut::<Self>(&mut *this));
      }`),
  ).toEqual(["body forms a reference to the request", "body does not post `this` itself"]);
  expect(
    complaintsOf(`
      unsafe fn dispatch(this: *mut Self) {
          let node = this.cast::<Self>();
          bv2.graph.outstanding_resolves.push(node);
          Task::init(this);
      }`),
  ).toEqual(["body does not link `this` itself into the outstanding list"]);
  expect(complaintsOf("unsafe fn dispatch(this: *mut Self)")).toContain("could not find the body");
});

test("plugin requests are dispatched through the pointer the pass keeps", () => {
  expect(offenders).toEqual([]);
});
