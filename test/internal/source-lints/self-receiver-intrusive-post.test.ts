import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A method must not post its own receiver through the intrusive task it
// embeds. Inside a `&self` / `&mut self` method, the receiver's address
//
//   self.concurrent_task.from(std::ptr::from_mut(self), AutoDeinit::ManualDeinit)
//   let p: *mut Self = self; ... self.concurrent_task.from(p, ..)
//   fn post(&mut self, p: *mut Self) { self.concurrent_task.from(p, ..) }   // p is self, by contract
//
// as the first argument of the intrusive `.from(..)` initializer
// (`ConcurrentTask::from`, `AnyTaskWithExtraContext::from`: "make the task
// embedded in this object carry this object") is banned.
//
// The `.from(..)` is the start of the hand-over: the task it fills in is
// posted next, and from the moment the post lands the consumer owns the
// object. For the pool-thread completions that use this form the consumer is
// the JS thread, and what it does with the object is usually to free it
// (`napi_async_work`: the addon's `complete` callback calls
// `napi_delete_async_work`; the S3 and shell tasks `heap::take` themselves),
// while the `&mut self` of the method that posted is still a live argument.
// A reference argument is protected for the duration of its call, and
// writing to or deallocating protected memory is UB under both aliasing
// models whether or not the method touches `self` again: Tree Borrows (what
// `bun run rust:miri` uses) reports "deallocation through <tag> is forbidden
// ... the strongly protected tag disallows deallocations", pointing at the
// receiver, and Stacked Borrows reports "deallocating while item [Unique] is
// strongly protected". Codegen relies on the same thing: the argument is
// annotated dereferenceable for the whole call. `napi_async_work::run(&mut
// self)` / `post_to_js_thread(&mut self, self_ptr: *mut Self)` were the
// instance this was written for: every async work completion posted the work
// from inside two such frames.
//
// The object was a raw pointer before it became `self` (the work-pool task
// pointer, the callback ctx), so the fix is to keep it one: the function that
// posts takes `this: *mut Self`, reads what it needs through statement-scoped
// `(*this).field` accesses, clones the handle it posts through out of the
// object (posting through `(*this).loop_handle` would protect a reference
// into the allocation for the duration of the post, the same bug one level
// down), and ends with `(*this).concurrent_task.from(this, ..)`. Templates:
// `napi_async_work::run` in src/runtime/napi/napi_body.rs,
// `S3HttpSimpleTask::http_callback` in src/runtime/webcore/s3/simple_request.rs,
// `ShellAsyncTask` in src/runtime/shell/states/Async.rs.
//
// Scope: the `.from(` initializer with the receiver's address as its first
// argument, where "the receiver's address" is one of the spellings below
// (applied to `self` or to a reborrow of it), a local of the same function
// bound to one, or a parameter of a method that also has a reference receiver
// and is typed as a raw pointer to the method's own type, spelled `Self` or by
// the enclosing impl's name (the only thing such a parameter can be is the
// receiver, handed in separately because the reference cannot be posted). The
// spelling list is the same one self-receiver-reclaim.test.ts uses; a change
// to one belongs in the other too. The heap-task constructors
// (`Task::init`, `ConcurrentTask::create_from`, `from_callback`) are the same
// hazard in a different spelling and a separate population (#37723); a
// pointer produced by a helper (`self.as_ptr()`) and reference parameters
// other than `self` are outside this lint. Siblings:
// self-receiver-reclaim.test.ts, fn-long-mut-reborrow.test.ts,
// frozen-nonnull-reborrow.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

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

// The intrusive initializer: a method call, so `Foo::from(x)` (a `From` impl)
// does not count. `\s*` around the paren so a rustfmt-wrapped call still
// matches.
const POST = String.raw`\.\s*from\s*\(\s*`;

// Pointer-to-pointer conversions that keep the address: `.cast()`,
// `.cast_mut()`, `.as_ptr()` (how a `NonNull` binding is passed).
const SAME_ADDRESS = String.raw`(?:\s*\.\s*(?:cast(?:_mut|_const)?(?:::<[^>]*>)?|as_ptr)\(\))*`;

// `self` or a reborrow of it (`&mut *self`, `&*self`), as the operand of the
// pointer conversions below. `(?!\s*\.)` keeps `&mut *self.field` (something
// the receiver owns) out.
const SELF_OPERAND = String.raw`(?:&\s*(?:mut\s+)?\*\s*)?self\b(?!\s*\.)`;

