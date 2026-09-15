// Tests for scripts/rust-parser, the Rust parser the other lints in this
// directory are built on. Two layers:
//
//   - grammar: small inputs rendered as s-expressions (scripts/rust-parser/debug.ts),
//     one table per syntactic category;
//   - the tree: every tracked `.rs` file must parse, child enumeration must
//     agree with field reflection, spans must nest.
//
// When a lint starts failing with a `RustParseError`, the fix belongs here:
// add the construct to a table below, then teach the parser.

import { describe, expect, test } from "bun:test";
import { sexpr } from "../../../scripts/rust-parser/debug.ts";
import {
  children,
  childrenReflective,
  litNumber,
  litString,
  metaItemPaths,
  metaLists,
  parseRust,
  parseRustExpr,
  parseRustFragment,
  parseRustPat,
  parseRustType,
  pathEndsWith,
  pathString,
  RustParseError,
  walk,
  type Fn,
  type Node,
} from "../../../scripts/rust-parser/index.ts";
import { ratchet, rustSources } from "./rust-sources.ts";

function table(name: string, parse: (src: string) => unknown, cases: [string, string][]) {
  describe(name, () => {
    for (const [input, expected] of cases) {
      test(input, () => {
        expect(sexpr(parse(input))).toBe(expected);
      });
    }
  });
}

