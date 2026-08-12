import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

// An outstanding bundler plugin request is never borrowed whole.
//
// `api::JSBundler::Resolve` / `Load` (src/bundler/bundle_v2.rs) are the
// onResolve / onLoad requests a bundle pass hands to the thread running the
// plugins. From `dispatch` until the answer comes back, one request is used
// from two threads at once, by field: the plugins' thread reads the fields
// set before dispatch and writes the answer (`value`, `called_defer`, the
// intrusive `task` node), while the request stays linked in the bundle
// thread's `Graph::outstanding_*` list, and that thread writes the link
// (`OutstandingList::push` of the next request writes the head's `prev`,
// `unlink` of an answered one writes its neighbours') and `Load::deferred`
// (`on_notify_defer_mini`) whenever it likes. For `Bun.build` this really is
// concurrent; the two sides only ever touch disjoint fields, so it is fine as
// long as each side goes through the raw pointer field by field. A `&Load` /
// `&mut Load` (or `&Resolve`) formed on either side covers the other side's
// fields as well: as a function argument it is protected for the duration of
// the call, and the other thread's write is then a foreign write to a
// protected tag, which Miri rejects under Tree Borrows (the model
// `bun run rust:miri` uses) and under Stacked Borrows. This tree used to do
// that in every place the plugins' thread touched a request (`run_task`'s two
// arms formed `&mut *ptr`, `run_on_js_thread` / `on_defer` took `&mut self`,
// `onLoadAsync` took `&mut Load` straight from C++, `addError` went through
// `callback_ctx`, `on_*_async` took `&mut` and held it across the post), and
// in the two places the bundle thread touched a request that was still out
// (`OutstandingNode::link(&mut self)` on the neighbours, `on_notify_defer_mini`).
//
// What this lint holds in place, for the population listed in ENTRIES below
// (every function that touches a request while it may be outstanding; the
// answer-side consumers `on_load` / `on_resolve` and the cancellation path own
// the request again and are deliberately not in it):
//
//   - the request arrives as a raw pointer: a `*mut` parameter, never a
//     `self` receiver or a reference parameter;
//   - the body does not turn it into a reference: no `&mut *req` / `&*req` /
//     `&(*req)` of the whole request (`&(*req).field` is fine, that is the
//     point), no `ptr::from_mut(req)`, no method call on `(*req)` (which
//     auto-borrows the whole request; rustc's `dangerous_implicit_autorefs`
//     only catches the variant that goes through an overloaded `Deref`, such
//     as a `BackRef` field, which is why those are copied out first), no
//     `callback_ctx`;
//   - where the request is handed on (to C++ as the context cookie, to the
//     post-back, to the notify), the body passes the pointer it received, not
//     a reborrow, so the list, the plugins' thread and the answer all hold the
//     one pointer;
//   - `OutstandingNode` reaches a node's link through a raw projection, and
//     `OutstandingList` never reborrows a node.
//
// The pass itself (`bv2`) is a different object and not covered: how the
// plugin hops and the answer thunks reach it is bundler-plugin-hops-raw-pass /
// event-loop-post-shared territory. `dispatch()` (the posting side, where the
// request is not yet outstanding) is bundler-plugin-dispatch-raw-request's.

const root = path.resolve(import.meta.dir, "..", "..", "..");

type Found = { file: string; name: string; line: number; complaints: string[] };

type Entry = {
  file: string;
  /** `fn <name>` to audit (every definition with that name in the file). */
  fn: string;
  /** How many definitions the file is expected to contain. */
  count: number;
  /**
   * The function belongs to the request type, so a `self` receiver would be
   * the request. (For `BundleV2` methods `self` is the pass, which is fine.)
   */
  selfIsRequest?: boolean;
  /** Body identifiers that hold the request besides the `*mut` parameters. */
  bodyNames?: string[];
  /**
   * Each is given the request's parameter name and must match the body: the
   * places the request is handed on, which must receive that very pointer.
   */
  handsOn?: ((name: string) => RegExp)[];
};

const REQUEST_TYPE = /\b(?:Resolve|Load|Self)\b/;

