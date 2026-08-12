import { file } from "bun";
import { beforeAll, expect, test } from "bun:test";
import path from "path";

// An outstanding bundler plugin request is only ever touched through its raw
// pointer, one field at a time.
//
// `api::JSBundler::Resolve` / `Load` (src/bundler/bundle_v2.rs) are the
// onResolve / onLoad requests a bundle pass hands to whatever runs the plugins
// (another thread under `Bun.build`, the same loop under bake; the code is
// shared). From `dispatch` until the answer is consumed, one request is in use
// on both sides at once, by field: the plugin side reads the fields set before
// dispatch and writes the answer (`value`, `called_defer`, the intrusive
// `task` node), while the request stays linked in the pass's
// `Graph::outstanding_*` list, and the pass side writes the link
// (`OutstandingList::push` of the next request writes the head's `prev`,
// `unlink` of an answered one writes its neighbours') and `Load::deferred`
// (`Graph::drain_deferred_tasks` on every linked load; `on_notify_defer_mini`
// when the pass runs on its own mini loop) whenever it likes. Under `Bun.build`
// this really is concurrent, and it is fine only because each side goes
// through the raw pointer and touches its own fields. A `&Load` / `&mut Load`
// (or `&Resolve`) formed on either side covers the other side's fields as
// well: as a function argument it is protected for the duration of the call,
// and the other side's write is then a foreign write to a protected tag, which
// Miri rejects under Tree Borrows (the model `bun run rust:miri` uses) and
// under Stacked Borrows. Timing adds one more rule: the answer may be consumed
// (and the request's buffers freed) the moment it is posted, and a plugin that
// answers synchronously posts it from inside `run_on_js_thread`'s call into the
// plugin, so nothing borrowed from the request may be an argument of that call
// or be touched after a post. This tree used to break all of this: `run_task`'s
// two arms formed `&mut *ptr`, `run_on_js_thread` / `on_defer` took `&mut self`
// and passed `&self.path` into the plugin call, `onLoadAsync` took `&mut Load`
// straight from C++, `addError` went through `callback_ctx`, `on_*_async` took
// `&mut` and held it across the post, `OutstandingNode::link(&mut self)`
// reborrowed the neighbours, and `on_notify_defer_mini` took `&mut Load`.
//
// Checked, for the population in ENTRIES plus the three structural audits
// below (the answer-side consumers `on_load` / `on_resolve` and the
// cancellation path own the request again and are deliberately not in it):
//
//   1. The request arrives as a `*mut Resolve` / `*mut Load` / `*mut Self`
//      parameter: not a `self` receiver, not a reference, and not an untyped
//      pointer either (an entry with no recognized request parameter fails,
//      unless it names the handles itself via `bodyNames`, as `addError`, which
//      gets a `*mut c_void` plus a discriminator, and `drain_deferred_tasks`,
//      which gets its loads from the list, do).
//   2. The body does not get at the whole request through that pointer or any
//      local rebound from it (`let x = req;`, `let x = req.cast::<Load>();`):
//      no `&mut *req` / `&*req` / `&(*req)` (`&(*req).field` is the point and is
//      fine), no `ptr::from_mut(req)` / `NonNull`, no `req.as_mut()` /
//      `as_ref()`, no whole-struct `req.read()` / `write()` / `replace()` /
//      `*req = ..`, no method call on `(*req)` (which auto-borrows the whole
//      request; rustc's `dangerous_implicit_autorefs` only catches the variant
//      that goes through an overloaded `Deref`, such as a `BackRef` field, which
//      is why those are copied out first), no `callback_ctx`.
//   3. Where the request is handed on (as the context cookie, to the post-back,
//      to the notify) the body passes the pointer it received, and the call
//      that enters the plugin (`match_on_*`) takes no `&` arguments at all.
//   4. `OutstandingNode::link_raw` is a raw projection (both impls, and the
//      trait hands out no references), and `OutstandingList` never reborrows a
//      node; `run_task`'s two arms pass the queued pointer on.
//
// Enforcement boundary: these are per-function text checks. A helper that
// takes the pointer and forms the reference inside is outside them, as is any
// spelling not listed in referenceForming(); if you add one, add it there and
// to the self-test. The pass itself (`bv2`) is a different object and not
// covered: how the hops and thunks reach it is bundler-plugin-hops-raw-pass /
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
   * the request. (For `BundleV2` / `Graph` methods `self` is something else.)
   */
  selfIsRequest?: boolean;
  /** Body identifiers holding the request, for functions that do not get it as a typed parameter. */
  bodyNames?: string[];
  /**
   * Each is given the request parameter's name and must match the body: the
   * places the request is handed on, which must receive that very pointer.
   */
  handsOn?: ((name: string) => RegExp)[];
  /** A call the body must make, and whose argument list must contain no `&`. */
  callWithoutBorrows?: RegExp;
};