table("expressions", parseRustExpr, [
  ["a + b * c - d", "(- (+ a (* b c)) d)"],
  ["a = b = c", "(= a (= b c))"],
  ["x += 1", "(+= x 1)"],
  ["x as u8 as u32", "(as (as x u8) u32)"],
  ["-x as u8", "(as (- x) u8)"],
  ["x as usize <= y", "(<= (as x usize) y)"],
  ["1 < 2 as u8", "(< 1 (as 2 u8))"],
  ["&*x", "(&(* x))"],
  ["&&x", "(&(&x))"],
  ["&mut *p", "(&mut (* p))"],
  ["&raw mut *self", "(&raw mut (* self))"],
  ["&raw const x.y", "(&raw const (.y x))"],
  ["!a && !b", "(&& (! a) (! b))"],
  ["a == b && c || d", "(|| (&& (== a b) c) d)"],
  ["a | b & c ^ d", "(| a (^ (& b c) d))"],
  // A comment between two operator characters keeps them apart.
  ["a &/* and */& b", "(& a (&b))"],
  ["a &// and\n& b", "(& a (&b))"],
  ["x <//\n-1", "(< x (- 1))"],
  ["a << 1 + 2", "(<< a (+ 1 2))"],
  ["a..b", "(range a b)"],
  ["a..=b", "(range= a b)"],
  ["..=5", "(range= _ 5)"],
  ["a..", "(range a _)"],
  ["..", "(range _ _)"],
  ["x[1..]", "(index x (range 1 _))"],
  ["x[..=2]", "(index x (range= _ 2))"],
  ["x.0.1", "(.1 (.0 x))"],
  ["x.0.len()", "(.len (.0 x) [])"],
  ["x.await.y", "(.y (await x))"],
  ["f(a)(b)[c]?.await", "(await (? (index (call (call f [a]) [b]) c)))"],
  ["x?.y?.z()?", "(? (.z (? (.y (? x))) []))"],
  ["x.collect::<Vec<_>>()", "(.collect::<Vec<_>> x [])"],
  ["heap::take(std::ptr::from_mut::<Self>(self))", "(call heap::take [(call std::ptr::from_mut::<Self> [self])])"],
  ["<T as Trait>::method(x)", "(call <T as Trait>::method [x])"],
  ["<[u8]>::len(s)", "(call <[u8]>::len [s])"],
  ["::std::mem::swap(a, b)", "(call ::std::mem::swap [a b])"],
  ["Foo::<u8>::new()", "(call Foo::<u8>::new [])"],
  ["S { a, b: 1, ..base }", "(struct S [a b:1] ..base)"],
  ["S { .. }", "(struct S [] .._)"],
  ["S::<T> { 0: x }", "(struct S::<T> [0:x])"],
  ["|a, &b, (c, d): (u8, u8)| a + b", "(closure [a (&b) (ptuple [c d]):(u8,u8)] (+ a b))"],
  ["|| x = 5", "(closure [] (= x 5))"],
  ["move || -> u8 { 1 }", "(closure move [] -> u8 {1})"],
  ["async move |x| x", "(closure move async [x] x)"],
  ["async move { x }", "(async move {x})"],
  ["unsafe { &mut *p }.foo()", "(.foo (unsafe {(&mut (* p))}) [])"],
  ["const { 1 }", "(const {1})"],
  ["if a == b { 1 } else if c { 2 } else { 3 }", "(if (== a b) {1} else (if c {2} else {3}))"],
  ["if let Some(x) = y && z == w { x }", "(if (&& (let (Some [x]) = y) (== z w)) {x})"],
  ["if x == S { 1 }", "(if (== x S) {1})"],
  ["match x { A | B if c => 1, _ => { 2 } }", "(match x [(arm (| [A B]) if c => 1) (arm _ => {2})])"],
  ["match x { 1 => {} _ => () }", "(match x [(arm 1 => {}) (arm _ => (tuple []))])"],
  ["loop { break 1 }", "(loop {(break 1)})"],
  ["'a: loop { break 'a }", "(loop 'a {(break 'a _)})"],
  ["'b: { break 'b 2 }", "'b: {(break 'b 2)}"],
  ["for (i, x) in v.iter().enumerate() { }", "(for (ptuple [i x]) in (.enumerate (.iter v []) []) {})"],
  ["while let Some(x) = it.next() { }", "(while (let (Some [x]) = (.next it [])) {})"],
  ["return", "(return _)"],
  ["return x?", "(return (? x))"],
  ["[0u8; 4]", "(repeat 0u8 4)"],
  ["[1, 2, 3]", "(array [1 2 3])"],
  ["(1,)", "(tuple [1])"],
  ["(1)", "(paren 1)"],
  ["()", "(tuple [])"],
  ["b'a' == c || c == 0", "(|| (== b'a' c) (== c 0))"],
  ["matches!(b, b'a' | b'b')", "(macro matches!( [b (| b'a' b'b')])"],
  ["matches!(x, Some(_))", "(macro matches!( [x (call Some [_])])"],
  ['format!("{} {}", a, b)', '(macro format!( ["{} {}" a b])'],
  ["vec![0; n]", "(macro vec![ [_])"],
  ["bun_core::owned_task!(Foo, run)", "(macro bun_core::owned_task!( [Foo run])"],
  [
    "x = y.map(|v| v + 1).unwrap_or(JSValue::ZERO)",
    "(= x (.unwrap_or (.map y [(closure [v] (+ v 1))]) [JSValue::ZERO]))",
  ],
  ["_ = x", "(= _ x)"],
  ["(a, b) = (b, a)", "(= (tuple [a b]) (tuple [b a]))"],
  ["a - -1", "(- a (- 1))"],
  ["#[cfg(x)] 1", "1"],
  ["r#try.r#match()", "(.r#match r#try [])"],
  ['c"hello"', 'c"hello"'],
  ['br#"raw"#', 'br#"raw"#'],
  ["1_000.5e-3f32", "1_000.5e-3f32"],
  ["'\\u{1F600}'", "'\\u{1F600}'"],
  ["x.collect::<Vec<Vec<u8>>>()", "(.collect::<Vec<Vec<u8>>> x [])"],
  ["a as f64 / b", "(/ (as a f64) b)"],
  ["a < b as u8", "(< a (as b u8))"],
  ["!x as u8", "(as (! x) u8)"],
  ["-x.abs()", "(- (.abs x []))"],
  ["t.0.0.0", "(.0 (.0 (.0 t)))"],
  ["y as *const T as usize", "(as (as y *const T) usize)"],
  ["S { a: { 1 }, b: if c { 1 } else { 2 } }", "(struct S [a:{1} b:(if c {1} else {2})])"],
  ["return if a { b } else { c }", "(return (if a {b} else {c}))"],
  ["matches!(x, Foo { a: 1, .. })", "(macro matches!( [x (struct Foo [a:1] .._)])"],
  ["1 << 3 | 4", "(| (<< 1 3) 4)"],
  ["for i in 0.. { }", "(for i in (range 0 _) {})"],
  ["x.f(|a| { a }).g(async move { b })", "(.g (.f x [(closure [a] {a})]) [(async move {b})])"],
]);