const ENTRIES: Entry[] = [
  // Plugins' thread: the hop that calls into the plugin, passing the request
  // as the context cookie C++ later hands back to the answer thunks.
  {
    file: "src/bundler/bundle_v2.rs",
    fn: "run_on_js_thread",
    count: 2,
    selfIsRequest: true,
    handsOn: [n => new RegExp(String.raw`\b${n}\s*\.\s*cast\b`)],
  },
  // Plugins' thread: the answer is posted back through the same pointer.
  {
    file: "src/bundler/bundle_v2.rs",
    fn: "on_load_async",
    count: 1,
    handsOn: [
      n => new RegExp(String.raw`\bfrom_callback\(\s*${n}\s*,`),
      n => new RegExp(String.raw`\benqueue_task_concurrent_with_extra_ctx(?:::<[^(]*>)?\(\s*${n}\s*,`),
    ],
  },
  {
    file: "src/bundler/bundle_v2.rs",
    fn: "on_resolve_async",
    count: 1,
    handsOn: [
      n => new RegExp(String.raw`\bfrom_callback\(\s*${n}\s*,`),
      n => new RegExp(String.raw`\benqueue_task_concurrent_with_extra_ctx(?:::<[^(]*>)?\(\s*${n}\s*,`),
    ],
  },
  // Bundle thread, while the load's callback is parked in `.defer()`.
  { file: "src/bundler/bundle_v2.rs", fn: "on_notify_defer_mini", count: 1 },
  // The C++-facing answer thunks and what they call.
  {
    file: "src/runtime/api/JSBundler.rs",
    fn: "JSBundlerPlugin__onResolveAsync",
    count: 1,
    handsOn: [n => new RegExp(String.raw`\bon_resolve_async\(\s*${n}\s*\)`)],
  },
  {
    file: "src/runtime/api/JSBundler.rs",
    fn: "JSBundlerPlugin__onLoadAsync",
    count: 1,
    handsOn: [n => new RegExp(String.raw`\bon_load_async\(\s*${n}\s*\)`)],
  },
  {
    file: "src/runtime/api/JSBundler.rs",
    fn: "JSBundlerPlugin__onDefer",
    count: 1,
    handsOn: [n => new RegExp(String.raw`\bon_defer\(\s*${n}\s*,`)],
  },
  {
    file: "src/runtime/api/JSBundler.rs",
    fn: "on_defer",
    count: 1,
    selfIsRequest: true,
    handsOn: [n => new RegExp(String.raw`\benqueue_task_concurrent_with_extra_ctx(?:::<[^(]*>)?\(\s*${n}\s*,`)],
  },
  // `addError` gets the request as `*mut c_void` plus a discriminator and
  // casts it itself; the casts are the handles the body must not reborrow.
  {
    file: "src/runtime/api/JSBundler.rs",
    fn: "JSBundlerPlugin__addError",
    count: 1,
    bodyNames: ["ctx", "resolve", "load"],
  },
  { file: "src/runtime/api/JSBundler.rs", fn: "on_notify_defer_mini_wrap", count: 1 },
];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/**
 * Comments go first (full-line ones, then trailing ones, keeping newlines so
 * line numbers hold), then string literals, so neither prose about the banned
 * shapes nor a `{` inside a format string confuses the scans below. Nothing
 * audited here puts `//` or a newline inside a string literal.
 */