// The conversions that turn the receiver into its address. Shared between the
// inline and the `let`-bound forms below; the self-test at the bottom pins
// each spelling. `(?!\s*\.)` after the reborrow forms keeps `&raw mut
// *self.field` out, as above.
const ADDRESS_OF_SELF = [
  String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*${SELF_OPERAND}\s*\)`,
  String.raw`(?:[\w:]+::)?NonNull::from\(\s*${SELF_OPERAND}\s*\)`,
  String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
  String.raw`&\s*(?:raw\s+(?:mut|const)|mut)\s+\*\s*self\b(?!\s*\.)`,
];

// Inline: one of the conversions, `self as *mut _`, or bare `self` (a `&mut
// Self` coerces to `*mut Self` at the call; it needs the `,` / `)` so
// `self.field` does not match).
const SELF_AS_POINTER = [...ADDRESS_OF_SELF, String.raw`self\s+as\s+\*(?:mut|const)\b`, String.raw`self\s*[,)]`].join(
  "|",
);

const DIRECT = new RegExp(`${POST}(?:${SELF_AS_POINTER})`, "g");

// A local bound to the receiver's address: `let p = ptr::from_mut(self);`,
// `let p = NonNull::from(&mut *self);`, `let p = self as *mut Self;`, or the
// coercion spelling `let p: *mut Self = self;` (which needs the annotation;
// without it `let p = self;` is just another reference).
const BINDING_HEAD = String.raw`let\s+(?:mut\s+)?(\w+)\s*`;
const SELF_POINTER_BINDINGS = [
  new RegExp(
    BINDING_HEAD +
      String.raw`(?::[^=;]*)?=\s*(?:` +
      [...ADDRESS_OF_SELF, String.raw`self\s+as\s+\*(?:mut|const)\b[^;.]*`].join("|") +
      String.raw`)${SAME_ADDRESS}\s*;`,
    "g",
  ),
  new RegExp(BINDING_HEAD + String.raw`:\s*\*(?:mut|const)\b[^=;]*=\s*self\s*;`, "g"),
];

// A function item, however qualified. Also where the previous function's
// body is taken to end (a closure inside a function is part of it for this
// purpose). Two instances because a `g` regex carries its position between
// uses: `FN_ITEMS` is only ever iterated with `matchAll`, `FN_ITEM` only used
// with `search`.
const FN_ITEM_SOURCE = String.raw`^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern\s+"[^"]*")\s+)*fn\s+\w+`;
const FN_ITEM = new RegExp(FN_ITEM_SOURCE, "m");
const FN_ITEMS = new RegExp(FN_ITEM_SOURCE, "gm");
const RECEIVER_PARAM = /^\s*(?:&(?:'\w+\s+)?(?:mut\s+)?self\b|(?:mut\s+)?self\s*:\s*(?:&|Pin<))/;

// `impl Foo`, `impl<T> Foo<T>`, `impl Trait for Foo`: the type `Self` stands
// for in the methods that follow, so a parameter typed `*mut Foo` inside them
// counts like `*mut Self`. A `trait` item starts a region where only `Self`
// is known.
const IMPL_OR_TRAIT_ITEMS =
  /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:impl(?:<[^>]*>)?\s+(?:[\w:]+(?:<[^>]*>)?\s+for\s+)?([\w:]+)|trait\s+\w+)/gm;

/** A parameter typed `*mut Self` / `*const Self` (or the enclosing impl's type), capturing its name. */
function selfPointerParams(implType: string | null): RegExp {
  const types = implType === null ? String.raw`Self\b(?!\s*::)` : String.raw`(?:Self\b(?!\s*::)|${implType}\b)`;
  return new RegExp(String.raw`\b(\w+)\s*:\s*\*(?:mut|const)\s+${types}`, "g");
}

function postOf(name: string): RegExp {
  return new RegExp(POST + String.raw`\b${name}\b${SAME_ADDRESS}\s*[,)]`);
}

/** The text after `offset` up to the next function item. */
function restOfFunction(stripped: string, offset: number): string {
  const rest = stripped.slice(offset);
  const end = rest.search(FN_ITEM);
  return end === -1 ? rest : rest.slice(0, end);
}

/** For each `impl` / `trait` item: where it starts and the implementing type's last path segment (null for traits). */
function implRegions(stripped: string): { start: number; implType: string | null }[] {
  return [...stripped.matchAll(IMPL_OR_TRAIT_ITEMS)].map(m => ({
    start: m.index,
    implType: m[1] === undefined ? null : m[1].slice(m[1].lastIndexOf(":") + 1),
  }));
}

/**
 * For every method with a reference receiver and a parameter that is a raw
 * pointer to its own type: the parameter names and the offset of the
 * method's body.
 */
function* receiverTwice(stripped: string): Generator<{ names: string[]; bodyStart: number }> {
  const regions = implRegions(stripped);
  for (const item of stripped.matchAll(FN_ITEMS)) {
    const region = regions.findLast(r => r.start < item.index);
    let i = item.index + item[0].length;
    // Skip the generic parameter list, which may itself contain parens
    // (`fn f<F: Fn(u8) -> u8>(`); `->` inside it is not a closing angle.
    if (/^\s*</.test(stripped.slice(i, i + 16))) {
      for (let depth = 0; i < stripped.length; i++) {
        const c = stripped[i];
        if (c === "<") depth++;
        else if (c === ">" && stripped[i - 1] !== "-" && --depth === 0) {
          i++;
          break;
        }
      }
    }
    const paramsOpen = stripped.indexOf("(", i);
    if (paramsOpen === -1 || stripped.slice(i, paramsOpen).trim() !== "") continue;
    // Parameter types may contain parens too (`cb: fn(*mut Task)`), so find
    // the list's own closing paren by depth.
    let close = -1;
    for (let depth = 0, j = paramsOpen; j < stripped.length; j++) {
      const c = stripped[j];
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        close = j;
        break;
      }
    }
    if (close === -1) continue;
    const params = stripped.slice(paramsOpen + 1, close);
    if (!RECEIVER_PARAM.test(params)) continue;
    const names = [...params.matchAll(selfPointerParams(region?.implType ?? null))].map(m => m[1]);
    if (names.length > 0) yield { names, bodyStart: close + 1 };
  }
}

