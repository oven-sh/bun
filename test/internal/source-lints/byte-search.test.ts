import { expect, test } from "bun:test";
import path from "path";
import {
  isPathExpr,
  litNumber,
  parseRustFragment,
  pathEndsWith,
  pathString,
  unwrapParens,
  type Closure,
  type Expr,
  type MethodCall,
  type Pat,
  type RustFile,
  type Type,
} from "../../../scripts/rust-parser/index.ts";
import { ratchet, repoRoot, rustSources } from "./rust-sources.ts";

// Byte / substring search over `&[u8]` must go through `bun_core::strings`
// (highway, runtime-dispatched SIMD), not libcore's element-generic slice and
// iterator methods, which compile to one-byte-at-a-time scalar loops (or, for
// `<[u8]>::contains`, a usize-at-a-time SWAR loop with no vector registers).
//
// The methods whose *every* use is a text search (`str::find`, `str::contains`,
// `slice::windows`, `memchr::*`, `bstr::ByteSlice::find*`, ...) are banned
// type-precisely via `disallowed-methods` in clippy.toml. What's left for this
// file are the element-generic forms clippy can't distinguish by element type —
// `<[T]>::contains` and `Iterator::{position,rposition,any,all,find}` — matched
// here only when the comparand is a byte literal, so `ids.contains(&id)` on a
// `&[u32]` never trips it.
//
//   .contains(&b'x') / .contains(&0)          → strings::contains_char(s, b'x')
//   .iter().position(|&b| b == b'x')          → strings::index_of_char_usize(s, b'x')
//   .iter().position(|&b| b == x || b == y)   → strings::index_of_any(s, b"xy")
//   .iter().rposition(|&b| b == b'x')         → strings::last_index_of_char(s, b'x')
//   .iter().any(|&b| b == b'x')               → strings::contains_char(s, b'x')
//   .iter().all(|&b| b != b'x')               → !strings::contains_char(s, b'x')
//   .iter().filter(|&&b| b == b'x').count()   → strings::count_char(s, b'x')
//   .split(|&b| b == b'x')                    → strings::split(s, b"x")
//
// The query walks every method call in the AST: the receiver must be a
// zero-argument `.iter()` / `.bytes()` (except for `contains` and `split`),
// the argument a one-parameter closure binding the byte as `b`, `&b`, or `&&b`
// (optionally typed `u8` / `&u8`), and the body a `||`-chain of `b == b'x'` /
// `b'x' == b` / `matches!(b, b'x' | b'y')` tests on that binding, `*b` and `**b`
// included. A comparand held in a variable (`|&b| b == sep`) is invisible to
// this lint; use the `strings::` form anyway. A `matches!` with range patterns
// like `b'0'..=b'9'` has no set-membership equivalent and is deliberately not
// matched.

// Proc-macro crates and cargo build scripts run on the host at compile time and
// cannot link the highway C++ objects, so libcore is all they have. Both are
// read off each crate's Cargo.toml rather than guessed from its name.
const hostOnly: string[] = [];
for (const manifest of new Bun.Glob("src/*/Cargo.toml").scanSync({ cwd: repoRoot })) {
  const dir = path.dirname(manifest).replaceAll(path.sep, "/");
  const toml = await Bun.file(path.join(repoRoot, manifest)).text();
  if (/^\s*proc-macro\s*=\s*true\b/m.test(toml)) hostOnly.push(dir + "/");
  const build = /^\s*build\s*=\s*"([^"]+)"/m.exec(toml);
  hostOnly.push(path.posix.join(dir, build ? build[1] : "build.rs"));
}

/**
 * A byte literal (`b'x'`, `b'\n'`, `b'\x1b'`, `b'\''`) or the integer zero (NUL
 * scans). Any spelling of zero counts (`0u8`, `0x00`); the regex this replaced
 * only took a bare `0`.
 */
function isByte(expr: Expr): boolean {
  expr = unwrapParens(expr);
  return expr.kind === "Lit" && (expr.litKind === "byte" || (expr.litKind === "int" && litNumber(expr) === 0));
}

