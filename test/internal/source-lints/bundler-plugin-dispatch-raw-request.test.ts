import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
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
// `Task::init`; there is no other pointer for anything to hold. This lint
// checks that the helper's body has that shape (one `arena_create` binding,
// the same local into `.push(..)` and `Task::init(..)`, no reference formed to
// it), and that nothing else in the crate links a request into an outstanding
// list: linking is what makes something a dispatched request, so a method
// that links its own receiver again, under whatever name, shows up here.
//
// Not covered: the answer path (`on_resolve_async` / `on_load_async` and the
// thunks in src/runtime/api/JSBundler.rs) and `DeferredBatchTask::schedule`,
// which posts a field of the pass rather than an arena request; the general
// "posting `self`" spelling is the tree-wide lint's business (#37723).

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

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Bounds of the `{ .. }` block starting at the first `{` at or after `from`. */
function blockAfter(text: string, from: number): { start: number; end: number } | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { start, end: i + 1 };
  }
  return null;
}

/** Strip comments (full-line ones first, keeping the newline so line numbers
 * hold; then trailing ones) so the doc comments paraphrasing this header do
 * not count. The code involved contains no string literals. */
function stripComments(text: string): string {
  return text.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]\/\/.*$/gm, "");
}

// `fn dispatch_plugin_request<T>(&mut self, request: T)`; the `<..>` may be
// absent or carry bounds, the `where` clause is outside the parens.
const HELPER = /\bfn\s+dispatch_plugin_request\b(?:<[^()]*?>)?\s*\(([^)]*)\)/g;
// `&mut self, <name>: <Type>` where the type is a plain path, i.e. the request
// is taken by value and not as a pointer or reference.
const HELPER_PARAMS = /^\s*&mut\s+self\s*,\s*(\w+)\s*:\s*[\w:]+\s*,?\s*$/;
// Linking a request: a push onto one of the graph's lists, reached either as
// the field or through the `OutstandingNode::outstanding` accessor.
const LINK = /(?:\boutstanding_\w+|::outstanding\([^)]*\))\s*\.\s*push\(/g;

type Audit = {
  /** Each helper definition and what is wrong with it (nothing, if conforming). */
  helpers: { line: number; complaints: string[] }[];
  /** Lines of every link site, and of those outside a helper body. */
  links: number[];
  strayLinks: number[];
};

function audit(text: string): Audit {
  const stripped = stripComments(text);
  const out: Audit = { helpers: [], links: [], strayLinks: [] };
  const bodies: { start: number; end: number }[] = [];
  for (const m of stripped.matchAll(HELPER)) {
    const complaints: string[] = [];
    const params = HELPER_PARAMS.exec(m[1]);
    if (params === null) complaints.push(`does not take the request by value: \`${m[1].trim()}\``);
    const bounds = blockAfter(stripped, m.index + m[0].length);
    if (bounds === null) {
      complaints.push("could not find the body");
    } else {
      bodies.push(bounds);
      if (params !== null) complaints.push(...auditBody(stripped.slice(bounds.start, bounds.end), params[1]));
    }
    out.helpers.push({ line: lineOf(stripped, m.index), complaints });
  }
  for (const m of stripped.matchAll(LINK)) {
    const line = lineOf(stripped, m.index);
    out.links.push(line);
    if (!bodies.some(b => m.index >= b.start && m.index < b.end)) out.strayLinks.push(line);
  }
  return out;
}

function auditBody(body: string, request: string): string[] {
  const allocations = body.match(/\barena_create\(/g)?.length ?? 0;
  if (allocations !== 1) return [`expected exactly one arena_create, found ${allocations}`];
  const binding = new RegExp(
    String.raw`\blet\s+(\w+)\s*(?::\s*\*\s*mut\s+[\w:]+\s*)?=\s*self\s*\.\s*arena_create\(\s*${request}\s*\)`,
  ).exec(body);
  if (binding === null) return [`does not bind the arena slot of \`${request}\` as a raw pointer`];
  const slot = binding[1];
  const complaints: string[] = [];
  if (!new RegExp(String.raw`\.push\(\s*${slot}\s*\)`).test(body))
    complaints.push(`\`${slot}\` is not what gets linked`);
  if (!new RegExp(String.raw`\bTask::init\(\s*${slot}\s*\)`).test(body))
    complaints.push(`\`${slot}\` is not what gets posted`);
  if (new RegExp(String.raw`&\s*(?:mut\s+)?\*\s*${slot}\b`).test(body) || /\bfrom_(?:mut|ref)\b/.test(body)) {
    complaints.push(`forms a reference to \`${slot}\``);
  }
  return complaints;
}

const helpers: string[] = [];
let links = 0;
const offenders: string[] = [];
let scanned = 0;
for (const abs of bundlerSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const result = audit(await file(abs).text());
  links += result.links.length;
  for (const { line, complaints } of result.helpers) {
    helpers.push(source);
    for (const c of complaints) offenders.push(`${source}:${line}: dispatch_plugin_request ${c}`);
  }
  for (const line of result.strayLinks)
    offenders.push(`${source}:${line}: links a request outside dispatch_plugin_request`);
}

test("scans the tracked sources of the bundler crate", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertions below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("there is one helper, and it is the one place a request gets linked", () => {
  // If this changes, the helper moved or was split, or linking is spelled in a
  // way LINK does not see: update this (and the header) rather than the ban
  // below. `links` counting the helper's own push is what keeps the stray-link
  // check from going vacuous.
  expect({ helpers, links }).toEqual({ helpers: ["src/bundler/bundle_v2.rs"], links: 1 });
});

test("the audit recognizes the shapes it claims to", () => {
  const helper = (body: string, params = "&mut self, request: T") =>
    `pub(crate) fn dispatch_plugin_request<T>(${params})\nwhere\n    T: Taskable + OutstandingNode,\n{\n${body}\n}`;
  const conformingBody = `
    // Prose mentioning &mut *request or outstanding_loads.push( is stripped first.
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
  expect(audit(helper(conformingBody))).toEqual({
    helpers: [{ line: 1, complaints: [] }],
    links: [8],
    strayLinks: [],
  });
  // A different local name and an untyped binding are fine.
  expect(
    audit(
      helper(
        "let slot = self.arena_create(req); T::outstanding(&mut self.graph).push(slot); Task::init(slot);",
        "&mut self, req: R",
      ),
    ),
  ).toMatchObject({ helpers: [{ complaints: [] }], strayLinks: [] });

  const complaintsOf = (snippet: string) => audit(snippet).helpers.flatMap(h => h.complaints);
  // The request must arrive by value: a pointer or a reference means someone
  // else already holds a pointer to it.
  expect(complaintsOf(helper(conformingBody, "&mut self, request: *mut T"))).toEqual([
    "does not take the request by value: `&mut self, request: *mut T`",
  ]);
  expect(complaintsOf(helper(conformingBody, "&mut self, request: &mut T"))).toEqual([
    "does not take the request by value: `&mut self, request: &mut T`",
  ]);
  // Two derivations of the slot, in the spellings main used.
  expect(
    complaintsOf(
      helper(`
        let slot: &mut T = self.arena_create(request);
        T::outstanding(&mut self.graph).push(slot);
        Task::init(std::ptr::from_mut::<T>(slot));`),
    ),
  ).toEqual(["does not bind the arena slot of `request` as a raw pointer"]);
  expect(
    complaintsOf(
      helper(`
        let slot: *mut T = self.arena_create(request);
        let node = &mut *slot;
        T::outstanding(&mut self.graph).push(node);
        Task::init(std::ptr::from_mut::<T>(node));`),
    ),
  ).toEqual(["`slot` is not what gets linked", "`slot` is not what gets posted", "forms a reference to `slot`"]);
  expect(
    complaintsOf(
      helper(`
        let slot: *mut T = self.arena_create(request);
        let again: *mut T = self.arena_create(T::default());
        T::outstanding(&mut self.graph).push(slot);
        Task::init(again);`),
    ),
  ).toEqual(["expected exactly one arena_create, found 2"]);
  expect(complaintsOf("fn dispatch_plugin_request<T>(&mut self, request: T)")).toEqual(["could not find the body"]);

  // main's shape: no helper, and each request type links itself.
  const mainShape = `
    impl Resolve {
        pub(crate) fn dispatch(&mut self) {
            unsafe {
                let bv2 = &mut *self.bv2;
                bv2.graph.outstanding_resolves.push(self);
                let task = ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(self)));
                bv2.enqueue_on_js_loop_for_plugins(task);
            }
        }
    }
    impl Load {
        pub(crate) fn dispatch(&mut self) {
            unsafe { (*self.bv2).graph.outstanding_loads.push(self) }
        }
    }`;
  expect(audit(mainShape)).toEqual({ helpers: [], links: [6, 14], strayLinks: [6, 14] });
  // The helper present, plus a method of any name linking its receiver again,
  // through either spelling of the list.
  expect(
    audit(
      helper(conformingBody) +
        `
    impl Load {
        fn redispatch(&mut self, bv2: &mut BundleV2) {
            Load::outstanding(&mut bv2.graph).push(self);
        }
        fn relink(&mut self, graph: &mut Graph) {
            graph.outstanding_loads.push(self);
        }
    }`,
    ),
  ).toMatchObject({ strayLinks: [20, 23] });
  // Other uses of the lists are not links.
  expect(
    audit(`
      this.graph.outstanding_resolves.unlink(resolve);
      while let Some(load) = self.graph.outstanding_loads.pop() {}
      let mut load = self.outstanding_loads.head;
      pub(crate) fn push(&mut self, node: *mut T) {}
      pending.push(self);`),
  ).toEqual({ helpers: [], links: [], strayLinks: [] });
});

test("plugin requests are allocated, linked and posted in one place, through one pointer", () => {
  expect(offenders).toEqual([]);
});