function stripCommentsAndStrings(text: string): string {
  return text
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/.*$/gm, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** The text from the `open` character at `start` to its balanced close, inclusive. */
function balanced(text: string, start: number, open: string, close: string): string | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === open) depth++;
    else if (c === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Every `fn <name>(...) ... { ... }` in (already stripped) `text`. */
function fnDefinitions(text: string, name: string): { line: number; params: string; body: string | null }[] {
  const out: { line: number; params: string; body: string | null }[] = [];
  for (const m of text.matchAll(new RegExp(String.raw`\bfn\s+${name}\s*(?:<[^>]*>)?\s*\(`, "g"))) {
    const parenAt = m.index + m[0].length - 1;
    const paramList = balanced(text, parenAt, "(", ")");
    if (paramList === null) continue;
    const afterParams = parenAt + paramList.length;
    // A trait declaration (`fn f(&mut self) -> T;`) has no body; still
    // audited for its signature.
    const restOfLine = text.slice(afterParams, text.indexOf("\n", afterParams));
    let body: string | null = null;
    if (!/^[^{]*;/.test(restOfLine)) {
      const braceAt = text.indexOf("{", afterParams);
      body = braceAt < 0 ? null : balanced(text, braceAt, "{", "}");
    }
    out.push({ line: lineOf(text, m.index), params: paramList.slice(1, -1), body });
  }
  return out;
}

/** Top-level split of a parameter list on commas (generics may nest commas). */
function splitParams(params: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of params) {
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out.map(p => p.trim()).filter(Boolean);
}

/** The ways a body can turn the request called `name` back into a reference, or borrow it whole. */
function referenceForming(name: string): { what: string; pattern: RegExp }[] {
  const n = String.raw`\b${name}\b`;
  return [
    { what: `reborrows \`${name}\``, pattern: new RegExp(String.raw`&\s*(?:mut\s+)?\*\s*${n}`) },
    {
      what: `borrows \`${name}\` whole`,
      pattern: new RegExp(String.raw`&\s*(?:mut\s+)?\(\s*\*\s*${n}\s*\)(?!\s*\.)`),
    },
    {
      what: `makes a reference to \`${name}\``,
      pattern: new RegExp(String.raw`\bfrom_(?:mut|ref)(?:::<[^>]*>)?\(\s*${n}\s*\)|\bNonNull::from\(\s*${n}\s*\)`),
    },
    {
      what: `calls a method on \`*${name}\` (auto-borrows the whole request)`,
      pattern: new RegExp(String.raw`\(\s*\*\s*${n}\s*\)\s*\.\s*\w+\s*(?:::<[^>]*>)?\s*\(`),
    },
  ];
}

function auditFn(entry: Entry, text: string): Found[] {
  return fnDefinitions(text, entry.fn).map(({ line, params, body }) => {
    const complaints: string[] = [];
    const names = [...(entry.bodyNames ?? [])];
    for (const param of splitParams(params)) {
      if (/^(?:&\s*(?:mut\s+)?)?(?:mut\s+)?self\b/.test(param) || /^self\s*:/.test(param)) {
        if (entry.selfIsRequest) complaints.push(`takes the request as a self receiver: \`${param}\``);
        continue;
      }
      const colon = param.indexOf(":");
      if (colon < 0) continue;
      const pname = param.slice(0, colon).trim();
      const ptype = param.slice(colon + 1).trim();
      if (!REQUEST_TYPE.test(ptype)) continue;
      if (!/^\*\s*mut\b/.test(ptype)) complaints.push(`takes the request as \`${param}\`, not \`*mut\``);
      names.push(pname);
    }
    if (entry.selfIsRequest && names.length === 0 && !complaints.length) {
      complaints.push("takes no request parameter");
    }
    if (body === null) {
      if (!entry.selfIsRequest || !complaints.length) complaints.push("could not find the body");
      return { file: entry.file, name: entry.fn, line, complaints };
    }
    if (entry.selfIsRequest && /\bself\b/.test(body)) complaints.push("body uses `self`");
    if (/\bcallback_ctx\b/.test(body)) complaints.push("body goes through `callback_ctx` (a `&mut` to the request)");
    for (const name of names) {
      for (const { what, pattern } of referenceForming(name)) {
        if (pattern.test(body)) complaints.push(`body ${what}`);
      }
    }
    if (entry.handsOn && !entry.bodyNames) {
      // The parameter that is the request (one per function in this population).
      const [name] = names;
      if (name !== undefined) {
        for (const make of entry.handsOn) {
          const pattern = make(name);
          if (!pattern.test(body)) complaints.push(`body does not hand \`${name}\` itself on (expected ${pattern})`);
        }
      }
    }
    return { file: entry.file, name: entry.fn, line, complaints };
  });
}

/**
 * src/runtime/dispatch.rs: the `run_task` arms for the two hop tags. The arm
 * has to call `run_on_js_thread` with the queued pointer itself (`cast_ptr!`),
 * not through `cast!` / `&mut *`, which mint a `&mut` over the request.
 */
function auditDispatchArms(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(/\btask_tag::(BundleV2Plugin(?:Resolve|Load))\b\s*=>\s*\{/g)) {
    const body = balanced(text, m.index + m[0].length - 1, "{", "}");
    if (body === null || !/\brun_on_js_thread\b/.test(body)) continue; // the release arm, or unreadable
    const complaints: string[] = [];
    if (/\bcast!\s*\(/.test(body)) complaints.push("arm uses `cast!` (forms `&mut` to the request)");
    if (/&\s*(?:mut\s+)?\*/.test(body)) complaints.push("arm reborrows the request");
    if (!/\brun_on_js_thread\(\s*cast_ptr!\s*\(/.test(body)) {
      complaints.push("arm does not pass the queued pointer (`cast_ptr!`) to `run_on_js_thread`");
    }
    out.push({ file: "src/runtime/dispatch.rs", name: `${m[1]} arm`, line: lineOf(text, m.index), complaints });
  }
  return out;
}

/**
 * src/bundler/Graph.rs: the list only ever owns the link inside a node, and
 * its neighbours are out with the plugins' thread while it writes them.
 */
function auditOutstandingList(text: string): Found[] {
  const out: Found[] = [];
  const trait = /\btrait\s+OutstandingNode\b[^{]*\{/.exec(text);
  if (trait === null) {
    out.push({ file: "src/bundler/Graph.rs", name: "trait OutstandingNode", line: 0, complaints: ["not found"] });
  } else {
    const body = balanced(text, trait.index + trait[0].length - 1, "{", "}") ?? "";
    const complaints: string[] = [];
    if (/&/.test(body))
      complaints.push(
        "trait hands out a reference (receiver or return); the link must be reached as `*mut` from a `*mut Self`",
      );
    out.push({
      file: "src/bundler/Graph.rs",
      name: "trait OutstandingNode",
      line: lineOf(text, trait.index),
      complaints,
    });
  }
  const impl = /\bimpl\s*<[^>]*>\s*OutstandingList\s*<[^>]*>\s*\{/.exec(text);
  if (impl === null) {
    out.push({ file: "src/bundler/Graph.rs", name: "impl OutstandingList", line: 0, complaints: ["not found"] });
  } else {
    const body = balanced(text, impl.index + impl[0].length - 1, "{", "}") ?? "";
    const complaints: string[] = [];
    if (/&\s*(?:mut\s+)?\*/.test(body)) complaints.push("impl reborrows a node");
    if (/\(\s*\*[^()]*\)\s*\.\s*\w+\s*\(/.test(body))
      complaints.push("impl calls a method on a dereferenced node (auto-borrows it whole)");
    for (const { line, params } of fnDefinitions(body, String.raw`(?:push|unlink)`)) {
      for (const param of splitParams(params)) {
        if (/\bself\b/.test(param)) continue;
        if (!/:\s*\*\s*mut\b/.test(param)) {
          complaints.push(`line ${lineOf(text, impl.index) + line - 1}: node parameter \`${param}\` is not \`*mut\``);
        }
      }
    }
    out.push({
      file: "src/bundler/Graph.rs",
      name: "impl OutstandingList",
      line: lineOf(text, impl.index),
      complaints,
    });
  }
  return out;
}

const FILES = [...new Set([...ENTRIES.map(e => e.file), "src/runtime/dispatch.rs", "src/bundler/Graph.rs"])];
const sources = new Map<string, string>();
for (const f of FILES) sources.set(f, stripCommentsAndStrings(await file(path.join(root, f)).text()));

const found: Found[] = [];
for (const entry of ENTRIES) found.push(...auditFn(entry, sources.get(entry.file)!));
found.push(...auditDispatchArms(sources.get("src/runtime/dispatch.rs")!));
found.push(...auditOutstandingList(sources.get("src/bundler/Graph.rs")!));

const offenders = found
  .filter(f => f.complaints.length)
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  .flatMap(f => f.complaints.map(c => `${f.file}:${f.line} (${f.name}): ${c}`));

test("the audited functions are still where this lint looks for them", () => {
  // A mismatch means a function in this population was added, removed, moved
  // or renamed: update ENTRIES (and the header) rather than the checks.
  const counts: Record<string, number> = {};
  for (const f of found) counts[`${f.file} ${f.name}`] = (counts[`${f.file} ${f.name}`] ?? 0) + 1;
  const expected: Record<string, number> = {
    "src/runtime/dispatch.rs BundleV2PluginResolve arm": 1,
    "src/runtime/dispatch.rs BundleV2PluginLoad arm": 1,
    "src/bundler/Graph.rs trait OutstandingNode": 1,
    "src/bundler/Graph.rs impl OutstandingList": 1,
  };
  for (const e of ENTRIES) expected[`${e.file} ${e.fn}`] = e.count;
  expect(counts).toEqual(expected);
});

test("the audit recognizes the shapes it claims to", () => {
  const complaintsOf = (entry: Omit<Entry, "file" | "count">, snippet: string) =>
    auditFn({ file: "x.rs", count: 1, ...entry }, stripCommentsAndStrings(snippet)).flatMap(f => f.complaints);
  const post = [
    (n: string) => new RegExp(String.raw`\bfrom_callback\(\s*${n}\s*,`),
    (n: string) => new RegExp(String.raw`\benqueue_task_concurrent_with_extra_ctx(?:::<[^(]*>)?\(\s*${n}\s*,`),
  ];

  // Conforming shapes, as in the tree now.
  expect(
    complaintsOf(
      { fn: "run_on_js_thread", selfIsRequest: true, handsOn: [n => new RegExp(String.raw`\b${n}\s*\.\s*cast\b`)] },
      `
      pub unsafe fn run_on_js_thread(this: *mut Self) {
          // SAFETY: prose mentioning &mut *this does not count.
          unsafe {
              let record = &(*this).import_record;
              let bv2 = &mut *(*this).bv2;
              bv2.plugins_mut().expect("plugins").match_on_resolve(
                  &record.specifier, this.cast::<core::ffi::c_void>(), record.kind,
              );
          }
      }`,
    ),
  ).toEqual([]);
  expect(
    complaintsOf(
      { fn: "on_load_async", handsOn: post },
      `
      pub unsafe fn on_load_async(&self, load: *mut jsc_api::JSBundler::Load) {
          match self.any_loop() {
              Js { .. } => { let ct = from_callback(load, on_load_from_js_loop_raw); }
              Mini(mini) => unsafe {
                  mini.enqueue_task_concurrent_with_extra_ctx::<jsc_api::JSBundler::Load, BundleV2<'static>>(
                      load, on_load_mini, core::mem::offset_of!(jsc_api::JSBundler::Load, task),
                  );
              },
          }
      }`,
    ),
  ).toEqual([]);
  expect(
    complaintsOf(
      { fn: "on_defer", selfIsRequest: true },
      `
      unsafe fn on_defer(load: *mut Load, global_object: &JSGlobalObject) -> JsResult<JSValue> {
          unsafe {
              (*load).called_defer = true;
              log!("JSBundlerPlugin__onDefer(0x{:x}, {})", load.addr(), bstr::BStr::new(&(*load).path));
              let parse_task = (*load).parse_task;
              let ctx = parse_task.ctx.expect("ParseTask.ctx unset");
              let value = core::mem::take(&mut (*load).value);
              (*load).value.consume();
              Ok(plugin.append_defer_promise())
          }
      }`,
    ),
  ).toEqual([]);
  expect(
    complaintsOf(
      { fn: "JSBundlerPlugin__addError", bodyNames: ["ctx", "resolve", "load"] },
      `
      unsafe extern "C" fn JSBundlerPlugin__addError(ctx: *mut c_void, plugin: *mut Plugin, which: JSValue) {
          let plugin = unsafe { &mut *plugin };
          match which.as_int32() {
              0 => { let resolve = ctx.cast::<Resolve>(); unsafe { (*resolve).value = v; bv2((*resolve).bv2).on_resolve_async(resolve); } }
              1 => { let load = ctx.cast::<Load>(); unsafe { (*load).value = v; bv2((*load).bv2).on_load_async(load); } }
              _ => panic!("invalid error type"),
          }
      }`,
    ),
  ).toEqual([]);
  // A request parameter next to a non-request one that may be reborrowed.
  expect(
    complaintsOf(
      { fn: "on_notify_defer_mini_wrap" },
      "fn on_notify_defer_mini_wrap(load: *mut Load, ctx: *mut BundleV2<'static>) { unsafe { BundleV2::on_notify_defer_mini(load, &mut *ctx) }; }",
    ),
  ).toEqual([]);

  // The shapes this lint was written against.
  expect(
    complaintsOf(
      { fn: "run_on_js_thread", selfIsRequest: true, handsOn: [n => new RegExp(String.raw`\b${n}\s*\.\s*cast\b`)] },
      `
      pub fn run_on_js_thread(&mut self) {
          let self_ptr = std::ptr::from_mut::<Self>(self).cast::<core::ffi::c_void>();
          unsafe { &mut *self.bv2 }.plugins_mut().expect("plugins").match_on_load(&self.path, self_ptr);
      }`,
    ),
  ).toEqual(["takes the request as a self receiver: `&mut self`", "body uses `self`"]);
  expect(
    complaintsOf(
      { fn: "on_load_async", handsOn: post },
      `
      pub fn on_load_async(&mut self, load: &mut jsc_api::JSBundler::Load) {
          match self.any_loop_mut() {
              Js { .. } => { let ct = from_callback(std::ptr::from_mut(load), on_load_from_js_loop_raw); }
              Mini(mini) => unsafe {
                  mini.enqueue_task_concurrent_with_extra_ctx::<jsc_api::JSBundler::Load, BundleV2<'static>>(
                      std::ptr::from_mut(load), on_load_mini, core::mem::offset_of!(jsc_api::JSBundler::Load, task),
                  );
              },
          }
      }`,
    ),
  ).toEqual([
    "takes the request as `load: &mut jsc_api::JSBundler::Load`, not `*mut`",
    "body makes a reference to `load`",
    `body does not hand \`load\` itself on (expected ${post[0]("load")})`,
    `body does not hand \`load\` itself on (expected ${post[1]("load")})`,
  ]);
  expect(
    complaintsOf(
      { fn: "on_notify_defer_mini" },
      "pub fn on_notify_defer_mini(load: &mut jsc_api::JSBundler::Load, this: &mut BundleV2) { load.deferred = true; }",
    ),
  ).toEqual(["takes the request as `load: &mut jsc_api::JSBundler::Load`, not `*mut`"]);
  expect(
    complaintsOf(
      { fn: "JSBundlerPlugin__onLoadAsync" },
      'extern "C" fn JSBundlerPlugin__onLoadAsync(this: &mut Load, _unused: *mut c_void) { this.value = LoadValue::NoMatch; }',
    ),
  ).toEqual(["takes the request as `this: &mut Load`, not `*mut`"]);
  expect(
    complaintsOf(
      { fn: "JSBundlerPlugin__onResolveAsync" },
      'unsafe extern "C" fn JSBundlerPlugin__onResolveAsync(resolve: *mut Resolve, _unused: *mut c_void) { let resolve = unsafe { &mut *resolve }; }',
    ),
  ).toEqual(["body reborrows `resolve`"]);
  expect(
    complaintsOf(
      { fn: "JSBundlerPlugin__onDefer" },
      'unsafe extern "C" fn JSBundlerPlugin__onDefer(load: *mut Load, global: *mut JSGlobalObject) -> JSValue { unsafe { to_js_host_call(&*global, || (&mut *load).on_defer(&*global)) } }',
    ),
  ).toEqual(["body reborrows `load`"]);
  // The trait-method form: a bodiless declaration plus the impl.
  expect(
    complaintsOf(
      { fn: "on_defer", selfIsRequest: true },
      `
      trait LoadJsExt {
          fn on_defer(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue>;
      }
      impl LoadJsExt for Load {
          fn on_defer(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
              self.called_defer = true;
              mini.enqueue_task_concurrent_with_extra_ctx::<Load, BundleV2<'static>>(std::ptr::from_mut::<Load>(self), cb, off);
          }
      }`,
    ),
  ).toEqual([
    "takes the request as a self receiver: `&mut self`",
    "takes the request as a self receiver: `&mut self`",
    "body uses `self`",
  ]);
  expect(
    complaintsOf(
      { fn: "JSBundlerPlugin__addError", bodyNames: ["ctx", "resolve", "load"] },
      'unsafe extern "C" fn JSBundlerPlugin__addError(ctx: *mut c_void) { let load = unsafe { bun_ptr::callback_ctx::<Load>(ctx) }; load.value = v; }',
    ),
  ).toEqual(["body goes through `callback_ctx` (a `&mut` to the request)"]);
  expect(
    complaintsOf(
      { fn: "on_notify_defer_mini_wrap" },
      "fn on_notify_defer_mini_wrap(load: *mut Load, ctx: *mut BundleV2<'static>) { BundleV2::on_notify_defer_mini(unsafe { &mut *load }, unsafe { &mut *ctx }); }",
    ),
  ).toEqual(["body reborrows `load`"]);
  // Raw parameter, but the body borrows the request whole again.
  expect(complaintsOf({ fn: "f" }, "unsafe fn f(load: *mut Load) { let l = &mut (*load); }")).toEqual([
    "body borrows `load` whole",
  ]);
  expect(complaintsOf({ fn: "f" }, "unsafe fn f(load: *mut Load) { (*load).bake_graph(); }")).toEqual([
    "body calls a method on `*load` (auto-borrows the whole request)",
  ]);
  expect(
    complaintsOf(
      { fn: "f" },
      "unsafe fn f(load: *mut Load) { (*load).value.consume(); x(&(*load).path, &mut (*load).value); }",
    ),
  ).toEqual([]);

  // The match arms.
  const arms = (snippet: string) => auditDispatchArms(stripCommentsAndStrings(snippet)).flatMap(f => f.complaints);
  expect(
    arms(`
      task_tag::BundleV2PluginLoad => {
          // SAFETY: as the Resolve arm.
          unsafe { Load::run_on_js_thread(cast_ptr!(bun_bundler::bundle_v2::api::JSBundler::Load)) };
      }
      task_tag::BundleV2PluginLoad => release!(bun_bundler::bundle_v2::api::JSBundler::Load),`),
  ).toEqual([]);
  expect(
    arms(`
      task_tag::BundleV2PluginLoad => {
          unsafe { &mut *cast_ptr!(bun_bundler::bundle_v2::api::JSBundler::Load) }.run_on_js_thread();
      }`),
  ).toEqual(["arm reborrows the request", "arm does not pass the queued pointer (`cast_ptr!`) to `run_on_js_thread`"]);
  expect(arms("task_tag::BundleV2PluginResolve => { cast!(Resolve).run_on_js_thread(); }")).toEqual([
    "arm uses `cast!` (forms `&mut` to the request)",
    "arm does not pass the queued pointer (`cast_ptr!`) to `run_on_js_thread`",
  ]);

  // The list.
  const list = (snippet: string) => auditOutstandingList(stripCommentsAndStrings(snippet)).flatMap(f => f.complaints);
  expect(
    list(`
      pub trait OutstandingNode: Sized {
          unsafe fn link_raw(this: *mut Self) -> *mut OutstandingLink<Self>;
      }
      impl<T: OutstandingNode> OutstandingList<T> {
          pub(crate) fn push(&mut self, node: *mut T) {
              unsafe {
                  let l = T::link_raw(node);
                  (*l).next = self.head;
                  if !self.head.is_null() { (*T::link_raw(self.head)).prev = node; }
              }
          }
          pub(crate) fn unlink(&mut self, node: *mut T) { unsafe { (*T::link_raw(node)).linked = false; } }
          pub(crate) fn pop(&mut self) -> Option<*mut T> { let head = self.head; self.unlink(head); Some(head) }
      }`),
  ).toEqual([]);
  expect(
    list(`
      pub trait OutstandingNode: Sized {
          fn link(&mut self) -> &mut OutstandingLink<Self>;
      }
      impl<T: OutstandingNode> OutstandingList<T> {
          pub(crate) fn push(&mut self, node: *mut T) {
              unsafe { let l = (*node).link(); l.next = self.head; (*self.head).link().prev = node; }
          }
          pub(crate) fn unlink(&mut self, node: &mut T) { let l = node.link(); }
          pub(crate) fn pop(&mut self) -> Option<*mut T> { self.unlink(unsafe { &mut *head }); Some(head) }
      }`),
  ).toEqual([
    "trait hands out a reference (receiver or return); the link must be reached as `*mut` from a `*mut Self`",
    "impl reborrows a node",
    "impl calls a method on a dereferenced node (auto-borrows it whole)",
    "line 9: node parameter `node: &mut T` is not `*mut`",
  ]);
});

test("an outstanding plugin request is only ever touched through its raw pointer, field by field", () => {
  expect(offenders).toEqual([]);
});
