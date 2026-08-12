import { file } from "bun";
import { expect, test } from "bun:test";
import { existsSync, realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A bundler plugin request (`Resolve` / `Load` in src/bundler/bundle_v2.rs) is
// known by exactly one pointer from the moment it is dispatched.
//
// Once dispatched, a request is linked in `Graph::outstanding_resolves` /
// `outstanding_loads` and posted to the thread that runs the plugins, and is
// used through both: the JS thread writes its `value` and posts it back
// through the task's pointer, while the bundle thread writes its
// `outstanding` link through the list's pointer whenever a neighbouring
// request is dispatched or answered, and fails it through the list's pointer
// if the pass is cancelled. Under the aliasing model the list and the task
// therefore have to hold the same pointer. `Resolve::dispatch(&mut self)` and
// `Load::dispatch(&mut self)` used to give them two reborrows of the receiver
// (`push(self)` and `Task::init(ptr::from_mut(self))`): dispatching the next
// request wrote this one's link through the first and invalidated the second,
// and the answer was then consumed through the second. Miri rejects that
// reborrow under Tree Borrows and under Stacked Borrows.
//
// So `BundleV2::dispatch_plugin_request` takes the request by value, parks it
// in the arena, and passes the one `*mut` it gets back both to the list and to
// `Task::init`; there is no other pointer for anything to hold. `Resolve::
// dispatch` / `Load::dispatch` only forward to it. This lint checks both halves:
// the helper's body has that shape (one `arena_create` binding, the same local
// into `.push(..)` and `Task::init(..)`, no reference formed to it), and every
// `fn dispatch` in the crate takes `self` by value and forwards instead of
// linking or posting anything itself.
//
// Not covered: the answer path (`on_resolve_async` / `on_load_async` and the
// thunks in src/runtime/api/JSBundler.rs) and `DeferredBatchTask::schedule`,
// which posts a field of the pass rather than an arena request. The tree-wide
// guard for posting `self` is self-receiver-publish.test.ts, whose ratchet
// entry for bundle_v2.rs this conversion retires; the last test below keeps
// the two from landing out of step.

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

type Finding = { line: number; complaints: string[] };

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** The `{ .. }` block starting at the first `{` at or after `from`. */
function blockAfter(text: string, from: number): string | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Strip comments (full-line ones first, keeping the newline so line numbers
 * hold; then trailing ones) so the doc comments paraphrasing this header do
 * not count. The bodies involved contain no string literals. */
function stripComments(text: string): string {
  return text.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]\/\/.*$/gm, "");
}

// `fn dispatch_plugin_request<T>(&mut self, request: T)`; the `<..>` may be
// absent or carry bounds, the `where` clause is outside the parens.
const HELPER = /\bfn\s+dispatch_plugin_request\b(?:<[^()]*?>)?\s*\(([^)]*)\)/g;
// `&mut self, <name>: <Type>` where the type is a plain path, i.e. the request
// is taken by value and not as a pointer or reference.
const HELPER_PARAMS = /^\s*&mut\s+self\s*,\s*(\w+)\s*:\s*[\w:]+\s*,?\s*$/;

/** Every `dispatch_plugin_request` definition in `text`, audited. */
function auditHelper(text: string): Finding[] {
  const stripped = stripComments(text);
  const out: Finding[] = [];
  for (const m of stripped.matchAll(HELPER)) {
    const complaints: string[] = [];
    const params = HELPER_PARAMS.exec(m[1]);
    if (params === null) complaints.push(`does not take the request by value: \`${m[1].trim()}\``);
    const body = blockAfter(stripped, m.index + m[0].length);
    if (body === null) {
      complaints.push("could not find the body");
    } else if (params !== null) {
      const request = params[1];
      const bindings = [
        ...body.matchAll(
          new RegExp(
            String.raw`\blet\s+(\w+)\s*(?::\s*\*\s*mut\s+[\w:]+\s*)?=\s*self\s*\.\s*arena_create\(\s*${request}\s*\)`,
            "g",
          ),
        ),
      ];
      const allocations = body.match(/\barena_create\(/g)?.length ?? 0;
      if (allocations !== 1) {
        complaints.push(`expected exactly one arena_create, found ${allocations}`);
      } else if (bindings.length !== 1) {
        complaints.push(`does not bind the arena slot of \`${request}\` as a raw pointer`);
      } else {
        const slot = bindings[0][1];
        if (!new RegExp(String.raw`\.push\(\s*${slot}\s*\)`).test(body))
          complaints.push(`\`${slot}\` is not what gets linked`);
        if (!new RegExp(String.raw`\bTask::init\(\s*${slot}\s*\)`).test(body))
          complaints.push(`\`${slot}\` is not what gets posted`);
        if (new RegExp(String.raw`&\s*(?:mut\s+)?\*\s*${slot}\b`).test(body) || /\bfrom_(?:mut|ref)\b/.test(body)) {
          complaints.push(`forms a reference to \`${slot}\``);
        }
      }
    }
    out.push({ line: lineOf(stripped, m.index), complaints });
  }
  return out;
}

const DISPATCH = /\bfn\s+dispatch\s*\(([^)]*)\)/g;

