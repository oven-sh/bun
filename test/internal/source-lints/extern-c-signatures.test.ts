import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A C-ABI symbol that Rust and C++ both spell out by hand must be spelled out
// the same way on both sides. Nothing else checks this: the two halves are
// built by different compilers and only meet in the linker, which matches
// names, not signatures. A declaration with one parameter too many, or a `u32`
// return for a `size_t` function, links and happens to work on x64/arm64 (the
// callee ignores the extra register, the caller reads the low half of the
// return register), but it is undefined behaviour on the Rust side and it
// stops working the day the types or the calling convention change.
//
// This lint collects every hand-written site of every symbol:
//
//   Rust   `fn X(..) -> R;` items of `[unsafe] extern "C" { .. }` blocks (also
//          `"C-unwind"`, `"sysv64"` and `bun_jsc::jsc_abi_extern! { .. }`),
//          following a literal `#[link_name = ".."]`;
//          `#[unsafe(no_mangle)] [pub] [unsafe] extern "C" fn X(..) -> R`
//          definitions (or `#[unsafe(export_name = "X")]`);
//          `// HOST_EXPORT(X[, abi])` impls: src/codegen/generate-host-exports.ts
//          emits the thunk with the impl's arity, returning `JSValue` for a
//          `JsResult<JSValue>` impl and the impl's own type otherwise.
//   C++    `extern "C" R X(..)` declarations and definitions, the items of
//          `extern "C" { .. }` blocks, and the `CPP_DECL` / `ZIG_DECL`
//          spelling used by src/jsc/bindings/headers.h.
//
// and requires all sites of a symbol to agree on the parameter count (and
// variadic-ness) and, where every return type involved is a scalar whose width
// this file knows, on the return width. Parameter types are not compared:
// that needs a real type mapper, and arity alone catches the drift that
// happens in practice (a parameter added or dropped on one side only).
// Anything the scanners cannot read is skipped, so an unforeseen declaration
// shape degrades to "unchecked", never to a false positive. Codegen output
// (build/**, `.classes.ts`, bindgen) is not scanned: both sides of those are
// emitted from one source and cannot drift.
//
// The rule also applies within one language, so two Rust crates (or two C++
// files) declaring one symbol differently are reported as well.
//
// Debugging: EXTERN_C_LINT_DEBUG=Sym1,Sym2 prints the sites recorded for
// those symbols plus scan totals.

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// files in the working tree; CI runs on a clean checkout). Same guard as
// byte-search.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

function trackedRelative(abs: string): string | null {
  const rel = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; scan each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== rel) return null;
  if (tracked !== null && !tracked.has(rel)) return null;
  return rel;
}

const sources = globAllSources();
const rustFiles = sources.rust.filter(p => p.endsWith(".rs"));
// The compiled C++ plus the headers beside it: headers.h, BunJSCModule.h,
// WebStreamsInternals.h and friends carry a large share of the declarations.
const cxxFiles = (() => {
  const set = new Set(sources.cxx);
  for (const dir of new Set(sources.cxx.map(p => path.dirname(p)))) {
    for (const header of new Bun.Glob("*.h").scanSync({ cwd: dir, absolute: true })) set.add(header);
  }
  return [...set].sort();
})();

type Width = "void" | "bool" | "8" | "16" | "32" | "64" | "f32" | "f64";

interface Site {
  where: string; // `src/foo.rs:12`
  lang: "rust" | "c++";
  params: number;
  variadic: boolean;
  ret: string;
  width: Width | null;
}

// Declarations whose written signature is deliberately not the real one.
// Matching sites are dropped before comparing; an entry that stops matching
// anything fails the test at the bottom, so the list cannot go stale.
const EXEMPT: { file: string; symbols: RegExp; why: string; matched: number }[] = [
  {
    file: "src/runtime/napi/napi_body.rs",
    symbols: /^uv_/,
    why:
      "`mod uv_functions_to_export` declares every uv_* polyfill as `fn x();` only to take its address " +
      "(keeps them linked for N-API addons); the real signatures are the Windows-only libuv_sys crate's",
    matched: 0,
  },
];

let sites = new Map<string, Site[]>();
const recorded = new Set<string>();
function addSite(symbol: string, site: Site) {
  const exempt = EXEMPT.find(e => site.where.startsWith(e.file + ":") && e.symbols.test(symbol));
  if (exempt) {
    exempt.matched++;
    return;
  }
  // An item of an `extern "C" { .. }` block that repeats `extern "C"` itself
  // is reached by both C++ scanners; record it once.
  const key = `${symbol}@${site.where}`;
  if (recorded.has(key)) return;
  recorded.add(key);
  let list = sites.get(symbol);
  if (!list) sites.set(symbol, (list = []));
  list.push(site);
}

// ───────────────────────────── text utilities ─────────────────────────────

// Everything below works in units of whole ranges (one regex jump, slice or
// repeat per literal, comment or bracket), never per character: the lint reads
// ~25 MB of source, and it also has to finish on a debug build of bun, where
// per-character JS (or a per-character regex replace) over that much text
// takes minutes.