/** `&b'x'` / `&0`: the argument `<[u8]>::contains` takes. */
function isRefToByte(expr: Expr): boolean {
  expr = unwrapParens(expr);
  return expr.kind === "Ref" && !expr.mutable && !expr.raw && isByte(expr.expr);
}

/** `u8` or `&u8`, the only types a byte-iterator closure parameter is written with. */
function isByteType(ty: Type): boolean {
  if (ty.kind === "TypeRef" && !ty.mutable) ty = ty.elem;
  return ty.kind === "TypePath" && ty.path.qself === null && pathString(ty.path) === "u8";
}

/**
 * The name a one-parameter closure binds each byte to: `|b|`, `|&b|`, `|&&b|`,
 * `|b: &u8|`. Null for any other parameter list.
 */
function boundByteName(closure: Closure): string | null {
  if (closure.params.length !== 1) return null;
  const { pat, ty } = closure.params[0];
  if (ty !== null && !isByteType(ty)) return null;
  let p: Pat = pat;
  for (let i = 0; i < 2 && p.kind === "PatRef"; i++) p = p.pat;
  return p.kind === "PatIdent" && p.sub === null ? p.name : null;
}

/** The bound name, optionally dereferenced once or twice (`b`, `*b`, `**b`). */
function isBoundByte(expr: Expr, name: string): boolean {
  expr = unwrapParens(expr);
  for (let i = 0; i < 2 && expr.kind === "Unary" && expr.op === "*"; i++) expr = unwrapParens(expr.expr);
  return isPathExpr(expr, name);
}

/** `b'x' | b'y' | 0`: the pattern side of a `matches!` as a set of byte literals. */
function isByteAlternatives(expr: Expr): boolean {
  expr = unwrapParens(expr);
  if (expr.kind === "Binary" && expr.op === "|") return isByteAlternatives(expr.left) && isByteAlternatives(expr.right);
  return isByte(expr);
}

/** One membership test: `b == b'x'`, `b'x' == b`, or `matches!(b, b'x' | b'y')`. */
function isByteEq(expr: Expr, name: string): boolean {
  expr = unwrapParens(expr);
  if (expr.kind === "Binary" && expr.op === "==") {
    return (isBoundByte(expr.left, name) && isByte(expr.right)) || (isByte(expr.left) && isBoundByte(expr.right, name));
  }
  if (expr.kind === "Macro" && pathEndsWith(expr.path, "matches") && expr.args.length === 2) {
    const [subject, pattern] = expr.args;
    return subject !== null && pattern !== null && isBoundByte(subject, name) && isByteAlternatives(pattern);
  }
  return false;
}

/** A `||`-chain of membership tests. */
function isByteEqChain(expr: Expr, name: string): boolean {
  expr = unwrapParens(expr);
  if (expr.kind === "Binary" && expr.op === "||")
    return isByteEqChain(expr.left, name) && isByteEqChain(expr.right, name);
  return isByteEq(expr, name);
}

/** `|&b| b == b'x' || b == b'y'`: a closure that tests the byte for set membership. */
function isByteEqClosure(expr: Expr): boolean {
  expr = unwrapParens(expr);
  if (expr.kind !== "Closure") return false;
  const name = boundByteName(expr);
  return name !== null && isByteEqChain(expr.body, name);
}

/**
 * `|&b| b != b'x'`: a closure that tests the byte for inequality with one
 * literal. Either operand order counts; the regex this replaced only took
 * `b != b'x'`.
 */
function isByteNeClosure(expr: Expr): boolean {
  expr = unwrapParens(expr);
  if (expr.kind !== "Closure") return false;
  const name = boundByteName(expr);
  if (name === null) return false;
  const body = unwrapParens(expr.body);
  if (body.kind !== "Binary" || body.op !== "!=") return false;
  return (isBoundByte(body.left, name) && isByte(body.right)) || (isByte(body.left) && isBoundByte(body.right, name));
}

/** A zero-argument `.iter()` / `.bytes()`: the receiver of the iterator forms. */
function isByteIterator(expr: Expr): boolean {
  expr = unwrapParens(expr);
  return expr.kind === "MethodCall" && (expr.method === "iter" || expr.method === "bytes") && expr.args.length === 0;
}

