import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A safe fn whose `unsafe` block is only sound when its arguments satisfy a
// precondition must check that precondition with a real `assert!` (or be an
// `unsafe fn`). A `debug_assert!` compiles out of the release profile
// (`[profile.release]` leaves debug-assertions off; scripts/build/rust.ts only
// turns them on for the debug, asan and assertions profiles), so with one the
// shipped binary trusts every one of the function's callers and a single
// length bug becomes an out-of-bounds read handed to a syscall.
//
// The functions below are the NUL-terminated string constructors
// that had exactly that shape (the Zig originals ran these checks in
// ReleaseSafe, which is what shipped; the Rust port demoted them to
// `debug_assert!`). Each one is located by its signature, tree-wide, so that
// moving it between files does not require touching this lint; renaming its
// parameters does, and the "defined exactly once" assertion makes that loud
// instead of silently passing.
//
// Scope: the GUARDED table is the enforcement boundary. It pins functions that
// have already been converted so they cannot quietly go back to
// `debug_assert!`; it does not try to recognize the shape syntactically, since
// "debug_assert! followed by unsafe" also matches hundreds of fns whose
// precondition is a private invariant with a real check at the pub boundary,
// or an O(n) condition whose unchecked variant should become an `unsafe fn`
// instead. Those are a separate, pre-existing population (e.g.
// `DynamicBitSetList::at`, `strings::eql_long(.., false)`,
// `copy_utf16_into_utf8_with_utf8_len` at the time of writing): convert them
// on sight and add an entry here when you do. Deliberately not converted:
// `ZStr::as_cstr`, whose debug check guards `CStr`'s no-interior-NUL contract
// rather than memory and would cost a scan of every path before every syscall.
//
// Sibling guards: unsound-erased-box.test.ts, self-receiver-reclaim.test.ts.

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

interface Guarded {
  /** Display name. */
  name: string;
  /** The fn name, parameter list and return type exactly as written in src. */
  signature: string;
  /** Text that must precede the signature, to disambiguate a common name. */
  within?: string;
}

const GUARDED: Guarded[] = [
  // bun_core: NUL-terminated borrowed strings. The returned `&ZStr`/`&WStr` is
  // handed straight to open/stat/unlink/CreateFileW; the asserted NUL is what
  // stops libc from reading past the buffer.
  { name: "ZStr::from_static", signature: "from_static(s: &'static [u8]) -> &'static ZStr" },
  { name: "ZStr::from_buf", signature: "from_buf(buf: &[u8], len: usize) -> &ZStr" },
  { name: "ZStr::from_buf_mut", signature: "from_buf_mut(buf: &mut [u8], len: usize) -> &mut ZStr" },
  { name: "ZStr::from_slice_with_nul", signature: "from_slice_with_nul(buf: &[u8]) -> &ZStr" },
  { name: "WStr::from_buf", signature: "from_buf(buf: &[u16], len: usize) -> &WStr" },
  { name: "WStr::from_slice_with_nul", signature: "from_slice_with_nul(buf: &[u16]) -> &WStr" },
  // bun_core: forming a misaligned `&mut [T]` is UB even if never read.
  {
    name: "Unaligned::slice_align_cast_mut",
    signature: "slice_align_cast_mut(slice: &mut [Unaligned<T>]) -> &mut [T]",
  },
];

// The errno enums (`#[repr(u16)]`, an undeclared value is an invalid enum
// value the moment it exists) are only ever built from a discriminant through
// `strum::FromRepr` (`SystemErrno::from_raw`, Windows `E::from_raw`); a
// transmute from the raw integer is the unchecked shape this lint keeps out.
// `bun_sys::E` is an alias of `SystemErrno` on POSIX, so both spellings are
// covered.
const ERRNO_TRANSMUTE = /\btransmute::<\s*u16\s*,\s*(?:[\w:]+::)?(?:E|SystemErrno)\s*>/;

const DEBUG_ASSERT = /\bdebug_assert(?:_eq|_ne)?!/;
// A check that survives release: `assert!`-family or an explicit `panic!`
// arm (the `match check(..) { None => panic!(..) }` shape).
const HARD_CHECK = /(?<![\w.])(?:assert(?:_eq|_ne)?|panic)!\s*\(/;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Definition {
  source: string;
  isUnsafe: boolean;
  body: string;
}

/**
 * Find every definition of `g` in `content` and return its header flags and
 * body text (comments removed), or nothing if the signature is not here.
 */
function findDefinitions(source: string, content: string, g: Guarded): Definition[] {
  const header = String.raw`(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(unsafe\s+)?fn ${escape(g.signature)}\s*\{`;
  const re = new RegExp(g.within ? `${escape(g.within)}[\\s\\S]*?${header}` : header, "g");
  const out: Definition[] = [];
  for (const m of content.matchAll(re)) {
    const open = m.index + m[0].length; // just past the body's `{`
    let depth = 1;
    let i = open;
    while (i < content.length && depth > 0) {
      const c = content[i++];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    if (depth !== 0) throw new Error(`${source}: unbalanced braces after \`${g.signature}\``);
    out.push({ source, isUnsafe: m[1] !== undefined, body: content.slice(open, i - 1) });
  }
  return out;
}

function stripComments(content: string): string {
  // Full-line comments, then trailing `// ...` on code lines, so prose about
  // `debug_assert` next to the code does not count either way.
  return content.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]+\/\/.*$/gm, "");
}