const REQUEST_TYPE = /\b(?:Resolve|Load|Self)\b/;

const POST = [
  (n: string) => new RegExp(String.raw`\bfrom_callback\(\s*${n}\s*,`),
  (n: string) => new RegExp(String.raw`\benqueue_task_concurrent_with_extra_ctx(?:::<[^(]*>)?\(\s*${n}\s*,`),
];

const ENTRIES: Entry[] = [
  // Plugin side: the hop that calls into the plugin, passing the request as
  // the context cookie C++ later hands back to the answer thunks. Its call
  // into the plugin may answer before it returns.
  {
    file: "src/bundler/bundle_v2.rs",
    fn: "run_on_js_thread",
    count: 2,
    selfIsRequest: true,
    handsOn: [n => new RegExp(String.raw`\b${n}\s*\.\s*cast\b`)],
    callWithoutBorrows: /\bmatch_on_(?:load|resolve)\b/,
  },
  // Plugin side: the answer is posted back through the same pointer.
  { file: "src/bundler/bundle_v2.rs", fn: "on_load_async", count: 1, handsOn: POST },
  { file: "src/bundler/bundle_v2.rs", fn: "on_resolve_async", count: 1, handsOn: POST },
  // Pass side, while the loads' callbacks are parked in `.defer()`.
  { file: "src/bundler/bundle_v2.rs", fn: "on_notify_defer_mini", count: 1 },
  { file: "src/bundler/Graph.rs", fn: "drain_deferred_tasks", count: 1, bodyNames: ["load"] },
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
  { file: "src/runtime/api/JSBundler.rs", fn: "on_defer", count: 1, selfIsRequest: true, handsOn: [POST[1]] },
  // `ctx` is the cookie; the `let resolve = ctx.cast::<Resolve>()` /
  // `let load = ..` locals are picked up as rebindings of it.
  { file: "src/runtime/api/JSBundler.rs", fn: "JSBundlerPlugin__addError", count: 1, bodyNames: ["ctx"] },
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
    // A trait declaration (`fn f(&mut self) -> T;`) has no body; its
    // signature is still audited.
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

/**
 * `names`, plus every local the body binds straight from one of them:
 * `let x = req;`, `let x: T = req;`, `let x = req.cast::<Load>();`,
 * `let x = req as *mut Load;`. Iterates so a rebinding of a rebinding counts.
 */
function withRebindings(body: string, names: readonly string[]): string[] {
  const all = [...names];
  for (let i = 0; i < all.length; i++) {
    const source = String.raw`\b${all[i]}\b(?:\s*\.\s*cast(?:::<[^>]*>)?\(\s*\)|\s+as\s+[^;]+)?`;
    const rebind = new RegExp(String.raw`\blet\s+(?:mut\s+)?(\w+)(?:\s*:[^=;]+)?\s*=\s*${source}\s*;`, "g");
    for (const m of body.matchAll(rebind)) if (!all.includes(m[1])) all.push(m[1]);
  }
  return all;
}

/** The ways a body can get at the whole request held in `name`. */
function referenceForming(name: string): { what: string; pattern: RegExp }[] {
  const n = String.raw`\b${name}\b`;
  const turbofish = String.raw`(?:::<[^>]*>)?`;
  return [
    { what: `reborrows \`${name}\``, pattern: new RegExp(String.raw`&\s*(?:mut\s+)?\*\s*${n}`) },
    {
      what: `borrows \`${name}\` whole`,
      pattern: new RegExp(String.raw`&\s*(?:mut\s+)?\(\s*\*\s*${n}\s*\)(?!\s*\.)`),
    },
    {
      what: `makes a reference (or NonNull) to \`${name}\``,
      pattern: new RegExp(
        String.raw`\bfrom_(?:mut|ref)${turbofish}\(\s*${n}\s*\)|\bNonNull\s*::\s*(?:from|new|new_unchecked)\(\s*${n}\s*\)|${n}\s*\.\s*as_(?:ref|mut)\s*\(`,
      ),
    },
    {
      what: `reads or writes \`${name}\` as a whole`,
      pattern: new RegExp(
        String.raw`${n}\s*\.\s*(?:read|write|replace|swap|drop_in_place)(?:_\w+)?${turbofish}\s*\(|\b(?:read|write|replace|swap|drop_in_place)(?:_\w+)?${turbofish}\(\s*${n}\s*[,)]|\*\s*${n}\s*=[^=]`,
      ),
    },
    {
      what: `calls a method on \`*${name}\` (auto-borrows the whole request)`,
      pattern: new RegExp(String.raw`\(\s*\*\s*${n}\s*\)\s*\.\s*\w+\s*${turbofish}\s*\(`),
    },
  ];
}

function auditFn(entry: Entry, text: string): Found[] {
  return fnDefinitions(text, entry.fn).map(({ line, params, body }) => {
    const complaints: string[] = [];
    const paramNames: string[] = [];
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
      paramNames.push(pname);
    }
    const seeds = [...paramNames, ...(entry.bodyNames ?? [])];
    if (seeds.length === 0 && complaints.length === 0) {
      complaints.push("has no `*mut Resolve` / `*mut Load` / `*mut Self` parameter (and no `bodyNames`)");
    }
    if (body === null) {
      if (complaints.length === 0) complaints.push("could not find the body");
      return { file: entry.file, name: entry.fn, line, complaints };
    }
    if (entry.selfIsRequest && /\bself\b/.test(body)) complaints.push("body uses `self`");
    if (/\bcallback_ctx\b/.test(body)) complaints.push("body goes through `callback_ctx` (a `&mut` to the request)");
    for (const name of withRebindings(body, seeds)) {
      for (const { what, pattern } of referenceForming(name)) {
        if (pattern.test(body)) complaints.push(`body ${what}`);
      }
    }
    const [request] = paramNames;
    if (entry.handsOn && request !== undefined) {
      for (const make of entry.handsOn) {
        const pattern = make(request);
        if (!pattern.test(body)) complaints.push(`body does not hand \`${request}\` itself on (expected ${pattern})`);
      }
    }
    if (entry.callWithoutBorrows) {
      const call = entry.callWithoutBorrows.exec(body);
      const args = call === null ? null : balanced(body, body.indexOf("(", call.index + call[0].length), "(", ")");
      if (args === null) complaints.push(`body does not call ${entry.callWithoutBorrows}`);
      else if (args.includes("&")) {
        complaints.push(`body passes a borrow into \`${call![0]}\`, which may answer the request before it returns`);
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
 * the nodes it touches are out with the plugins while it does.
 */
function auditOutstandingList(text: string): Found[] {
  const out: Found[] = [];
  const trait = /\btrait\s+OutstandingNode\b[^{]*\{/.exec(text);
  if (trait === null) {
    out.push({ file: "src/bundler/Graph.rs", name: "trait OutstandingNode", line: 0, complaints: ["not found"] });
  } else {
    const body = balanced(text, trait.index + trait[0].length - 1, "{", "}") ?? "";
    const complaints: string[] = [];
    if (/&/.test(body)) {
      complaints.push(
        "trait hands out a reference (receiver or return); the link must be reached as `*mut` from a `*mut Self`",
      );
    }
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
    if (/\(\s*\*[^()]*\)\s*\.\s*\w+\s*\(/.test(body)) {
      complaints.push("impl calls a method on a dereferenced node (auto-borrows it whole)");
    }
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

/**
 * src/bundler/bundle_v2.rs: the two `OutstandingNode` impls. `link_raw` has to
 * be a raw projection (`&raw mut (*this).outstanding`); going through
 * `&mut *this` or `&mut (*this).outstanding` on the way would reintroduce the
 * reference the trait exists to avoid.
 */
function auditOutstandingNodeImpls(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(/\bimpl\s+(?:[\w:]*::)?OutstandingNode\s+for\s+(\w+)\s*\{/g)) {
    const body = balanced(text, m.index + m[0].length - 1, "{", "}");
    const complaints: string[] = [];
    if (body === null) complaints.push("could not find the body");
    else if (/&(?!\s*raw\b)/.test(body)) complaints.push("impl forms a reference instead of a raw projection");
    out.push({
      file: "src/bundler/bundle_v2.rs",
      name: `impl OutstandingNode for ${m[1]}`,
      line: lineOf(text, m.index),
      complaints,
    });
  }
  return out;
}

const FILES = [...new Set([...ENTRIES.map(e => e.file), "src/runtime/dispatch.rs"])];

// Read inside the suite rather than at module scope, so a moved or renamed
// source file shows up as a failing test instead of a file that failed to load.
let found: Found[] = [];
let offenders: string[] = [];
beforeAll(async () => {
  const sources = new Map<string, string>();
  for (const f of FILES) sources.set(f, stripCommentsAndStrings(await file(path.join(root, f)).text()));

  found = ENTRIES.flatMap(entry => auditFn(entry, sources.get(entry.file)!));
  found.push(...auditDispatchArms(sources.get("src/runtime/dispatch.rs")!));
  found.push(...auditOutstandingList(sources.get("src/bundler/Graph.rs")!));
  found.push(...auditOutstandingNodeImpls(sources.get("src/bundler/bundle_v2.rs")!));

  offenders = found
    .filter(f => f.complaints.length)
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .flatMap(f => f.complaints.map(c => `${f.file}:${f.line} (${f.name}): ${c}`));
});

test("the audited functions are still where this lint looks for them", () => {
  // A mismatch means something in this population was added, removed, moved
  // or renamed: update ENTRIES (and the header) rather than the checks.
  const counts: Record<string, number> = {};
  for (const f of found) counts[`${f.file} ${f.name}`] = (counts[`${f.file} ${f.name}`] ?? 0) + 1;
  const expected: Record<string, number> = {
    "src/runtime/dispatch.rs BundleV2PluginResolve arm": 1,
    "src/runtime/dispatch.rs BundleV2PluginLoad arm": 1,
    "src/bundler/Graph.rs trait OutstandingNode": 1,
    "src/bundler/Graph.rs impl OutstandingList": 1,
    "src/bundler/bundle_v2.rs impl OutstandingNode for Load": 1,
    "src/bundler/bundle_v2.rs impl OutstandingNode for Resolve": 1,
  };
  for (const e of ENTRIES) expected[`${e.file} ${e.fn}`] = e.count;
  expect(counts).toEqual(expected);
});

test("the audit recognizes the shapes it claims to", () => {
  const complaintsOf = (entry: Omit<Entry, "file" | "count">, snippet: string) =>
    auditFn({ file: "x.rs", count: 1, ...entry }, stripCommentsAndStrings(snippet)).flatMap(f => f.complaints);
  const hop: Omit<Entry, "file" | "count"> = {
    fn: "run_on_js_thread",
    selfIsRequest: true,
    handsOn: [n => new RegExp(String.raw`\b${n}\s*\.\s*cast\b`)],
    callWithoutBorrows: /\bmatch_on_(?:load|resolve)\b/,
  };

  // Conforming shapes, as in the tree now.
  expect(
    complaintsOf(
      hop,
      `
      pub unsafe fn run_on_js_thread(this: *mut Self) {
          // SAFETY: prose mentioning &mut *this does not count.
          unsafe {
              let (path, namespace, kind) = {
                  let record = &(*this).import_record;
                  (BunString::clone_utf8(&record.specifier), Plugin::resolve_namespace(&record.namespace), record.kind)
              };
              let bv2 = &mut *(*this).bv2;
              bv2.plugins_mut().expect("plugins").match_on_resolve(path, namespace, this.cast::<core::ffi::c_void>(), kind);
          }
      }`,
    ),
  ).toEqual([]);
  expect(
    complaintsOf(
      { fn: "on_load_async", handsOn: POST },
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
      { fn: "JSBundlerPlugin__addError", bodyNames: ["ctx"] },
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
  expect(
    complaintsOf(
      { fn: "drain_deferred_tasks", bodyNames: ["load"] },
      `
      pub(crate) fn drain_deferred_tasks(&mut self, transpiler: &mut BundleV2) -> bool {
          self.outstanding_loads.for_each(|load| {
              unsafe { (*load).deferred = false };
          });
          transpiler.drain_defer_task.schedule();
          true
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
  // Field-scoped access of every kind is fine.
  expect(
    complaintsOf(
      { fn: "f" },
      "unsafe fn f(load: *mut Load) { (*load).value.consume(); x(&(*load).path, &mut (*load).value); (*load).deferred = true; let p = &raw mut (*load).outstanding; }",
    ),
  ).toEqual([]);

  // The shapes this lint was written against.
  expect(
    complaintsOf(
      hop,
      `
      pub fn run_on_js_thread(&mut self) {
          let self_ptr = std::ptr::from_mut::<Self>(self).cast::<core::ffi::c_void>();
          unsafe { &mut *self.bv2 }.plugins_mut().expect("plugins").match_on_load(&self.path, &self.namespace, self_ptr);
      }`,
    ),
  ).toEqual([
    "takes the request as a self receiver: `&mut self`",
    "body uses `self`",
    "body passes a borrow into `match_on_load`, which may answer the request before it returns",
  ]);
  // Raw parameter, but a borrow of the request is still an argument of the plugin call.
  expect(
    complaintsOf(
      hop,
      "pub unsafe fn run_on_js_thread(this: *mut Self) { unsafe { plugin.match_on_load(&(*this).path, &(*this).namespace, this.cast::<c_void>(), loader) } }",
    ),
  ).toEqual(["body passes a borrow into `match_on_load`, which may answer the request before it returns"]);
  expect(
    complaintsOf(hop, "pub unsafe fn run_on_js_thread(this: *mut Self) { let _ = this.cast::<c_void>(); }"),
  ).toEqual(["body does not call /\\bmatch_on_(?:load|resolve)\\b/"]);
  expect(
    complaintsOf(
      { fn: "on_load_async", handsOn: POST },
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
    "body makes a reference (or NonNull) to `load`",
    `body does not hand \`load\` itself on (expected ${POST[0]("load")})`,
    `body does not hand \`load\` itself on (expected ${POST[1]("load")})`,
  ]);
  expect(
    complaintsOf(
      { fn: "on_notify_defer_mini" },
      "pub fn on_notify_defer_mini(load: &mut jsc_api::JSBundler::Load, this: &mut BundleV2) { load.deferred = true; }",
    ),
  ).toEqual(["takes the request as `load: &mut jsc_api::JSBundler::Load`, not `*mut`"]);
  expect(
    complaintsOf(
      { fn: "drain_deferred_tasks", bodyNames: ["load"] },
      `
      pub(crate) fn drain_deferred_tasks(&mut self, transpiler: &mut BundleV2) -> bool {
          let mut load = self.outstanding_loads.head;
          while !load.is_null() {
              let l = unsafe { &mut *load };
              l.deferred = false;
              load = l.outstanding.next;
          }
          true
      }`,
    ),
  ).toEqual(["body reborrows `load`"]);
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
      { fn: "JSBundlerPlugin__addError", bodyNames: ["ctx"] },
      'unsafe extern "C" fn JSBundlerPlugin__addError(ctx: *mut c_void) { let load = unsafe { bun_ptr::callback_ctx::<Load>(ctx) }; load.value = v; }',
    ),
  ).toEqual(["body goes through `callback_ctx` (a `&mut` to the request)"]);
  expect(
    complaintsOf(
      { fn: "on_notify_defer_mini_wrap" },
      "fn on_notify_defer_mini_wrap(load: *mut Load, ctx: *mut BundleV2<'static>) { BundleV2::on_notify_defer_mini(unsafe { &mut *load }, unsafe { &mut *ctx }); }",
    ),
  ).toEqual(["body reborrows `load`"]);

  // Evasions of the raw parameter: retyping it, rebinding it, or getting at
  // the whole request through pointer methods.
  expect(
    complaintsOf(
      { fn: "JSBundlerPlugin__onLoadAsync" },
      'unsafe extern "C" fn JSBundlerPlugin__onLoadAsync(this: *mut c_void, _unused: *mut c_void) { let this = unsafe { &mut *this.cast::<Load>() }; this.value = v; }',
    ),
  ).toEqual(["has no `*mut Resolve` / `*mut Load` / `*mut Self` parameter (and no `bodyNames`)"]);
  expect(
    complaintsOf(
      { fn: "on_notify_defer_mini" },
      "pub fn on_notify_defer_mini(&mut self, this: &mut BundleV2) { self.deferred = true; }",
    ),
  ).toEqual(["has no `*mut Resolve` / `*mut Load` / `*mut Self` parameter (and no `bodyNames`)"]);
  expect(
    complaintsOf(
      { fn: "f" },
      "unsafe fn f(this: *mut Load) { let l = unsafe { this.as_mut() }.unwrap(); l.value = v; }",
    ),
  ).toEqual(["body makes a reference (or NonNull) to `this`"]);
  expect(
    complaintsOf({ fn: "f" }, "unsafe fn f(this: *mut Self) { let me = unsafe { this.as_ref() }.unwrap(); }"),
  ).toEqual(["body makes a reference (or NonNull) to `this`"]);
  expect(
    complaintsOf({ fn: "f" }, "unsafe fn f(this: *mut Load) { let load = this; let l = unsafe { &mut *load }; }"),
  ).toEqual(["body reborrows `load`"]);
  expect(
    complaintsOf({ fn: "f" }, "unsafe fn f(ctx: *mut c_void) { let load = ctx.cast::<Load>(); let l = &mut *load; }"),
  ).toEqual(["has no `*mut Resolve` / `*mut Load` / `*mut Self` parameter (and no `bodyNames`)"]);
  expect(
    complaintsOf(
      { fn: "f", bodyNames: ["ctx"] },
      "unsafe fn f(ctx: *mut c_void) { let load = ctx.cast::<Load>(); let again = load; let l = &mut *again; }",
    ),
  ).toEqual(["body reborrows `again`"]);
  expect(
    complaintsOf(
      { fn: "f" },
      "unsafe fn f(load: *mut Load) { let p = load as *mut Load; let r = NonNull::new(p).unwrap(); }",
    ),
  ).toEqual(["body makes a reference (or NonNull) to `p`"]);
  expect(complaintsOf({ fn: "f" }, "unsafe fn f(load: *mut Load) { load.write(Load::default()); }")).toEqual([
    "body reads or writes `load` as a whole",
  ]);
  expect(complaintsOf({ fn: "f" }, "unsafe fn f(load: *mut Load) { let l = load.read(); }")).toEqual([
    "body reads or writes `load` as a whole",
  ]);
  expect(complaintsOf({ fn: "f" }, "unsafe fn f(load: *mut Load) { core::ptr::drop_in_place(load); }")).toEqual([
    "body reads or writes `load` as a whole",
  ]);
  expect(complaintsOf({ fn: "f" }, "unsafe fn f(load: *mut Load) { *load = Load::default(); }")).toEqual([
    "body reads or writes `load` as a whole",
  ]);
  expect(complaintsOf({ fn: "f" }, "unsafe fn f(load: *mut Load) { let l = &mut (*load); }")).toEqual([
    "body borrows `load` whole",
  ]);
  expect(complaintsOf({ fn: "f" }, "unsafe fn f(load: *mut Load) { (*load).bake_graph(); }")).toEqual([
    "body calls a method on `*load` (auto-borrows the whole request)",
  ]);

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
          pub(crate) fn for_each(&self, mut f: impl FnMut(*mut T)) { let next = unsafe { (*T::link_raw(self.head)).next }; f(self.head); }
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

  // The node impls.
  const impls = (snippet: string) =>
    auditOutstandingNodeImpls(stripCommentsAndStrings(snippet)).flatMap(f => f.complaints);
  expect(
    impls(`
      impl crate::Graph::OutstandingNode for Load {
          unsafe fn link_raw(this: *mut Self) -> *mut crate::Graph::OutstandingLink<Self> {
              // SAFETY: prose about &mut *this does not count.
              unsafe { &raw mut (*this).outstanding }
          }
      }`),
  ).toEqual([]);
  expect(
    impls(`
      impl OutstandingNode for Load {
          unsafe fn link_raw(this: *mut Self) -> *mut OutstandingLink<Self> {
              let node: &mut Self = unsafe { &mut *this };
              &mut node.outstanding
          }
      }`),
  ).toEqual(["impl forms a reference instead of a raw projection"]);
  expect(
    impls(
      "impl OutstandingNode for Load { unsafe fn link_raw(this: *mut Self) -> *mut Link<Self> { unsafe { &mut (*this).outstanding } } }",
    ),
  ).toEqual(["impl forms a reference instead of a raw projection"]);
});

test("outstanding plugin requests are reached only as raw pointers, field by field, in every audited function", () => {
  expect(offenders).toEqual([]);
});