table("types", parseRustType, [
  ["&'a mut [u8]", "&'a mut [u8]"],
  ["&&str", "&&str"],
  ["*const c_void", "*const c_void"],
  ["Vec<Vec<u8>>", "Vec<Vec<u8>>"],
  ["Box<dyn Fn(&str) -> Result<(), E> + Send + 'static>", "Box<dyn Fn(&str)->Result<(),E>+Send+'static>"],
  ["impl Iterator<Item = u8> + use<'a, T>", "impl Iterator<Item=u8>+use<'a,T>"],
  ["fn(u8, ...) -> !", "fn(u8,...)->!"],
  ['unsafe extern "C" fn(*mut c_void)', 'unsafe extern "C" fn(*mut c_void)'],
  ["for<'a> fn(&'a u8) -> &'a u8", "for<'a> fn(&'a u8)->&'a u8"],
  ["<T as Trait>::Assoc<U>", "<T as Trait>::Assoc<U>"],
  ["(u8, (), [u8; 4])", "(u8,(),[u8; 4])"],
  ["Foo<N = 3>", "Foo<N=3>"],
  ["Foo<{ N + 1 }, -1, true>", "Foo<{{(+ N 1)}},{(- 1)},{true}>"],
  ["dyn for<'a> Fn(&'a T)", "dyn for<'a> Fn(&'a T)"],
  ["&(dyn A + B)", "&(paren dyn A+B)"],
  ["Foo<Item: Iterator<Item = u8>>", "Foo<Item:Iterator<Item=u8>>"],
  ["Vec<<T as Tr>::X>", "Vec<<T as Tr>::X>"],
  ["impl ?Sized", "impl ?Sized"],
  ["impl ~const Trait", "impl ~const Trait"],
  ["Option<fn()>", "Option<fn()>"],
  ["_", "_"],
  ["foo!(x)", "(macro foo!( [x])"],
  ["dyn Fn(&mut Y) -> Z + Send + Sync", "dyn Fn(&mut Y)->Z+Send+Sync"],
  ["&&[u8]", "&&[u8]"],
  ["[u8; N * 2]", "[u8; (* N 2)]"],
  ["Lazy<Mutex<Vec<u8>>>", "Lazy<Mutex<Vec<u8>>>"],
  ["fn(x: u8, _: u8)", "fn(x:u8,_:u8)"],
]);

table("patterns", parseRustPat, [
  ["_", "_"],
  ["mut x", "mut x"],
  ["ref mut x @ Some(_)", "ref mut x@(Some [_])"],
  ["&(a, b)", "(&(ptuple [a b]))"],
  ["&&x", "(&(&x))"],
  ["Some(x) | None", "(| [(Some [x]) None])"],
  ["| A | B", "(| [A B])"],
  ["1..=5", "(prange= 1 5)"],
  ["'a'..='z'", "(prange= 'a' 'z')"],
  ["i32::MIN..=-1", "(prange= i32::MIN (- 1))"],
  ["X..", "(prange X _)"],
  ["..=5", "(prange= _ 5)"],
  ["[first, .., last]", "(pslice [first .. last])"],
  ["[a, rest @ ..]", "(pslice [a rest@..])"],
  ["Foo { a, ref b, mut c, d: 1, .. }", "(Foo {a b c d:1 ..})"],
  ["Foo::Bar(..)", "(Foo::Bar [..])"],
  ["<T as Trait>::CONST", "<T as Trait>::CONST"],
  ["Self { x }", "(Self {x})"],
  ["(..)", "(ptuple [..])"],
  ["(a)", "(pparen a)"],
  ["const { N }", "(pconst {N})"],
  ["b'0'..=b'9'", "(prange= b'0' b'9')"],
  ["Some(Foo::<T> { .. })", "(Some [(Foo::<T> { ..})])"],
  ["foo!(x)", "(macro foo!( [x])"],
  ["(a, b) | (b, a)", "(| [(ptuple [a b]) (ptuple [b a])])"],
  ['"str"', '"str"'],
  ['b"x"', 'b"x"'],
  ["crate::a::B(x, ..)", "(crate::a::B [x ..])"],
]);