const definitions = new Map<string, Definition[]>(GUARDED.map(g => [g.name, []]));
const transmutes: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = stripComments(await file(abs).text());
  for (const g of GUARDED) {
    definitions.get(g.name)!.push(...findDefinitions(source, content, g));
  }
  for (const [index, line] of content.split("\n").entries()) {
    if (ERRNO_TRANSMUTE.test(line)) transmutes.push(`${source}:${index + 1}: ${line.trim()}`);
  }
}

function violations(def: Definition): string[] {
  const out: string[] = [];
  if (DEBUG_ASSERT.test(def.body)) out.push("precondition is only debug_assert!ed");
  if (!def.isUnsafe && !HARD_CHECK.test(def.body)) out.push("safe fn with no assert!/panic! in its body");
  return out;
}

test("scans a non-empty set of tracked Rust sources", () => {
  // If the tracked/realpath filters above over-fire, every per-function test
  // below fails with "expected length 1"; this names the actual cause.
  expect(scanned).toBeGreaterThan(0);
});

test("the extractor and the check classify the shapes it claims to", () => {
  const g: Guarded = { name: "t", signature: "from_buf(buf: &[u8], len: usize) -> &ZStr" };
  const classify = (src: string) => {
    const defs = findDefinitions("t.rs", stripComments(src), g);
    expect(defs).toHaveLength(1);
    return violations(defs[0]);
  };
  // The shape this lint was written against.
  expect(
    classify(`
      pub fn from_buf(buf: &[u8], len: usize) -> &ZStr {
          debug_assert!(len < buf.len());
          debug_assert_eq!(buf[len], 0);
          unsafe { Self::from_raw(buf.as_ptr(), len) }
      }`),
  ).toEqual(["precondition is only debug_assert!ed", "safe fn with no assert!/panic! in its body"]);
  // Either accepted fix.
  expect(
    classify(`
      pub fn from_buf(buf: &[u8], len: usize) -> &ZStr {
          assert!(len < buf.len(), "ZStr::from_buf: NUL must lie within buf");
          // SAFETY: asserted above; a debug_assert! would not do here.
          unsafe { Self::from_raw(buf.as_ptr(), len) }
      }`),
  ).toEqual([]);
  expect(
    classify(`
      pub const fn from_buf(buf: &[u8], len: usize) -> &ZStr {
          match check(buf, len) {
              Some(z) => z,
              None => panic!("missing NUL"), // not debug_assert!
          }
      }`),
  ).toEqual([]);
  expect(
    classify(`
      pub unsafe fn from_buf(buf: &[u8], len: usize) -> &ZStr {
          unsafe { Self::from_raw(buf.as_ptr(), len) }
      }`),
  ).toEqual([]);
  // Mixed: a hard check plus a leftover debug_assert! on another part of the
  // precondition is still a violation; so is a body with no check at all.
  expect(
    classify(`
      pub fn from_buf(buf: &[u8], len: usize) -> &ZStr {
          assert!(len < buf.len());
          debug_assert_eq!(buf[len], 0);
          unsafe { Self::from_raw(buf.as_ptr(), len) }
      }`),
  ).toEqual(["precondition is only debug_assert!ed"]);
  expect(
    classify(`
      pub fn from_buf(buf: &[u8], len: usize) -> &ZStr {
          unsafe { Self::from_raw(buf.as_ptr(), len) }
      }`),
  ).toEqual(["safe fn with no assert!/panic! in its body"]);
  // Nested braces inside the body do not cut the extraction short.
  expect(
    classify(`
      pub fn from_buf(buf: &[u8], len: usize) -> &ZStr {
          if len >= buf.len() { panic!("{}", len) }
          unsafe { Self::from_raw(buf.as_ptr(), len) }
      }`),
  ).toEqual([]);

  expect(ERRNO_TRANSMUTE.test("unsafe { core::mem::transmute::<u16, SystemErrno>(n) }")).toBe(true);
  expect(ERRNO_TRANSMUTE.test("unsafe { core::mem::transmute::<u16, E>(int as u16) }")).toBe(true);
  expect(ERRNO_TRANSMUTE.test("unsafe { transmute::<u16, bun_errno::SystemErrno>(n) }")).toBe(true);
  expect(ERRNO_TRANSMUTE.test("unsafe { transmute::<u16, Endian>(n) }")).toBe(false);
  expect(ERRNO_TRANSMUTE.test("SystemErrno::from_repr(n)")).toBe(false);
});

test.each(GUARDED)("$name checks its precondition in release builds", g => {
  const defs = definitions.get(g.name)!;
  // Exactly one definition: a rename or a second copy must update this table
  // rather than silently dropping the function out of the lint.
  expect(defs.map(d => d.source)).toHaveLength(1);
  expect(violations(defs[0])).toEqual([]);
});

test("no errno enum is built by transmuting a raw u16", () => {
  expect(transmutes).toEqual([]);
});