/** `.iter().<method>(|&b| b == b'x')` / `.bytes().<method>(...)`. */
function isByteIteratorSearch(expr: Expr, method: string): boolean {
  expr = unwrapParens(expr);
  return (
    expr.kind === "MethodCall" &&
    expr.method === method &&
    isByteIterator(expr.receiver) &&
    expr.args.length === 1 &&
    isByteEqClosure(expr.args[0])
  );
}

const BANNED: { name: string; matches: (call: MethodCall) => boolean; hint: string }[] = [
  {
    name: "<[u8]>::contains(&byte)",
    matches: call => call.method === "contains" && call.args.length === 1 && isRefToByte(call.args[0]),
    hint: "strings::contains_char(s, b)",
  },
  {
    name: "iter().position(|b| b == byte)",
    matches: call => isByteIteratorSearch(call, "position"),
    hint: 'strings::index_of_char_usize(s, b) / strings::index_of_any(s, b"..")',
  },
  {
    name: "iter().rposition(|b| b == byte)",
    matches: call => isByteIteratorSearch(call, "rposition"),
    hint: "strings::last_index_of_char(s, b)",
  },
  {
    name: "iter().any(|b| b == byte)",
    matches: call => isByteIteratorSearch(call, "any"),
    hint: 'strings::contains_char(s, b) / strings::index_of_any(s, b"..").is_some()',
  },
  {
    name: "iter().all(|b| b != byte)",
    matches: call =>
      call.method === "all" && isByteIterator(call.receiver) && call.args.length === 1 && isByteNeClosure(call.args[0]),
    hint: "!strings::contains_char(s, b)",
  },
  {
    name: "iter().find(|b| b == byte)",
    matches: call => isByteIteratorSearch(call, "find"),
    hint: "strings::index_of_char_usize(s, b)",
  },
  {
    // Reported at the `.count()`; a bare `.filter(|&b| b == b'x')` that feeds
    // anything else is not in the list.
    name: "iter().filter(|b| b == byte).count()",
    matches: call => call.method === "count" && call.args.length === 0 && isByteIteratorSearch(call.receiver, "filter"),
    hint: "strings::count_char(s, b)",
  },
  {
    name: "<[u8]>::split(|b| b == byte)",
    matches: call => call.method === "split" && call.args.length === 1 && isByteEqClosure(call.args[0]),
    hint: 'strings::split(s, b"x") / strings::split_any(s, b"xy")',
  },
];

/**
 * Every method call in the file that is one of the banned shapes. A call
 * matches at most one entry: they are keyed by method name.
 */
function findByteSearches(file: RustFile): { name: string; hint: string; call: MethodCall }[] {
  const out: { name: string; hint: string; call: MethodCall }[] = [];
  for (const call of file.find("MethodCall")) {
    const banned = BANNED.find(b => b.matches(call));
    if (banned) out.push({ name: banned.name, hint: banned.hint, call });
  }
  return out;
}

// Documented, ratcheted exceptions: `file: count`. Prefer converting over
// adding an entry here.
const ALLOW: Record<string, number> = {
  // `#[cfg(test)]` unit test built only by `cargo test -p bun_collections`,
  // which does not link the highway objects.
  "src/collections/linear_fifo.rs": 1,
};

const sources = rustSources({ exclude: hostOnly });
const findings: { path: string; message: string }[] = [];
for (const src of sources) {
  for (const { name, hint, call } of findByteSearches(src.file)) {
    findings.push({
      path: src.path,
      message: `${src.file.location(call)}: ${name}: \`${src.file.text(call).replace(/\s+/g, " ")}\` → ${hint}`,
    });
  }
}
const { offenders, stale } = ratchet(findings, ALLOW);

test("scans a non-empty set of tracked Rust sources", () => {
  expect(sources.length).toBeGreaterThan(0);
});