table("statements", src => (parseRustFragment(src).items[0] as Fn).body, [
  ["let x: u8 = 1;", "{(let x:u8 = 1)}"],
  ["let Some(y) = opt else { return };", "{(let (Some [y]) = opt else {(return _)})}"],
  ["let mut z; z = 2;", "{(let mut z) (= z 2);}"],
  ["if x { } else { }", "{(if x {} else {})}"],
  ["unsafe { write(p, 1) }; x", "{(unsafe {(call write [p 1])}); x}"],
  ["unsafe { read(p) }.foo();", "{(.foo (unsafe {(call read [p])}) []);}"],
  ["match x {}.bar()?;", "{(? (.bar (match x []) []));}"],
  ["{ 1 } - 1", "{{1} (- 1)}"],
  ["loop { break; }", "{(loop {(break _);})}"],
  ["foo! { bar } foo!(baz);", "{(macro foo!{ [bar]) (macro foo!( [baz]);}"],
  [
    "fn inner() {} struct Local; use super::*; const C: u8 = 1;",
    "{(fn inner [] {}) (struct Local unit) (use super::*) (const C:u8 = 1)}",
  ],
  ["#[allow(unused)] let w = 3;", "{(let w = 3)}"],
  ["x;;", "{x; ;}"],
  ["let x: Vec<u8>= vec![];", "{(let x:Vec<u8> = (macro vec![ []))}"],
  ["if x < y { }", "{(if (< x y) {})}"],
  [
    "'a: while let Some(x) = it.next() { continue 'a; }",
    "{(while 'a (let (Some [x]) = (.next it [])) {(continue 'a);})}",
  ],
  ["let (a, b): (u8, u8) = x;", "{(let (ptuple [a b]):(u8,u8) = x)}"],
  ["x?;", "{(? x);}"],
  ["let f: fn(u8) -> u8 = g;", "{(let f:fn(u8)->u8 = g)}"],
  ["*p = unsafe { q };", "{(= (* p) (unsafe {q}));}"],
  ["x = if a { b } else { c };", "{(= x (if a {b} else {c}));}"],
]);

const ITEMS = `
#![allow(dead_code)]
//! crate doc
use std::{collections::HashMap, ptr::{self, NonNull}};
pub use ::core::mem as m;
extern crate alloc;
pub(crate) mod a;
mod b { pub fn f() {} }
pub struct S<'a, T: Clone + 'a = u8, const N: usize = 4> where T: Send { pub(crate) x: &'a T, y: [u8; N] }
struct Unit;
struct Tup(pub u8, (u8, u8));
enum E { A, B(u8), C { x: u8 }, D = 5 }
union U { a: u8, b: f32 }
pub unsafe trait Tr<T>: Send + Sized where Self: Sync {
    const X: u8;
    const Y: u8 = 1;
    type Out<'a>: Iterator where Self: 'a;
    fn f(&self) -> u8;
    fn g(self: Box<Self>) {}
}
impl<T> Tr<T> for S<'_, T> { const X: u8 = 0; type Out<'a> = u8 where Self: 'a; fn f(&self) -> u8 { 0 } }
unsafe impl !Send for Unit {}
impl const Default for Unit { fn default() -> Self { Unit } }
/// Exported.
#[unsafe(no_mangle)]
pub unsafe extern "C-unwind" fn exported(a: u32, ...) -> u32 { a }
pub const fn cf<T>() where T: Copy {}
pub async unsafe fn au() {}
pub static mut COUNTER: u32 = 0;
const _: () = assert!(true);
type Alias<T> = Vec<T>;
unsafe extern "C" { safe fn abort() -> !; pub unsafe fn raw(x: *const c_char, n: usize); static ERRNO: i32; }
extern "C" fn cb(this: *mut Self, _: u32) {}
macro_rules! m { ($x:expr) => { $x }; }
bun_core::impl_foo! { Unit }
foo!(bar);
fn generic<'a, T, const N: usize>(x: &'a [T; N]) -> impl Iterator<Item = &'a T> + 'a where T: 'a { x.iter() }
`;

