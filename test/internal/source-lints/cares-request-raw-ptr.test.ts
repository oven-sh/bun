import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A c-ares request travels as a raw pointer from registration to completion.
//
// The completion (`on_cares_complete` in src/runtime/dns_jsc/dns.rs) reclaims
// the request's heap allocation on every path. Freeing an allocation while a
// reference argument to it is live is UB under the aliasing models (the
// argument is protected for the whole call; Miri: "the strongly protected tag
// disallows deallocations"), whether or not the reference is used again. Two
// frames used to hold such a reference: the handler trait methods in
// src/cares_sys/c_ares.rs took `&mut self` and their impls called
// `Self::on_cares_complete(ptr::from_mut(self), ..)`, and the `Channel`
// methods that register a request took `ctx: &mut T`, which c-ares completes
// synchronously for inputs it rejects (EBADNAME, ENOTIMP, ...). Both now pass
// the pointer through; this lint keeps it that way:
//
//   1. tree-wide, `on_cares_complete(` never receives the receiver
//      (the spellings self-receiver-reclaim.test.ts bans for the reclaim
//      primitives themselves; `on_cares_complete` is the consuming helper
//      that lint does not know about);
//   2. in src/cares_sys/c_ares.rs, no method of a `*Handler` trait takes the
//      request by reference, and no `ctx` parameter is a reference.
//
// Sibling guards: self-receiver-reclaim.test.ts (reclaiming `self` directly),
// fn-long-mut-reborrow.test.ts (`let this = unsafe { &mut *this };`).

const root = path.resolve(import.meta.dir, "..", "..", "..");
const caresSource = "src/cares_sys/c_ares.rs";
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