test("the query recognizes the spellings it claims to", () => {
  const names = (snippet: string) => findByteSearches(parseRustFragment(snippet)).map(f => f.name);
  const banned: [string, string][] = [
    ["s.contains(&b'x')", "<[u8]>::contains(&byte)"],
    ["s.contains(&0)", "<[u8]>::contains(&byte)"],
    ["s.contains(&b'\\'')", "<[u8]>::contains(&byte)"],
    ["s.iter().position(|&b| b == b'x')", "iter().position(|b| b == byte)"],
    ["s.iter().position(|&b| b == b'/' || b == b'\\\\')", "iter().position(|b| b == byte)"],
    ["s.bytes().position(|b| b == b'x')", "iter().position(|b| b == byte)"],
    ["s.iter().position(|b: &u8| *b == b'\\x1b')", "iter().position(|b| b == byte)"],
    ["s.iter().rposition(|&b| b == b'/')", "iter().rposition(|b| b == byte)"],
    ["s.iter().any(|&b| b == b'x')", "iter().any(|b| b == byte)"],
    ["s.iter().any(|&b| b'x' == b)", "iter().any(|b| b == byte)"],
    ["s.iter().any(|b| matches!(*b, b'\\n' | b'\\r' | 0))", "iter().any(|b| b == byte)"],
    ["s.iter().any(|b| **b == 0 || matches!(**b, b'a' | b'b'))", "iter().any(|b| b == byte)"],
    ["s.iter().all(|&b| b != b'x')", "iter().all(|b| b != byte)"],
    ["s.iter().all(|b: &u8| *b != 0)", "iter().all(|b| b != byte)"],
    ["s.iter().find(|&&b| b == b'x')", "iter().find(|b| b == byte)"],
    ["s.iter().filter(|&&b| b == b'x').count()", "iter().filter(|b| b == byte).count()"],
    ["s.split(|&b| b == b'x')", "<[u8]>::split(|b| b == byte)"],
    ["s.split(|&c| c == b' ' || c == b'\\t')", "<[u8]>::split(|b| b == byte)"],
    // rustfmt-wrapped and parenthesised spellings, and a macro argument.
    [
      "let n = self\n    .buf\n    .iter()\n    .filter(|&&b| b == b'\\n')\n    .count();",
      "iter().filter(|b| b == byte).count()",
    ],
    ["s.iter().any(|&b| (b == b'x'))", "iter().any(|b| b == byte)"],
    ["debug_assert!(!s.iter().any(|&b| b == 0));", "iter().any(|b| b == byte)"],
  ];
  const allowed = [
    // Element-generic uses on other element types.
    "ids.contains(&id)",
    's.contains(&b"xy")',
    "s.iter().any(|&b| b.is_ascii_digit())",
    // A range pattern has no set-membership equivalent.
    "s.iter().any(|&b| matches!(b, b'0'..=b'9'))",
    "s.iter().any(|&b| matches!(b, b'0'..=b'9' | b'_'))",
    // A comparand held in a variable is invisible to this lint.
    "s.iter().position(|&b| b == sep)",
    "s.iter().all(|&b| b != sep)",
    "s.split(|&b| b == sep)",
    // `&&` is a conjunction, not a set.
    "s.iter().position(|&b| b == b'x' && b != 0)",
    // `.filter()` without `.count()` is not in the list.
    "s.iter().filter(|&&b| b == b'x')",
    "s.iter().filter(|&&b| b == b'x').map(|b| b).count()",
    // The closure must bind exactly one byte.
    "s.iter().any(|a, b| a == b'x')",
    "s.iter().enumerate().any(|(_, &b)| b == b'x')",
    // The receiver must be `.iter()` / `.bytes()`.
    "it.position(|&b| b == b'x')",
    "s.chars().any(|c| c == 'x')",
    // Prose about the shape is not the shape.
    "// s.iter().any(|&b| b == b'x')",
    "log(\"s.iter().any(|&b| b == b'x')\");",
  ];
  // Each banned snippet is reported once, under its own name.
  expect(banned.map(([snippet]) => [snippet, names(snippet)])).toEqual(
    banned.map(([snippet, name]) => [snippet, [name]]),
  );
  expect(allowed.filter(s => names(s).length > 0)).toEqual([]);
});

test("byte search goes through bun_core::strings (highway), not libcore scalar loops", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  expect(stale).toEqual([]);
});