/** Byte offsets (into `stripped`) of every banned post in one file. */
function findPosts(stripped: string): number[] {
  const hits = new Set<number>();
  for (const m of stripped.matchAll(DIRECT)) hits.add(m.index);
  for (const pattern of SELF_POINTER_BINDINGS) {
    for (const binding of stripped.matchAll(pattern)) {
      const start = binding.index + binding[0].length;
      const post = restOfFunction(stripped, start).search(postOf(binding[1]));
      if (post !== -1) hits.add(start + post);
    }
  }
  for (const { names, bodyStart } of receiverTwice(stripped)) {
    const body = restOfFunction(stripped, bodyStart);
    for (const name of names) {
      const post = body.search(postOf(name));
      if (post !== -1) hits.add(bodyStart + post);
    }
  }
  return [...hits].sort((a, b) => a - b);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape, with a stated reason. Empty by design: the whole tree is at zero.
// Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {};

const counts: Record<string, number> = {};
const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions (including the in-tree comments
  // describing this hazard) don't count. `[ \t]*`, not `\s*`: `\s` crosses
  // newlines and would swallow blank lines, shifting the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const offset of findPosts(stripped)) {
    counts[source] = (counts[source] ?? 0) + 1;
    if (counts[source] > (ALLOW[source] ?? 0)) {
      offenders.push(`${source}:${lineOf(stripped, offset)}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the patterns match the banned spellings and nothing else", () => {
  const banned = [
    // `napi_async_work::run` / `post_to_js_thread` as they were: the address
    // is taken in one method and posted by the other, which receives it next
    // to its own `&mut self`. One hit, at the post.
    [
      "    fn run(&mut self) {",
      "        let self_ptr: *mut Self = self;",
      "        let handle = self.loop_handle.clone();",
      "        (self.execute)(self.env.get(), self.data);",
      "        self.post_to_js_thread(self_ptr);",
      "        handle.embedded_work_finished();",
      "    }",
      "",
      "    fn post_to_js_thread(&mut self, self_ptr: *mut Self) {",
      "        let ct = core::ptr::NonNull::from(",
      "            self.concurrent_task",
      "                .from(self_ptr, AutoDeinit::ManualDeinit),",
      "        );",
      "        let Posted::Queued = self.loop_handle.post_task(ct) else { unreachable!() };",
      "    }",
    ].join("\n"),
    // The same two methods with the parameter typed by the impl's name
    // instead of `Self`.
    [
      "impl napi_async_work {",
      "    fn run(&mut self) {",
      "        let self_ptr: *mut napi_async_work = self;",
      "        self.post_to_js_thread(self_ptr);",
      "    }",
      "",
      "    fn post_to_js_thread(&mut self, work: *mut napi_async_work) {",
      "        let ct = NonNull::from(self.concurrent_task.from(work, AutoDeinit::ManualDeinit));",
      "    }",
      "}",
    ].join("\n"),
    "impl<T: Taskable> Worker<T> {\n    fn post(&mut self, me: *const Worker<T>) {\n        self.ct.from(me.cast_mut(), AutoDeinit::ManualDeinit);\n    }\n}",
    "unsafe impl crate::Postable for shell::RmTask {\n    fn post(&mut self, me: *mut RmTask) {\n        self.ct.from(me, AutoDeinit::ManualDeinit);\n    }\n}",
    // The same thing inlined into one method.
    "fn run(&mut self) {\n    let self_ptr: *mut Self = self;\n    let ct = NonNull::from(self.concurrent_task.from(self_ptr, AutoDeinit::ManualDeinit));\n}",
    // Taking the address of a reborrow of the receiver is taking the
    // receiver's address.
    "fn run(&mut self) {\n    let self_ptr = NonNull::from(&mut *self);\n    ct.from(self_ptr.as_ptr(), AutoDeinit::ManualDeinit);\n}",
    "fn run(&mut self) {\n    let p = core::ptr::from_mut(&mut *self);\n    ct.from(p, AutoDeinit::ManualDeinit);\n}",
    "fn run(&mut self) {\n    let p = std::ptr::from_ref(&*self).cast_mut();\n    ct.from(p, AutoDeinit::ManualDeinit);\n}",
    "fn run(&mut self) {\n    let p = &mut *self;\n    ct.from(p, AutoDeinit::ManualDeinit);\n}",
    "ct.from(&mut *self, AutoDeinit::ManualDeinit)",
    "ct.from(std::ptr::from_mut(&mut *self), AutoDeinit::ManualDeinit)",
    "ct.from(NonNull::from(&mut *self).as_ptr(), AutoDeinit::ManualDeinit)",
    "fn run(&mut self) {\n    let this = std::ptr::from_mut::<Self>(self);\n    unsafe { (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit) };\n}",
    "fn run(&mut self) {\n    let p = self as *mut Self;\n    self.task.from(p, Self::run_from_main_thread_mini);\n}",
    "fn run(&mut self) {\n    let p = std::ptr::from_ref(self).cast_mut();\n    ct.from(p, AutoDeinit::ManualDeinit);\n}",
    "fn run(&mut self) {\n    let p = NonNull::from(self);\n    ct.from(p.as_ptr(), AutoDeinit::ManualDeinit);\n}",
    "fn run(&mut self) {\n    let p = &raw mut *self;\n    if done {\n        return;\n    }\n    ct.from(p, AutoDeinit::ManualDeinit);\n}",
    // Spelled inline. `ct` is a task reached some other way, since borrowck
    // rejects `self.concurrent_task.from(self, ..)`.
    "ct.from(self, AutoDeinit::ManualDeinit)",
    "ct.from(std::ptr::from_mut(self), AutoDeinit::ManualDeinit)",
    "ct.from(core::ptr::from_mut::<Self>(self), AutoDeinit::ManualDeinit)",
    "ct.from(self as *mut Self, AutoDeinit::ManualDeinit)",
    "ct.from(&raw mut *self, AutoDeinit::ManualDeinit)",
    "ct.from(core::ptr::addr_of_mut!(*self), AutoDeinit::ManualDeinit)",
    "ct.from(NonNull::from(self).as_ptr(), AutoDeinit::ManualDeinit)",
    "at.from(\n    std::ptr::from_mut(self),\n    Self::run_from_main_thread_mini,\n)",
    // A reference receiver plus a pointer parameter, in the other receiver
    // and header spellings, posting the parameter.
    "fn post(&self, this: *mut Self) {\n    self.task.with_mut(|ct| ct.from(this, AutoDeinit::ManualDeinit));\n}",
    "pub(crate) unsafe fn post<F: Fn(u8) -> u8>(\n    &mut self,\n    f: F,\n    work: *const Self,\n) -> bool {\n    self.ct.from(work.cast_mut(), AutoDeinit::ManualDeinit);\n    true\n}",
    "fn post(&'a mut self, cb: fn(*mut Task), this: *mut Self) {\n    self.ct.from(this, cb);\n}",
    "fn post(self: Pin<&mut Self>, this: *mut Self) {\n    self.ct.from(this, AutoDeinit::AutoDeinit);\n}",
  ];
  const allowed = [
    // The converted shape: the pointer comes in as the only handle on the
    // object.
    "unsafe fn run(this: *mut Self) {\n    let handle = unsafe { (*this).loop_handle.clone() };\n    let ct = NonNull::from(unsafe { (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit) });\n    handle.post_task(ct);\n}",
    "pub(crate) fn http_callback(this: *mut Self, result: Result<'_>) {\n    unsafe { (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit) };\n}",
    "fn run(task: *mut Self) {\n    let ct = unsafe { (*task).concurrent_task.from(task, AutoDeinit::ManualDeinit) };\n}",
    "EventLoopTask::Mini(at) => at.from(this, Self::run_from_main_thread_mini),",
    // Posting something the receiver owns or points at is not this shape.
    "self.concurrent_task.from(self.child, AutoDeinit::ManualDeinit)",
    "ct.from(&raw mut *self.inner, AutoDeinit::ManualDeinit)",
    "ct.from(&mut *self.inner, AutoDeinit::ManualDeinit)",
    "ct.from(std::ptr::from_mut(&mut *self.inner), AutoDeinit::ManualDeinit)",
    "fn run(&mut self) {\n    let p = NonNull::from(&mut *self.inner);\n    ct.from(p.as_ptr(), AutoDeinit::ManualDeinit);\n}",
    "ct.from(self.as_ptr(), AutoDeinit::ManualDeinit)",
    // A pointer to some other type, or to a type that is only the impl's
    // type by name in a different region of the file.
    "impl Scheduler {\n    fn post(&mut self, job: *mut Job) {\n        self.ct.from(job, AutoDeinit::ManualDeinit);\n    }\n}",
    "impl Job {\n    fn id(&self) -> u32 {\n        self.id\n    }\n}\n\ntrait Poster {\n    fn post(&mut self, job: *mut Job) {\n        self.ct().from(job, AutoDeinit::ManualDeinit);\n    }\n}",
    // `from` methods that are not the task initializer, and `From` impls.
    ".reader()\n    .from(buffered_reader, ctx_ptr.cast::<c_void>());",
    "let s = String::from(self.name);",
    "Self::from(self)",
    '"<script>let error=Uint8Array.from(atob(\\"",',
    // A pointer parameter next to a receiver that is stored, not posted.
    "fn adopt_impl(&self, this: *mut Self, fd: Fd) -> bool {\n    self.root.set(this);\n    true\n}",
    // A pointer parameter without a reference receiver is the intended shape
    // even when it is named like one.
    "fn post(self_ptr: *mut Self, ct: &mut ConcurrentTask) {\n    ct.from(self_ptr, AutoDeinit::ManualDeinit);\n}",
    // `*mut Self::Assoc` is not a pointer to the receiver.
    "fn retarget(&self, raw: *mut Self::Raw) {\n    self.ct.from(raw, AutoDeinit::ManualDeinit);\n}",
    // Taking the address for something else, or rebinding the reference.
    "fn run(&mut self) {\n    let this = std::ptr::from_mut(self);\n    register(this);\n}",
    "fn run(&mut self) {\n    let this = self;\n    ct.from(this, AutoDeinit::ManualDeinit);\n}",
    // The binding is posted in the next function, where it is that
    // function's raw-pointer parameter.
    "fn run(&mut self) {\n    let this = std::ptr::from_mut(self);\n    register(this);\n}\n\nunsafe fn resume(this: *mut Self) {\n    (*this).ct.from(this, AutoDeinit::ManualDeinit);\n}",
    // The parameter's name is posted, but by the next function, which owns a
    // parameter of the same name.
    "fn adopt(&self, this: *mut Self) {\n    self.root.set(this);\n}\n\nfn resume(this: *mut Self) {\n    unsafe { (*this).ct.from(this, AutoDeinit::ManualDeinit) };\n}",
  ];
  expect(banned.map(s => findPosts(s).length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => findPosts(s).length)).toEqual(allowed.map(() => 0));
});

test("no method posts its own receiver through its embedded task", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: when an allowlisted site is converted, delete its entry so the
  // shape cannot come back into that file.
  for (const [source, n] of Object.entries(ALLOW)) {
    expect({ source, count: counts[source] ?? 0 }).toEqual({ source, count: n });
  }
});