// The receiver as the first argument: bare `self` (a `&mut self` coerces to
// `*mut Self` at the call) or any spelling of its address.
const SELF_AS_POINTER = [
  String.raw`self\s*[,)]`,
  String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*self\s*\)`,
  String.raw`(?:[\w:]+::)?NonNull::from\(\s*self\s*\)`,
  String.raw`self\s+as\s+\*(?:mut|const)\b`,
  String.raw`&\s*(?:raw\s+(?:mut|const)|mut)\s+\*\s*self\b(?!\s*\.)`,
  String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
].join("|");

const COMPLETE_WITH_SELF = new RegExp(String.raw`\bon_cares_complete\s*\(\s*(?:${SELF_AS_POINTER})`, "g");

// `pub trait FooHandler..: Sized {` at column 0, up to the column-0 `}`.
const HANDLER_TRAIT = /^pub trait (\w*Handler)\b[^{]*\{([\s\S]*?)^\}/gm;
// A fn item and its first parameter, across rustfmt wrapping.
const FN_FIRST_PARAM = /\bfn\s+(\w+)\s*(?:<[^>]*>)?\s*\(\s*([^,)]*)/g;
// `&self` / `&mut self`, or a parameter typed `&Self` / `&mut Self`.
const BORROWS_REQUEST = /&\s*(?:mut\s+)?self\b|:\s*&\s*(?:mut\s+)?Self\b/;
const CTX_BY_REFERENCE = /\bctx\s*:\s*&/g;

// Full-line comments only, so prose (including the comments describing this
// hazard) does not count and line numbers stay put.
const stripComments = (content: string) => content.replace(/^[ \t]*\/\/.*$/gm, "");
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

function completionOffenders(source: string, content: string): string[] {
  const stripped = stripComments(content);
  return [...stripped.matchAll(COMPLETE_WITH_SELF)].map(
    m => `${source}:${lineOf(stripped, m.index)}: ${m[0].replace(/\s+/g, " ")}`,
  );
}

function caresOffenders(content: string): { traits: string[]; offenders: string[] } {
  const stripped = stripComments(content);
  const traits: string[] = [];
  const offenders: string[] = [];
  for (const trait of stripped.matchAll(HANDLER_TRAIT)) {
    const [whole, name, body] = trait;
    traits.push(name);
    const bodyStart = trait.index + whole.length - 1 - body.length;
    for (const fn of body.matchAll(FN_FIRST_PARAM)) {
      const [, method, firstParam] = fn;
      if (!BORROWS_REQUEST.test(firstParam)) continue;
      offenders.push(
        `${caresSource}:${lineOf(stripped, bodyStart + fn.index)}: ${name}::${method}(${firstParam.trim()}, ..)`,
      );
    }
  }
  for (const m of stripped.matchAll(CTX_BY_REFERENCE)) {
    offenders.push(`${caresSource}:${lineOf(stripped, m.index)}: ${m[0]}`);
  }
  return { traits, offenders };
}

const completion: string[] = [];
let cares: ReturnType<typeof caresOffenders> | null = null;
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  completion.push(...completionOffenders(source, content));
  if (source === caresSource) cares = caresOffenders(content);
}

test("scans the tracked Rust sources and finds the c-ares handler traits", () => {
  // Guards against the filters above or HANDLER_TRAIT over-firing and leaving
  // nothing to check, which would make the bans below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
  expect(cares?.traits).toEqual(
    expect.arrayContaining([
      "HostentHandler",
      "HostentWithTtlsHandler",
      "NameinfoHandler",
      "AddrInfoHandler",
      "ReplyHandler",
      "AnyHandler",
    ]),
  );
});

test("the patterns recognize the spellings they claim to", () => {
  const banned = [
    // The dns.rs impls as they were.
    "Self::on_cares_complete(std::ptr::from_mut::<Self>(self), status, timeouts, result);",
    "Self::on_cares_complete(core::ptr::from_mut(self), status, timeouts, result);",
    "GetNameInfoRequest::on_cares_complete(\n    std::ptr::from_mut::<Self>(self),\n    status,\n    timeouts,\n    info,\n);",
    // Other spellings of the receiver.
    "Self::on_cares_complete(self, status, timeouts, result);",
    "Self::on_cares_complete(self as *mut Self, status, timeouts, result);",
    "Self::on_cares_complete(&raw mut *self, status, timeouts, result);",
    "Self::on_cares_complete(core::ptr::addr_of_mut!(*self), status, timeouts, result);",
  ];
  const allowed = [
    // The pointer comes in as a parameter.
    "Self::on_cares_complete(this, status, timeouts, result);",
    "GetNameInfoRequest::on_cares_complete(\n    this,\n    status,\n    timeouts,\n    info,\n);",
    // Something the receiver owns, and the definition itself.
    "Self::on_cares_complete(self.request, status, timeouts, result);",
    "fn on_cares_complete(\n    this: *mut Self,\n    err_: Option<c_ares::Error>,\n) {",
  ];
  expect(banned.filter(s => completionOffenders("x.rs", s).length === 0)).toEqual([]);
  expect(allowed.flatMap(s => completionOffenders("x.rs", s))).toEqual([]);

  // c_ares.rs as it was: `&mut self` methods (one-line and rustfmt-wrapped),
  // the same thing under a parameter name, and a by-reference registration.
  const before = [
    "pub trait HostentHandler: Sized {",
    "    fn on_hostent(&mut self, status: Option<Error>, timeouts: i32, results: *mut struct_hostent);",
    "}",
    "pub trait AnyHandler: Sized {",
    "    fn on_any(",
    "        &mut self,",
    "        status: Option<Error>,",
    "    );",
    "}",
    "pub trait ReplyHandler<R: AresReply>: Sized {",
    "    unsafe fn on_reply(this: &mut Self, status: Option<Error>, timeouts: i32, results: *mut R);",
    "}",
    "impl Channel {",
    "    pub fn resolve<T: ResolveHandler>(&mut self, name: &[u8], ctx: &mut T) {}",
    "}",
  ].join("\n");
  expect(caresOffenders(before)).toEqual({
    traits: ["HostentHandler", "AnyHandler", "ReplyHandler"],
    offenders: [
      `${caresSource}:2: HostentHandler::on_hostent(&mut self, ..)`,
      `${caresSource}:5: AnyHandler::on_any(&mut self, ..)`,
      `${caresSource}:11: ReplyHandler::on_reply(this: &mut Self, ..)`,
      `${caresSource}:14: ctx: &`,
    ],
  });
  // As it is now. `ResolveHandler` only carries the thunk itself; other
  // reference parameters (`name: &[u8]`), an associated `fn(..)` type, and
  // traits not named `*Handler` (the container is not freed by its callbacks)
  // are not what this checks.
  const after = [
    "pub trait HostentHandler: Sized {",
    "    /// # Safety",
    "    /// ..",
    "    unsafe fn on_hostent(",
    "        this: *mut Self,",
    "        status: Option<Error>,",
    "    );",
    "}",
    "pub trait HostentWithTtlsHandler: Sized {",
    "    const PARSE: fn(&[u8]) -> Result<Box<hostent_with_ttls>, Error>;",
    "    unsafe fn on_hostent_with_ttls(this: *mut Self, status: Option<Error>);",
    "}",
    "pub trait ResolveHandler: Sized {",
    '    unsafe extern "C" fn raw_callback(ctx: *mut c_void, status: c_int);',
    "    fn lookup_name(name: &[u8]) -> &[u8];",
    "}",
    "pub trait ChannelContainer: Sized {",
    "    fn on_dns_socket_state(&self, socket: ares_socket_t);",
    "}",
    "impl Channel {",
    "    pub unsafe fn resolve<T: ResolveHandler>(&mut self, name: &[u8], ctx: *mut T) {}",
    "}",
  ].join("\n");
  expect(caresOffenders(after)).toEqual({
    traits: ["HostentHandler", "HostentWithTtlsHandler", "ResolveHandler"],
    offenders: [],
  });
});

test("no handler impl hands its own receiver to on_cares_complete", () => {
  expect(completion).toEqual([]);
});

test("c_ares.rs passes the request through as a raw pointer at every frame", () => {
  expect(cares?.offenders).toEqual([]);
});