test("items", () => {
  const file = parseRust(ITEMS, "items.rs");
  expect(file.items.map(i => sexpr(i))).toEqual([
    "(use std::{collections::HashMap, ptr::{self, NonNull}})",
    "(use ::core::mem as m)",
    "(extern crate alloc)",
    "(mod a ;)",
    "(mod b [(fn f [] {})])",
    "(struct S<'a,T:Clone+'a=u8,const N:usize=4> where T:Send [pub(crate) x:&'a T y:[u8; N]])",
    "(struct Unit unit)",
    "(struct Tup [pub :u8 :(u8,u8)])",
    "(enum E [A B[:u8] C[x:u8] D=5])",
    "(union U [a:u8 b:f32])",
    "(trait Tr<T> where Self:Sync: Send+Sized [(const X:u8) (const Y:u8 = 1) (type Out<'a> where Self:'a:Iterator) (fn f [(self &)] -> u8 ;) (fn g [(self:Box<Self>)] {})])",
    "(impl<T> Tr<T> for S<'_,T> [(const X:u8 = 0) (type Out<'a> where Self:'a = u8) (fn f [(self &)] -> u8 {0})])",
    "(impl unsafe ! Send for Unit [])",
    "(impl Default for Unit [(fn default [] -> Self {Unit})])",
    "(fn exported [a:u32] -> u32 {a})",
    "(fn cf<T> where T:Copy [] {})",
    "(fn au [] {})",
    "(static mut COUNTER:u32 = 0)",
    "(const _:() = (macro assert!( [true]))",
    "(type Alias<T> = Vec<T>)",
    '(extern unsafe "C" [(fn abort [] -> ! ;) (fn raw [x:*const c_char n:usize] ;) (static ERRNO:i32)])',
    "(fn cb [this:*mut Self _:u32] {})",
    "(macro_rules m)",
    "(macro bun_core::impl_foo!{ [Unit])",
    "(macro foo!( [bar])",
    "(fn generic<'a,T,const N:usize> where T:'a [x:&'a [T; N]] -> impl Iterator<Item=&'a T>+'a {(.iter x [])})",
  ]);

  const exported = file.find("Fn").find(f => f.name === "exported")!;
  expect(exported).toMatchObject({
    vis: "pub",
    unsafe: true,
    abi: "C-unwind",
    variadic: true,
    const: false,
    async: false,
  });
  expect(exported.attrs.map(a => sexpr(a))).toEqual(["#[unsafe(no_mangle)]"]);
  expect(file.docComments(exported).map(c => c.text)).toEqual(["/// Exported."]);
  expect(file.text(exported).startsWith("pub unsafe extern")).toBe(true);
  expect(file.lineOf(exported)).toBe(26);

  const impls = file.find("Impl");
  expect(impls.map(i => [i.unsafe, i.negative, i.const, i.trait && pathString(i.trait)])).toEqual([
    [false, false, false, "Tr"],
    [true, true, false, "Send"],
    [false, false, true, "Default"],
  ]);

  const foreign = file.find("ForeignMod")[0];
  expect(foreign.items.map(i => (i.kind === "Fn" ? [i.name, i.safe, i.unsafe, i.vis] : i.kind))).toEqual([
    ["abort", true, false, null],
    ["raw", false, true, "pub"],
    "Static",
  ]);

  expect(file.attrs.map(a => sexpr(a))).toEqual(["#![allow(dead_code)]"]);
  expect(file.comments.map(c => [c.text, c.doc])).toEqual([
    ["//! crate doc", "inner"],
    ["/// Exported.", "outer"],
  ]);
});