/** First match of `re` (a `g` regex) at or after `from`, or null. */
function nextMatch(re: RegExp, text: string, from: number): RegExpExecArray | null {
  re.lastIndex = from;
  return re.exec(text);
}

/** `s` with every character but newlines replaced by a space. */
const spaces = (s: string) =>
  s.includes("\n")
    ? s
        .split("\n")
        .map(line => " ".repeat(line.length))
        .join("\n")
    : " ".repeat(s.length);
const BLANK_STARTS = { rust: /["'/]/g, "c++": /["'/#]/g };
const STRING_END = /["\\]/g;
const CHAR_END = /['\\\n]/g;
const RUST_COMMENT_DELIMS = /\/\*|\*\//g;
const BARE_WORD = /^[\w+.-]*$/;

/**
 * Index of the `quote` closing a literal whose body starts at `from`, or -1
 * when the literal is unterminated (`delims` matches the quote, `\`, and for
 * char literals the newline that ends an unterminated one).
 */
function literalEnd(delims: RegExp, text: string, from: number, quote: string): number {
  for (let m = nextMatch(delims, text, from); m !== null; m = nextMatch(delims, text, m.index + 2)) {
    if (m[0] !== "\\") return m[0] === quote ? m.index : -1;
  }
  return -1;
}

/**
 * Replace comments, string and char literal bodies, and (C++) preprocessor
 * lines with spaces. Every newline and the total length are preserved, so an
 * offset into the result is an offset into the original. A literal body that
 * is a single bare word is kept: `extern "C"`, `extern "sysv64"` and
 * `#[link_name = "Bun__x"]` are structure the scanners need to read.
 */
function blank(text: string, lang: "rust" | "c++"): string {
  const n = text.length;
  const out: string[] = [];
  let copied = 0;
  let i = 0;
  const copyTo = (end: number) => {
    out.push(text.slice(copied, end));
    copied = end;
  };
  const blankRange = (start: number, end: number) => {
    copyTo(start);
    out.push(spaces(text.slice(start, end)));
    copied = end;
    i = end;
  };
  // Blank [bodyStart, bodyEnd) unless it is a bare word; resume at `end`.
  const blankLiteral = (bodyStart: number, bodyEnd: number, end: number) => {
    if (!BARE_WORD.test(text.slice(bodyStart, bodyEnd))) blankRange(bodyStart, bodyEnd);
    copyTo(end);
    i = end;
  };
  const starts = BLANK_STARTS[lang];
  for (let m = nextMatch(starts, text, i); m !== null; m = nextMatch(starts, text, i)) {
    i = m.index;
    const c = m[0];
    if (c === "#") {
      // A directive if only blanks precede it on its line; blank it and any
      // `\`-continued lines.
      if (!/^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i))) {
        i++;
        continue;
      }
      let end = i;
      for (;;) {
        const nl = text.indexOf("\n", end);
        end = nl === -1 ? n : nl;
        if (end === n || text[end - 1] !== "\\") break;
        end++;
      }
      blankRange(i, end);
      continue;
    }
    if (c === "/") {
      const next = text[i + 1];
      if (next === "/") {
        const nl = text.indexOf("\n", i);
        blankRange(i, nl === -1 ? n : nl);
      } else if (next === "*" && lang === "rust") {
        let depth = 1;
        let j = i + 2;
        while (depth > 0) {
          const d = nextMatch(RUST_COMMENT_DELIMS, text, j);
          if (d === null) {
            j = n;
            break;
          }
          depth += d[0] === "/*" ? 1 : -1;
          j = d.index + 2;
        }
        blankRange(i, j);
      } else if (next === "*") {
        const end = text.indexOf("*/", i + 2);
        blankRange(i, end === -1 ? n : end + 2);
      } else i++;
      continue;
    }
    if (c === '"') {
      const before = text.slice(Math.max(0, i - 8), i);
      const rustRaw = lang === "rust" ? /(?:^|\W)(?:b|c|br|cr)?r(#*)$/.exec(before) : null;
      if (rustRaw) {
        const close = '"' + rustRaw[1];
        const end = text.indexOf(close, i + 1);
        if (end === -1) break;
        blankLiteral(i + 1, end, end + close.length);
        continue;
      }
      if (lang === "c++" && /(?:^|\W)(?:u8|u|U|L)?R$/.test(before)) {
        const open = text.indexOf("(", i);
        if (open === -1) break;
        const close = ")" + text.slice(i + 1, open) + '"';
        const end = text.indexOf(close, open);
        if (end === -1) break;
        blankLiteral(i + 1, end + close.length - 1, end + close.length);
        continue;
      }
      const end = literalEnd(STRING_END, text, i + 1, '"');
      if (end === -1) break;
      blankLiteral(i + 1, end, end + 1);
      continue;
    }
    // `'`
    let close = -1;
    if (lang === "rust") {
      // A char literal (`'a'`, `'\n'`, `'\u{1F600}'`) or a lifetime (`'a`).
      if (text[i + 1] === "\\") {
        const k = text.indexOf("'", i + 3);
        if (k !== -1 && k - i <= 12) close = k;
      } else if (text[i + 2] === "'") close = i + 2;
      else if (text[i + 3] === "'" && /[\uD800-\uDBFF]/.test(text[i + 1] ?? "")) close = i + 3;
    } else close = literalEnd(CHAR_END, text, i + 1, "'");
    if (close === -1) i++;
    else blankLiteral(i + 1, close, close + 1);
  }
  copyTo(n);
  return out.join("");
}

const BRACKETS: Record<string, { close: string; either: RegExp }> = {
  "(": { close: ")", either: /[()]/g },
  "[": { close: "]", either: /[[\]]/g },
  "{": { close: "}", either: /[{}]/g },
};

/** Index of the bracket matching the one at `open` (searching up to `limit`), or -1. Expects blanked text. */
function matching(text: string, open: number, limit = text.length): number {
  const { close, either } = BRACKETS[text[open]];
  let depth = 0;
  for (let m = nextMatch(either, text, open); m !== null && m.index < limit; m = nextMatch(either, text, m.index + 1)) {
    if (m[0] === close) {
      if (--depth === 0) return m.index;
    } else depth++;
  }
  return -1;
}

const NON_SPACE = /\S/g;
function skipSpace(text: string, i: number): number {
  return nextMatch(NON_SPACE, text, i)?.index ?? text.length;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Parameter count of a parameter list, splitting on the commas that are not
 * nested inside (), [] or <>. `emptyMarker` is C's `(void)`. Null when the
 * list cannot be read (unbalanced brackets, macro metavariables).
 */
function arity(list: string, emptyMarker?: string): Pick<Site, "params" | "variadic"> | null {
  if (list.includes("$")) return null;
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(" || c === "[" || c === "<") depth++;
    else if (c === ")" || c === "]" || (c === ">" && list[i - 1] !== "-"))
      depth--; // `->`: Rust fn-pointer return
    else if (c === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  parts.push(list.slice(start));
  const names = parts.map(p => p.trim()).filter(Boolean);
  return {
    params: names.filter(p => p !== "..." && p !== emptyMarker).length,
    variadic: names.includes("..."),
  };
}

// ─────────────────────────── return-width tables ───────────────────────────

const RUST_WIDTHS: Record<string, Width> = {
  bool: "bool",
  u8: "8",
  i8: "8",
  c_char: "8",
  c_schar: "8",
  c_uchar: "8",
  u16: "16",
  i16: "16",
  c_short: "16",
  c_ushort: "16",
  u32: "32",
  i32: "32",
  c_int: "32",
  c_uint: "32",
  u64: "64",
  i64: "64",
  usize: "64",
  isize: "64",
  c_longlong: "64",
  c_ulonglong: "64",
  JSValue: "64", // `#[repr(transparent)]` over the i64 `EncodedJSValue`
  EncodedJSValue: "64",
  f32: "f32",
  c_float: "f32",
  f64: "f64",
  c_double: "f64",
};

// Pointers are 64-bit on every target bun builds for and come back in the same
// register as a 64-bit integer, so they share that class: a `usize` declared
// for a `void*` function is a style nit, not an ABI mismatch.
const RUST_POINTER_RETURN =
  /^(?:Option\s*<\s*)?(?:&|\*\s*(?:const|mut)\b|(?:\w+::)*(?:NonNull|Box)\s*<|(?:unsafe\s+)?(?:extern\b|fn\b))/;

function rustWidth(ret: string): Width | null {
  if (ret === "" || ret === "()" || ret === "!") return "void";
  if (RUST_POINTER_RETURN.test(ret)) return "64";
  if (/[<>()[\]]/.test(ret)) return null;
  return RUST_WIDTHS[ret.split("::").pop()!.trim()] ?? null;
}

// `long` is deliberately absent: it is 32-bit on Windows and 64-bit elsewhere.
const CXX_WIDTHS: Record<string, Width> = {
  void: "void",
  bool: "bool",
  char: "8",
  "signed char": "8",
  "unsigned char": "8",
  int8_t: "8",
  uint8_t: "8",
  short: "16",
  "unsigned short": "16",
  int16_t: "16",
  uint16_t: "16",
  int: "32",
  signed: "32",
  "signed int": "32",
  unsigned: "32",
  "unsigned int": "32",
  int32_t: "32",
  uint32_t: "32",
  "long long": "64",
  "unsigned long long": "64",
  int64_t: "64",
  uint64_t: "64",
  size_t: "64",
  ssize_t: "64",
  intptr_t: "64",
  uintptr_t: "64",
  ptrdiff_t: "64",
  EncodedJSValue: "64",
  float: "f32",
  double: "f64",
};

// The macros src/jsc/bindings/headers.h uses in place of a literal `extern "C"`.
const CXX_OPENER_MACROS = "CPP_DECL|ZIG_DECL|CPP_SIZE|AUTO_EXTERN_C_ZIG|AUTO_EXTERN_C";
// Linkage, visibility and calling-convention noise that may surround a C++
// return type (an item inside an `extern "C" { .. }` block may even repeat the
// opener). Replaced with same-length spaces so offsets stay valid.
const CXX_DECORATION_WORDS = new RegExp(
  String.raw`\[\[[^\]]*\]\]|\bextern\s+"C"|\b(?:${CXX_OPENER_MACROS}|SYSV_ABI|JS_EXPORT|JS_EXPORT_PRIVATE|BUN_EXPORT|SUPPRESS_ASAN|WTF_EXPORT_PRIVATE|extern|inline|constexpr|noexcept)\b`,
  "g",
);
const CXX_DECORATION_CALLS = /\b(?:__attribute__|__declspec|alignas)\s*\(/g;

function stripCxxDecorations(header: string): string {
  let out = header.replace(CXX_DECORATION_WORDS, d => " ".repeat(d.length));
  for (const m of [...out.matchAll(CXX_DECORATION_CALLS)].reverse()) {
    const open = m.index! + m[0].length - 1;
    const close = matching(out, open);
    if (close === -1) return "";
    out = out.slice(0, m.index!) + " ".repeat(close + 1 - m.index!) + out.slice(close + 1);
  }
  return out;
}

function cxxWidth(ret: string): Width | null {
  if (/[*&]$/.test(ret)) return "64";
  const tokens = ret
    .split(/\s+/)
    .filter(t => !/^(?:const|volatile|struct|class|enum)$/.test(t))
    .map(t => t.split("::").pop()!);
  const exact = tokens.join(" ");
  if (exact in CXX_WIDTHS) return CXX_WIDTHS[exact];
  // `SOME_MACRO int`: drop macro-looking tokens and look the rest up.
  const plain = tokens.filter(t => !/^[A-Z][A-Z0-9_]+$/.test(t)).join(" ");
  return plain !== exact && plain in CXX_WIDTHS ? CXX_WIDTHS[plain] : null;
}

// ────────────────────────────── Rust sites ──────────────────────────────────

const RUST_BLOCK_OPEN = /\bextern\s+"(?:C|C-unwind|sysv64)"\s*\{|\bjsc_abi_extern!\s*\{/g;
const RUST_ITEM_DELIMS = /[()[\];]/g;
const RUST_ITEM_HEAD = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:(?:safe|unsafe)\s+)?fn\s+(\w+)\s*\(/;
const RUST_LINK_NAME = /^\s*link_name\s*=\s*"([\w.]+)"\s*$/;
const RUST_EXPORT_ATTR = /#\[\s*(?:unsafe\s*\(\s*)?(?:no_mangle|export_name\s*=\s*"([\w.]+)")\s*\)?\s*\]/g;
const RUST_EXPORT_HEAD =
  /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:(?:const|unsafe)\s+)*extern\s+"(?:C|C-unwind|sysv64)"\s+fn\s+(\w+)\s*\(/;
const HOST_EXPORT_MARKER = /^[ \t]*\/\/[ \t]*HOST_EXPORT\(\s*(\w+)\s*(?:,\s*(\w+))?\s*\)/gm;
const HOST_EXPORT_HEAD = /^\s*pub\s+(?:unsafe\s+)?fn\s+\w+\s*\(/;
const JS_RESULT_JSVALUE = /^(?:\w+::)*JsResult\s*<\s*JSValue\s*>$/;
// How far past an attribute or marker the fn header may start (doc comments
// in between are already blanked to whitespace).
const HEADER_WINDOW = 4096;

/** Consume the `#[..]` attributes at the start of `text`; `end` is the offset after them, -1 if unbalanced. */
function takeAttributes(text: string): { attrs: string[]; end: number } {
  const attrs: string[] = [];
  let i = 0;
  for (;;) {
    const j = skipSpace(text, i);
    if (!text.startsWith("#[", j)) return { attrs, end: j };
    const close = matching(text, j + 1);
    if (close === -1) return { attrs, end: -1 };
    attrs.push(text.slice(j + 2, close));
    i = close + 1;
  }
}

type Signature = Pick<Site, "params" | "variadic" | "ret">;

/** Signature of a fn header whose parameter list opens at `open`; `end` bounds the return type. */
function rustSignature(text: string, open: number, end: number): Signature | null {
  const close = matching(text, open, end);
  if (close === -1) return null;
  const tail = /^\s*(?:->\s*([^$]+?))?\s*(?:\bwhere\b[\s\S]*)?$/.exec(text.slice(close + 1, end));
  const params = arity(text.slice(open + 1, close));
  if (!tail || !params) return null;
  return { ...params, ret: (tail[1] ?? "").replace(/\s+/g, " ").trim() };
}

/** As `rustSignature`, for a definition: the return type runs up to the body's `{`. */
function rustDefinition(text: string, open: number): Signature | null {
  const close = matching(text, open);
  if (close === -1) return null;
  const body = text.indexOf("{", close);
  return body === -1 ? null : rustSignature(text, open, body);
}

function addRustSite(symbol: string, where: string, sig: Signature) {
  addSite(symbol, { where, lang: "rust", ...sig, width: rustWidth(sig.ret) });
}

function scanRust(rel: string, original: string) {
  const text = blank(original, "rust");
  const lines = lineStarts(text);

  // 1. Items of extern blocks.
  for (const m of text.matchAll(RUST_BLOCK_OPEN)) {
    let open = m.index! + m[0].length - 1;
    let close = matching(text, open);
    if (close === -1) continue;
    // `jsc_abi_extern! { #[outer] { items } }` nests the items one level down.
    const wrapped = takeAttributes(text.slice(open + 1, close));
    if (wrapped.end !== -1 && text[open + 1 + wrapped.end] === "{") {
      open += 1 + wrapped.end;
      close = matching(text, open, close);
      if (close === -1) continue;
    }
    // Items end at a `;` outside brackets (`[u8; 4]` keeps its `;` inside `[]`).
    let itemStart = open + 1;
    let depth = 0;
    for (
      let m = nextMatch(RUST_ITEM_DELIMS, text, itemStart);
      m !== null && m.index < close;
      m = nextMatch(RUST_ITEM_DELIMS, text, m.index + 1)
    ) {
      const c = m[0];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (depth === 0) {
        rustBlockItem(rel, text, lines, itemStart, m.index);
        itemStart = m.index + 1;
      }
    }
    rustBlockItem(rel, text, lines, itemStart, close); // a last item without `;`
  }

  // 2. `#[unsafe(no_mangle)]` / `#[unsafe(export_name = "..")]` definitions.
  for (const m of text.matchAll(RUST_EXPORT_ATTR)) {
    const after = m.index! + m[0].length;
    const more = takeAttributes(text.slice(after, after + HEADER_WINDOW));
    if (more.end === -1) continue;
    const headStart = after + more.end;
    const head = RUST_EXPORT_HEAD.exec(text.slice(headStart, headStart + HEADER_WINDOW));
    if (!head) continue;
    const open = headStart + head[0].length - 1;
    const sig = rustDefinition(text, open);
    if (sig) addRustSite(m[1] ?? head[1], `${rel}:${lineOf(lines, open)}`, sig);
  }

  // 3. `// HOST_EXPORT(Symbol[, abi])` impls. The marker is a comment, so it is
  //    found in the original text; the impl header after it is read from the
  //    blanked text at the same offsets. Same scan roots as the generator
  //    (src/runtime and src/jsc, minus */bindings/*).
  if (!/^src\/(?:runtime|jsc)\//.test(rel) || rel.includes("/bindings/")) return;
  for (const m of original.matchAll(HOST_EXPORT_MARKER)) {
    if (m[2] === "rust") continue; // an `extern "Rust"` hook, never declared by C++
    const after = m.index! + m[0].length;
    const more = takeAttributes(text.slice(after, after + HEADER_WINDOW));
    if (more.end === -1) continue;
    const headStart = after + more.end;
    const head = HOST_EXPORT_HEAD.exec(text.slice(headStart, headStart + HEADER_WINDOW));
    if (!head) continue;
    const open = headStart + head[0].length - 1;
    const sig = rustDefinition(text, open);
    if (!sig) continue;
    if (JS_RESULT_JSVALUE.test(sig.ret)) sig.ret = "JSValue";
    addRustSite(m[1], `${rel}:${lineOf(lines, open)}`, sig);
  }
}

function rustBlockItem(rel: string, text: string, lines: number[], start: number, end: number) {
  const item = text.slice(start, end);
  if (item.includes("$")) return; // a macro_rules! template, not a declaration
  const { attrs, end: headOffset } = takeAttributes(item);
  if (headOffset === -1) return;
  const head = RUST_ITEM_HEAD.exec(item.slice(headOffset));
  if (!head) return;
  let symbol = head[1];
  const renames = attrs.filter(a => a.includes("link_name"));
  if (renames.length) {
    // Only a plain literal rename names one symbol: `concat!(..)` link names
    // are per-instantiation and `cfg_attr(.., link_name = ..)` per-target.
    const literal = renames.length === 1 ? RUST_LINK_NAME.exec(renames[0]) : null;
    if (!literal) return;
    symbol = literal[1];
  }
  const open = start + headOffset + head[0].length - 1;
  const sig = rustSignature(text, open, end);
  if (sig) addRustSite(symbol, `${rel}:${lineOf(lines, open)}`, sig);
}

// ─────────────────────────────── C++ sites ──────────────────────────────────

const CXX_OPEN = new RegExp(String.raw`\bextern\s+"C"|\b(?:${CXX_OPENER_MACROS})\b`, "g");
// Built-in type words: one of these directly before the `(` means the item is
// a function-pointer declarator (`void (*fp)(..)`), not a function.
const CXX_TYPE_WORDS = new Set([
  "void",
  "bool",
  "char",
  "short",
  "int",
  "long",
  "signed",
  "unsigned",
  "float",
  "double",
  "auto",
  "const",
]);
// Items that are never plain function declarators, whatever else they contain.
const CXX_NOT_A_FUNCTION = /##|\b(?:static|typedef|using|template|operator|namespace)\b/;
const CXX_ITEM_DELIMS = /[(){};=]/g;
const CXX_STATEMENT_DELIMS = /[()[\]{};]/g;

function scanCxx(rel: string, original: string) {
  const text = blank(original, "c++");
  const lines = lineStarts(text);
  for (const m of text.matchAll(CXX_OPEN)) {
    const at = skipSpace(text, m.index! + m[0].length);
    if (text[at] !== "{") {
      cxxItems(rel, text, lines, at, text.length, 1);
      continue;
    }
    const close = matching(text, at);
    if (close !== -1) cxxItems(rel, text, lines, at + 1, close, Infinity);
  }
}

/**
 * Walk up to `limit` items in [start, end). A declaration ends at `;`, a
 * definition (or a struct/enum) at its `{..}` body, and `= ..` marks a
 * variable whose initializer is skipped through to its `;`.
 */
function cxxItems(rel: string, text: string, lines: number[], start: number, end: number, limit: number) {
  let i = start;
  while (i < end && limit-- > 0) {
    let depth = 0;
    let term: RegExpExecArray | null = null;
    for (
      let m = nextMatch(CXX_ITEM_DELIMS, text, i);
      m !== null && m.index < end;
      m = nextMatch(CXX_ITEM_DELIMS, text, m.index + 1)
    ) {
      if (m[0] === "(") depth++;
      else if (m[0] === ")") depth--;
      else if (depth === 0) {
        term = m;
        break;
      }
    }
    if (term === null || term[0] === "}") return; // unbalanced: give up on the rest of this block
    if (term[0] === "=") {
      i = statementEnd(text, term.index, end);
      continue;
    }
    cxxItem(rel, text, lines, i, term.index);
    if (term[0] === ";") {
      i = term.index + 1;
      continue;
    }
    const close = matching(text, term.index, end);
    if (close === -1) return;
    i = close + 1;
  }
}

/** Offset just past the `;` ending the statement that continues at `from`, skipping nested brackets. */
function statementEnd(text: string, from: number, end: number): number {
  let depth = 0;
  for (
    let m = nextMatch(CXX_STATEMENT_DELIMS, text, from);
    m !== null && m.index < end;
    m = nextMatch(CXX_STATEMENT_DELIMS, text, m.index + 1)
  ) {
    const c = m[0];
    if (c === ";") {
      if (depth === 0) return m.index + 1;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else depth--;
  }
  return end;
}

function cxxItem(rel: string, text: string, lines: number[], start: number, end: number) {
  const raw = text.slice(start, end);
  if (CXX_NOT_A_FUNCTION.test(raw)) return;
  const header = stripCxxDecorations(raw);
  const open = header.indexOf("(");
  if (open === -1) return;
  const name = /(\w+)\s*$/.exec(header.slice(0, open));
  if (!name || !/^[A-Za-z_]/.test(name[1]) || CXX_TYPE_WORDS.has(name[1])) return;
  const ret = header.slice(0, name.index).replace(/\s+/g, " ").trim();
  if (ret === "") return; // a macro invocation such as JSC_DEFINE_HOST_FUNCTION(..)
  const close = matching(header, open);
  // Only bare words (`noexcept`) may follow the parameter list; `(*f(int))(int)`
  // declarators, `asm("..")` renames and the like are skipped.
  if (close === -1 || !/^[\w\s]*$/.test(header.slice(close + 1))) return;
  const params = arity(header.slice(open + 1, close), "void");
  if (!params) return;
  addSite(name[1], {
    where: `${rel}:${lineOf(lines, start + name.index)}`,
    lang: "c++",
    ...params,
    ret,
    width: cxxWidth(ret),
  });
}

// ──────────────────────────────── driver ────────────────────────────────────

const RUST_PREFILTER = /\bextern\s+"(?:C|C-unwind|sysv64)"|jsc_abi_extern!|no_mangle|export_name|HOST_EXPORT\(/;
const CXX_PREFILTER = new RegExp(String.raw`extern\s+"C"|${CXX_OPENER_MACROS}`);

let rustScanned = 0;
let cxxScanned = 0;
for (const abs of rustFiles) {
  const rel = trackedRelative(abs);
  if (rel === null) continue;
  rustScanned++;
  const content = readFileSync(abs, "utf8");
  if (RUST_PREFILTER.test(content)) scanRust(rel, content);
}
for (const abs of cxxFiles) {
  const rel = trackedRelative(abs);
  if (rel === null) continue;
  cxxScanned++;
  const content = readFileSync(abs, "utf8");
  if (CXX_PREFILTER.test(content)) scanCxx(rel, content);
}

const describeSite = (s: Site) =>
  `${s.lang} ${s.where}: ${s.params}${s.variadic ? "+..." : ""} params, returns ${s.ret || "void"}`;
const report = (symbol: string, list: Site[]) => `${symbol}\n    ${list.map(describeSite).join("\n    ")}`;

const arityMismatches: string[] = [];
const returnWidthMismatches: string[] = [];
let crossLanguage = 0;
for (const symbol of [...sites.keys()].sort()) {
  const list = sites.get(symbol)!;
  if (list.length < 2) continue;
  if (list.some(s => s.lang === "rust") && list.some(s => s.lang === "c++")) crossLanguage++;
  if (new Set(list.map(s => `${s.params}/${s.variadic}`)).size > 1) arityMismatches.push(report(symbol, list));
  if (new Set(list.map(s => s.width).filter(Boolean)).size > 1) returnWidthMismatches.push(report(symbol, list));
}

if (process.env.EXTERN_C_LINT_DEBUG) {
  const all = [...sites.values()].flat();
  console.log({
    rustScanned,
    cxxScanned,
    symbols: sites.size,
    rustSites: all.filter(s => s.lang === "rust").length,
    cxxSites: all.filter(s => s.lang === "c++").length,
    crossLanguage,
  });
  for (const symbol of process.env.EXTERN_C_LINT_DEBUG.split(",")) {
    console.log(sites.has(symbol) ? report(symbol, sites.get(symbol)!) : `${symbol}: no sites recorded`);
  }
}

// ───────────────────────────────── tests ────────────────────────────────────

/** Scan a snippet into a private map and summarise it as `symbol -> "params -> ret"`. */
function scanSnippet(lang: "rust" | "c++", source: string): Record<string, string> {
  const real = sites;
  sites = new Map();
  try {
    if (lang === "rust") scanRust("src/runtime/snippet.rs", source);
    else scanCxx("snippet.cpp", source);
    return Object.fromEntries(
      [...sites].map(([symbol, list]) => [
        symbol,
        list.map(s => `${s.params}${s.variadic ? "+..." : ""} -> ${s.ret || "()"} [${s.width}]`).join(" | "),
      ]),
    );
  } finally {
    sites = real;
  }
}

test("the Rust scanner reads the shapes it claims to", () => {
  expect(
    scanSnippet(
      "rust",
      `
      /// Doc mentioning extern "C" { fn Decoy(); } must not count; nor "a string; with } braces".
      #[link(name = "x")]
      unsafe extern "C" {
          pub(crate) safe fn Plain(a: &Foo, b: *mut [u8; 4]) -> u32;
          #[cfg(unix)]
          #[link_name = "Renamed__symbol"]
          fn renamed(cb: Option<unsafe extern "C" fn(*mut c_void, u32) -> bool>, n: usize) -> Option<NonNull<Foo>>;
          #[link_name = concat!("Generated", "__fromJS")]
          fn per_instantiation(v: JSValue);
          fn Variadic(fmt: *const c_char, ...) -> c_int;
          static GLOBAL: u32;
          fn NoReturn() -> !;
      }
      bun_jsc::jsc_abi_extern! {
          #[allow(improper_ctypes)]
          {
              #[link_name = "Wrapped__create"]
              safe fn __create(global: &JSGlobalObject, ptr: *mut Payload) -> JSValue;
          }
      }
      macro_rules! decl { ($n:ident) => { unsafe extern "C" { fn $n(x: u8); fn fixed(x: $T); } }; }
      #[unsafe(no_mangle)]
      #[allow(non_snake_case)]
      pub unsafe extern "C" fn Exported(this: &mut Foo, len: usize) -> bool { todo!() }
      #[unsafe(export_name = "Exported__renamed")]
      extern "C" fn exported_impl() -> core::ffi::c_int { 0 }
      #[unsafe(no_mangle)]
      pub extern "Rust" fn rust_abi() {}
      #[unsafe(no_mangle)]
      static ALSO_EXPORTED: u32 = 0;
      // HOST_EXPORT(Host__thunk)
      pub fn host_thunk(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> { todo!() }
      // HOST_EXPORT(Host__generic, c)
      #[inline]
      pub unsafe fn host_generic(vm: &VirtualMachine, code: u8) { todo!() }
      // HOST_EXPORT(Host__rust_hook, rust)
      pub fn host_rust_hook(a: u8) -> u8 { a }
      `,
    ),
  ).toEqual({
    Plain: "2 -> u32 [32]",
    Renamed__symbol: "2 -> Option<NonNull<Foo>> [64]",
    Variadic: "1+... -> c_int [32]",
    NoReturn: "0 -> ! [void]",
    Wrapped__create: "2 -> JSValue [64]",
    Exported: "2 -> bool [bool]",
    Exported__renamed: "0 -> core::ffi::c_int [32]",
    Host__thunk: "2 -> JSValue [64]",
    Host__generic: "2 -> () [void]",
  });
});

test("the C++ scanner reads the shapes it claims to", () => {
  expect(
    scanSnippet(
      "c++",
      `
      #define DECOY(name) extern "C" void name(int, int, int);
      // extern "C" void Commented(int);
      extern "C" [[ZIG_EXPORT(nothrow)]] size_t Attributed(const char* s, size_t len);
      extern "C" JSC::EncodedJSValue SYSV_ABI HostCall(JSC::JSGlobalObject*, JSC::CallFrame*);
      extern "C" __attribute__((visibility("default"))) bool Visible(void);
      extern "C" int Variadic(const char* fmt, ...);
      extern "C" int TakesCallback(void (*cb)(void*, int), WTF::Vector<int, 4>* out);
      extern "C" void (*FunctionPointerVariable)(int);
      extern "C" const char* StringVariable = "not; a(function)";
      extern "C" JSC_DECLARE_HOST_FUNCTION(macroWrapped);
      CPP_DECL WebCore::AbortSignal* HeadersH__decl(WebCore::AbortSignal* arg0, uint8_t reason);
      extern "C" {
          enum class Kind : uint8_t { A, B };
          struct Range { int start; int end; };
          static int file_local(int x) { return x; }
          uint8_t InBlock(Zig::GlobalObject* global, Range* ranges, size_t len)
          {
              const char* s = "}; void Fake(int);";
              if (len == 0) { return '}'; }
              return InBlockDecl(global);
          }
          extern "C" double RepeatsOpener(int);
          #ifdef SOME_PLATFORM
          void EveryPreprocessorArmIsScanned(int a, int b);
          #endif
          unsigned long long Wide();
          long PlatformDependent();
          JS_EXPORT napi_status napi_like(napi_env env, napi_value* result);
      }
      `,
    ),
  ).toEqual({
    Attributed: "2 -> size_t [64]",
    HostCall: "2 -> JSC::EncodedJSValue [64]",
    Visible: "0 -> bool [bool]",
    Variadic: "1+... -> int [32]",
    TakesCallback: "2 -> int [32]",
    HeadersH__decl: "2 -> WebCore::AbortSignal* [64]",
    InBlock: "3 -> uint8_t [8]",
    RepeatsOpener: "1 -> double [f64]",
    EveryPreprocessorArmIsScanned: "2 -> void [void]",
    Wide: "0 -> unsigned long long [64]",
    PlatformDependent: "0 -> long [null]",
    napi_like: "2 -> napi_status [null]",
  });
});

test("scans a non-empty set of tracked Rust and C++ sources", () => {
  expect(rustScanned).toBeGreaterThan(0);
  expect(cxxScanned).toBeGreaterThan(0);
});

test("the scanners still see every declaration shape the tree uses", () => {
  // One [symbol, file] per way the tree spells a declaration. When one of
  // these is renamed or removed, point the entry at another symbol declared
  // the same way rather than deleting it: a shape the scanners silently stop
  // seeing makes the two assertions below pass vacuously for that population.
  const shapes: [shape: string, symbol: string, file: string][] = [
    ['Rust `unsafe extern "C" { .. }` item', "Bun__JSWrappingFunction__create", "src/runtime/test_runner/expect.rs"],
    ["Rust `safe fn` item", "URL__originLength", "src/url/lib.rs"],
    ["Rust `#[unsafe(no_mangle)]` definition", "ByteRangeMapping__getSourceID", "src/sourcemap_jsc/CodeCoverage.rs"],
    [
      "Rust `jsc_abi_extern!` item renamed by `#[link_name]`",
      "Bun__JSRequest__createForBake",
      "src/runtime/webcore/Request.rs",
    ],
    ["Rust `jsc_abi_extern! { #[attr] { .. } }` item", "HTMLBundle__fromJS", "src/runtime/server/HTMLBundle.rs"],
    ["Rust `// HOST_EXPORT(..)` impl", "Bun__isMainThreadVM", "src/runtime/hw_exports.rs"],
    ['C++ `extern "C"` definition', "Bun__JSWrappingFunction__create", "src/jsc/bindings/JSWrappingFunction.cpp"],
    ['C++ `extern "C"` declaration', "ByteRangeMapping__getSourceID", "src/jsc/bindings/ZigSourceProvider.cpp"],
    ['C++ `extern "C" SYSV_ABI` definition', "Bun__JSRequest__createForBake", "src/jsc/bindings/JSBunRequest.cpp"],
    ["C++ `CPP_DECL` declaration", "JSC__JSValue__toInt32", "src/jsc/bindings/headers.h"],
    [
      'C++ definition inside the `extern "C" { .. }` of bindings.cpp',
      "JSC__JSValue__toInt32",
      "src/jsc/bindings/bindings.cpp",
    ],
    [
      'C++ declaration inside the `extern "C" { .. }` of a header',
      "ReadableStream__tee",
      "src/jsc/bindings/webcore/streams/WebStreamsInternals.h",
    ],
    ["C++ declaration of a HOST_EXPORT symbol", "Bun__isMainThreadVM", "src/jsc/bindings/BunProcess.cpp"],
  ];
  const unseen = shapes.filter(([, symbol, f]) => !sites.get(symbol)?.some(s => s.where.startsWith(f + ":")));
  expect(unseen).toEqual([]);
  // Coarse guard against a regression that loses much of a population without
  // touching the samples above (say, a literal-blanking bug swallowing the
  // rest of a file). The tree has well over twice this many.
  expect(crossLanguage).toBeGreaterThan(500);
});

test("every EXEMPT entry still matches a declaration", () => {
  expect(EXEMPT.filter(e => e.matched === 0).map(e => `${e.file} ${e.symbols}: ${e.why}`)).toEqual([]);
});

test('every extern "C" symbol is declared with the same parameter count at every site', () => {
  expect(arityMismatches).toEqual([]);
});

test('every extern "C" symbol is declared with the same return width at every site', () => {
  expect(returnWidthMismatches).toEqual([]);
});