/** Every `fn dispatch` in `text`, audited: by-value `self`, and a body that
 * forwards rather than linking or posting. */
function auditDispatch(text: string): Finding[] {
  const stripped = stripComments(text);
  const out: Finding[] = [];
  for (const m of stripped.matchAll(DISPATCH)) {
    const complaints: string[] = [];
    const params = m[1];
    if (!/^\s*(?:mut\s+)?self\s*(?:,|$)/.test(params)) {
      complaints.push(`does not take the request by value: \`${params.trim()}\``);
    }
    const body = blockAfter(stripped, m.index + m[0].length);
    if (body === null) {
      complaints.push("could not find the body");
    } else {
      if (!/\.dispatch_plugin_request\(\s*self\s*\)/.test(body))
        complaints.push("does not forward to dispatch_plugin_request");
      if (/\.push\(|\bTask::init\(|\barena_create\(/.test(body))
        complaints.push("links, allocates or posts on its own");
    }
    out.push({ line: lineOf(stripped, m.index), complaints });
  }
  return out;
}

const helpers: string[] = [];
const dispatches: string[] = [];
const offenders: string[] = [];
let scanned = 0;
for (const abs of bundlerSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  for (const { line, complaints } of auditHelper(content)) {
    helpers.push(source);
    for (const c of complaints) offenders.push(`${source}:${line}: dispatch_plugin_request ${c}`);
  }
  for (const { line, complaints } of auditDispatch(content)) {
    dispatches.push(source);
    for (const c of complaints) offenders.push(`${source}:${line}: dispatch ${c}`);
  }
}

test("scans the tracked sources of the bundler crate", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertions below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the helper and the two request types' dispatch are where this lint looks for them", () => {
  // If this changes, the helper moved or a request type was added, removed or
  // moved: update this (and the header) rather than the checks below.
  expect({ helpers, dispatches }).toEqual({
    helpers: ["src/bundler/bundle_v2.rs"],
    dispatches: ["src/bundler/bundle_v2.rs", "src/bundler/bundle_v2.rs"],
  });
});

test("the audits recognize the shapes they claim to", () => {
  const complaintsOfHelper = (s: string) => auditHelper(s).flatMap(f => f.complaints);
  const complaintsOfDispatch = (s: string) => auditDispatch(s).flatMap(f => f.complaints);

  const helper = (body: string, params = "&mut self, request: T") =>
    `pub(crate) fn dispatch_plugin_request<T>(${params})\nwhere\n    T: Taskable + OutstandingNode,\n{\n${body}\n}`;
  const conformingBody = `
    // SAFETY-style prose mentioning &mut *request is stripped before auditing.
    let request: *mut T = self.arena_create(request);
    T::outstanding(&mut self.graph).push(request);
    if self.graph.cancelled {
        self.wake_own_loop();
        return;
    }
    let task = bun_event_loop::ConcurrentTask::ConcurrentTask::create(
        bun_event_loop::Task::init(request),
    );
    self.enqueue_on_js_loop_for_plugins(task);`;
  expect(auditHelper(helper(conformingBody))).toEqual([{ line: 1, complaints: [] }]);
  // A different local name and an untyped binding are fine.
  expect(
    complaintsOfHelper(
      helper("let slot = self.arena_create(req); list(self).push(slot); Task::init(slot);", "&mut self, req: R"),
    ),
  ).toEqual([]);
  // The request must arrive by value: a pointer or a reference means someone
  // else already holds a pointer to it.
  expect(complaintsOfHelper(helper(conformingBody, "&mut self, request: *mut T"))).toEqual([
    "does not take the request by value: `&mut self, request: *mut T`",
  ]);
  expect(complaintsOfHelper(helper(conformingBody, "&mut self, request: &mut T"))).toEqual([
    "does not take the request by value: `&mut self, request: &mut T`",
  ]);
  // Two derivations of the slot, in the spellings main used.
  expect(
    complaintsOfHelper(
      helper(`
        let slot: &mut T = self.arena_create(request);
        T::outstanding(&mut self.graph).push(slot);
        Task::init(std::ptr::from_mut::<T>(slot));`),
    ),
  ).toEqual(["does not bind the arena slot of `request` as a raw pointer"]);
  expect(
    complaintsOfHelper(
      helper(`
        let slot: *mut T = self.arena_create(request);
        let again: *mut T = self.arena_create(T::default());
        T::outstanding(&mut self.graph).push(slot);
        Task::init(again);`),
    ),
  ).toEqual(["expected exactly one arena_create, found 2"]);
  expect(
    complaintsOfHelper(
      helper(`
        let slot: *mut T = self.arena_create(request);
        let node = &mut *slot;
        T::outstanding(&mut self.graph).push(node);
        Task::init(std::ptr::from_mut::<T>(node));`),
    ),
  ).toEqual(["`slot` is not what gets linked", "`slot` is not what gets posted", "forms a reference to `slot`"]);
  expect(complaintsOfHelper("fn dispatch_plugin_request<T>(&mut self, request: T)")).toEqual([
    "could not find the body",
  ]);

  expect(
    auditDispatch("pub(crate) fn dispatch(self, bv2: &mut BundleV2<'_>) {\n    bv2.dispatch_plugin_request(self);\n}"),
  ).toEqual([{ line: 1, complaints: [] }]);
  // The shape this lint was written against.
  expect(
    complaintsOfDispatch(`
      pub(crate) fn dispatch(&mut self) {
          unsafe {
              let bv2 = &mut *self.bv2;
              bv2.graph.outstanding_loads.push(self);
              let task = ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(self)));
              bv2.enqueue_on_js_loop_for_plugins(task);
          }
      }`),
  ).toEqual([
    "does not take the request by value: `&mut self`",
    "does not forward to dispatch_plugin_request",
    "links, allocates or posts on its own",
  ]);
  // Other receivers that hand out a second pointer.
  expect(complaintsOfDispatch("fn dispatch(&self, bv2: &mut BundleV2) { bv2.dispatch_plugin_request(self) }")).toEqual([
    "does not take the request by value: `&self, bv2: &mut BundleV2`",
  ]);
  expect(complaintsOfDispatch("unsafe fn dispatch(this: *mut Self) { Task::init(this); }")).toEqual([
    "does not take the request by value: `this: *mut Self`",
    "does not forward to dispatch_plugin_request",
    "links, allocates or posts on its own",
  ]);
  // By value, but doing the work inline instead of through the helper.
  expect(complaintsOfDispatch("fn dispatch(self, bv2: &mut BundleV2) { let p = bv2.arena_create(self); }")).toEqual([
    "does not forward to dispatch_plugin_request",
    "links, allocates or posts on its own",
  ]);
});

test("plugin requests are allocated, linked and posted in one place, through one pointer", () => {
  expect(offenders).toEqual([]);
});

test("the tree-wide publish lint no longer ratchets bundle_v2.rs", async () => {
  // self-receiver-publish.test.ts (the tree-wide guard against posting `self`)
  // was written while Resolve::dispatch / Load::dispatch still did that, and
  // allowlists bundle_v2.rs with an exact count; this conversion is what
  // retires that entry. The two changes touch different files, so nothing
  // else stops them from landing with the entry still in place, which would
  // fail that lint's ratchet on main. Passes trivially while that lint does
  // not exist in this checkout.
  const publishLint = path.join(import.meta.dir, "self-receiver-publish.test.ts");
  if (!existsSync(publishLint)) return;
  const entries = stripComments(await file(publishLint).text()).match(
    /^[ \t]*["']src\/bundler\/bundle_v2\.rs["'][ \t]*:[ \t]*\d+/gm,
  );
  expect(entries).toBeNull();
});