test("attribute meta", () => {
  const file = parseRust(`
    #[allow(dead_code, non_snake_case)]
    #[cfg_attr(any(unix, test), allow(dead_code), derive(Debug))]
    #[cfg(target_os = "linux")]
    #[doc = "text"]
    #[link(name = "foo", kind = "static")]
    #[rustfmt::skip]
    #[unsafe(no_mangle)]
    #[serde(rename_all = "camelCase", default)]
    #[derive(Clone)]
    struct S;
  `);
  const attrs = file.find("Struct")[0].attrs;
  expect(attrs.map(a => sexpr(a))).toEqual([
    "#[allow(dead_code, non_snake_case)]",
    "#[cfg_attr(any(unix, test), allow(dead_code), derive(Debug))]",
    '#[cfg(target_os = "linux")]',
    '#[doc = "text"]',
    '#[link(name = "foo", kind = "static")]',
    "#[rustfmt::skip]",
    "#[unsafe(no_mangle)]",
    '#[serde(rename_all = "camelCase", default)]',
    "#[derive(Clone)]",
  ]);
  expect(attrs.map(a => a.name)).toEqual([
    "allow",
    "cfg_attr",
    "cfg",
    "doc",
    "link",
    "rustfmt::skip",
    "unsafe",
    "serde",
    "derive",
  ]);
  expect(attrs.flatMap(a => metaLists(a.meta, "allow").flatMap(metaItemPaths))).toEqual([
    "dead_code",
    "non_snake_case",
    "dead_code",
  ]);
  const cfg = attrs[2].meta;
  expect(
    cfg.kind === "MetaList" &&
      cfg.items[0].kind === "MetaNameValue" &&
      cfg.items[0].expr?.kind === "Lit" &&
      litString(cfg.items[0].expr),
  ).toBe("linux");
});

test("literals", () => {
  const lit = (s: string) => parseRustExpr(s);
  expect(litString(lit('"a\\n\\u{41}\\\\"') as never)).toBe("a\nA\\");
  expect(litString(lit('r#"raw "quoted""#') as never)).toBe('raw "quoted"');
  expect(litString(lit('b"bytes"') as never)).toBe("bytes");
  expect(litString(lit("b'\\x41'") as never)).toBe("A");
  expect(litString(lit("'\\''") as never)).toBe("'");
  expect(litNumber(lit("1_000u32") as never)).toBe(1000);
  expect(litNumber(lit("0xffu8") as never)).toBe(255);
  expect(litNumber(lit("1.5e3") as never)).toBe(1500);
  expect(lit("1u8")).toMatchObject({ kind: "Lit", litKind: "int", suffix: "u8" });
  expect(lit("2.0")).toMatchObject({ kind: "Lit", litKind: "float", suffix: null });
  // Hex digits that spell a suffix are digits.
  expect(lit("0x1f32")).toMatchObject({ kind: "Lit", litKind: "int", suffix: null });
  expect(litNumber(lit("0x1f32") as never)).toBe(0x1f32);
  expect(lit("0x1fu32")).toMatchObject({ kind: "Lit", litKind: "int", suffix: "u32" });
  expect(lit("1e3f32")).toMatchObject({ kind: "Lit", litKind: "float", suffix: "f32" });
});

test("macro input is kept as token trees and parsed as expressions where possible", () => {
  const mac = parseRustExpr("owned_task!(Foo, { a; b }, [x; 2])");
  expect(mac.kind).toBe("Macro");
  if (mac.kind !== "Macro") return;
  expect(mac.tokens.map(t => t.kind)).toEqual(["ident", "punct", "group", "punct", "group"]);
  expect(mac.args.map(a => (a ? sexpr(a) : null))).toEqual(["Foo", "{a; b}", "(repeat x 2)"]);
  const dsl = parseRustExpr("quote! { let #x = 1; }");
  expect(dsl.kind === "Macro" && dsl.args).toEqual([null]);
});

test("queries", () => {
  const file = parseRust(`
    impl Foo {
        fn a(&mut self) { unsafe { bun_core::heap::take(ptr::from_mut(self)) }; }
        fn b(this: *mut Self) { unsafe { heap::take(this) }; }
    }
    fn c() { assert!(heap::destroy(p)); }
  `);
  const calls = file.find("Call");
  expect(calls.map(c => file.text(c.callee))).toEqual([
    "bun_core::heap::take",
    "ptr::from_mut",
    "heap::take",
    "heap::destroy",
  ]);
  expect(calls.map(c => pathEndsWith(c.callee, "heap::take"))).toEqual([true, false, true, false]);
  expect(calls.map(c => file.enclosingFn(c)?.name)).toEqual(["a", "a", "b", "c"]);
  expect(file.find("Fn").map(f => f.params.some(p => p.kind === "Receiver"))).toEqual([true, false, false]);
  expect(file.find("Call", file.find("Fn")[1]).length).toBe(1);
  expect(file.location(calls[3])).toBe("6");
  expect(file.columnOf(calls[3])).toBe(22);
  expect(file.find("Unsafe").map(u => file.text(u))).toEqual([
    "unsafe { bun_core::heap::take(ptr::from_mut(self)) }",
    "unsafe { heap::take(this) }",
  ]);
});

test("ancestors on items with a where clause", () => {
  const file = parseRust(`
    fn f<T>(x: T) -> u8 where T: Copy { 0 }
    impl<T> Tr for S<T> where T: Send { fn g(&self) {} }
    pub(in crate::a) struct P<T>(T) where T: Copy;
  `);
  const [f, g] = file.find("Fn");
  expect(file.enclosingFn(f.params[0])?.name).toBe("f");
  expect(file.parent(f.ret!)).toBe(f);
  expect(file.enclosing(f.generics.where[0], "Fn")?.name).toBe("f");
  expect(file.enclosingFn(file.find("Lit")[0])?.name).toBe("f");
  const impl = file.find("Impl")[0];
  expect(file.parent(impl.selfTy)).toBe(impl);
  expect(file.parent(impl.trait!)).toBe(impl);
  expect(file.enclosing(g, "Impl")).toBe(impl);
  const p = file.find("Struct")[0];
  expect(p.vis).toBe("pub(in crate::a)");
  expect(file.parent(p.fields![0])).toBe(p);
  expect(file.parent(p.attrs[0] ?? p)).toBe(p.attrs[0] ? p : file.ast);
});

test("impl generics versus a qualified self type", () => {
  const file = parseRust(`
    impl<'a, T: Clone, const N: usize> Tr for S<'a, T, N> {}
    impl<T> S<T> {}
    impl <Vec<u8> as Tr>::Out { fn f() {} }
    impl <a::B as Tr>::Out { fn g() {} }
    impl Tr for <T as Other>::Assoc {}
  `);
  const impls = file.find("Impl");
  expect(impls.map(i => [i.generics.params.length, file.text(i.selfTy), i.trait && pathString(i.trait)])).toEqual([
    [3, "S<'a, T, N>", "Tr"],
    [1, "S<T>", null],
    [0, "<Vec<u8> as Tr>::Out", null],
    [0, "<a::B as Tr>::Out", null],
    [0, "<T as Other>::Assoc", "Tr"],
  ]);
});

test("a match body's inner attributes are kept", () => {
  const file = parseRust(`
    fn f() {
        #[cfg(x)]
        match y {
            #![allow(unused)]
            _ => (),
        }
    }
  `);
  // The outer attribute belongs to the statement, the inner one to the match.
  const m = file.find("Match")[0];
  expect(m.attrs?.map(a => sexpr(a))).toEqual(["#![allow(unused)]"]);
  expect(file.find("ExprStmt")[0].attrs.map(a => sexpr(a))).toEqual(["#[cfg(x)]"]);
  expect(file.find("Attribute").map(a => sexpr(a))).toEqual(["#[cfg(x)]", "#![allow(unused)]"]);
  // In expression position the outer attribute sits on the expression itself.
  const inline = parseRustExpr("f(#[cfg(x)] match y { #![allow(unused)] _ => 1 })");
  expect(inline.kind === "Call" && inline.args[0].attrs?.map(a => sexpr(a))).toEqual([
    "#[cfg(x)]",
    "#![allow(unused)]",
  ]);
});

test("visibility spellings", () => {
  const file = parseRust(`
    pub struct A;
    pub(crate) struct B;
    pub(super) struct C;
    pub(self) struct D;
    pub(in ::x::y) struct E;
    struct F;
    struct G(pub (u8, u8));
  `);
  expect(file.find("Struct").map(s => s.vis)).toEqual([
    "pub",
    "pub(crate)",
    "pub(super)",
    "pub(self)",
    "pub(in ::x::y)",
    null,
    null,
  ]);
  expect(file.find("StructField")[0].vis).toBe("pub");
});

test("ratchet reports an overrun once and an unused budget as stale", () => {
  const finding = (path: string, n: number) => ({ path, message: `${path}:${n}` });
  const { offenders, stale } = ratchet(
    [finding("a.rs", 1), finding("a.rs", 2), finding("b.rs", 1), finding("c.rs", 1)],
    { "a.rs": 1, "b.rs": 1, "d.rs": 1 },
  );
  expect(offenders).toEqual(["a.rs:2", "c.rs:1"]);
  expect(stale).toEqual(["d.rs: allowlisted for 1, found 0"]);
});

test("fragments keep their offsets", () => {
  const src = "let x = foo(1);\nbar(x)";
  const frag = parseRustFragment(src);
  const calls = frag.find("Call");
  expect(calls.map(c => frag.text(c))).toEqual(["foo(1)", "bar(x)"]);
  expect(calls.map(c => frag.lineOf(c))).toEqual([1, 2]);
  // Objects reachable twice (an attribute's value is also its meta's
  // expression) are shifted once.
  const attributed = parseRustFragment('#[doc = "text"]\n#[cfg(all(unix, x = "y"))]\nlet y = 1;');
  const [doc, cfg] = attributed.find("Attribute");
  expect(attributed.text(doc.value!)).toBe('"text"');
  expect(doc.meta.kind === "MetaNameValue" && attributed.text(doc.meta.expr!)).toBe('"text"');
  expect(cfg.tokens!.map(t => attributed.text(t))).toEqual(["all", '(unix, x = "y")']);
});

test("errors carry an offset", () => {
  expect(() => parseRustExpr("a +")).toThrow(RustParseError);
  try {
    parseRust("fn f() { let x = ; }", "bad.rs");
    throw new Error("unreachable");
  } catch (e) {
    expect(e).toBeInstanceOf(RustParseError);
    expect((e as RustParseError).offset).toBe(17);
    expect((e as RustParseError).path).toBe("bad.rs");
    expect((e as RustParseError).message).toBe("expected expression, found `;`");
  }
});

// The whole-tree checks run at module load, like the lints' own scans, so the
// per-test timeout does not apply to them: a debug build of bun parses the
// tree in about a minute.
const sources = rustSources();

const parseErrors: string[] = [];
const unparsable = new Set<string>();
for (const src of sources) {
  try {
    src.file;
  } catch (e) {
    if (!(e instanceof RustParseError)) throw e;
    parseErrors.push(`${src.path}: ${e.message} (offset ${e.offset})`);
    unparsable.add(src.path);
  }
}

// A sample of files spread over the tree, bounded by node count: a debug
// build of bun takes about 25 microseconds per node here.
const treeProblems: string[] = [];
{
  const stride = Math.max(1, Math.floor(sources.length / 24));
  let budget = 40_000;
  for (let i = 0; i < sources.length && budget > 0 && treeProblems.length < 20; i += stride) {
    if (unparsable.has(sources[i].path)) continue;
    const file = sources[i].file;
    walk(file.ast, (node: Node, parent: Node | null) => {
      budget--;
      const a = children(node);
      const b = childrenReflective(node);
      if (a.length !== b.length || a.some((x, j) => x !== b[j])) {
        treeProblems.push(
          `${file.location(node)}: children of ${node.kind}: ${a.map(n => n.kind)} vs ${b.map(n => n.kind)}`,
        );
      }
      // Attributes sit before the node they decorate, outside its span.
      if (parent && node.kind !== "Attribute" && (node.start < parent.start || node.end > parent.end)) {
        treeProblems.push(
          `${file.location(node)}: ${node.kind} [${node.start}, ${node.end}) outside ${parent.kind} [${parent.start}, ${parent.end})`,
        );
      }
    });
  }
}

describe("the tree", () => {
  test("has sources", () => {
    expect(sources.length).toBeGreaterThan(1000);
  });

  test("every tracked Rust file parses", () => {
    expect(parseErrors).toEqual([]);
  });

  test("child enumeration matches reflection and spans nest", () => {
    expect(treeProblems).toEqual([]);
  });
});
