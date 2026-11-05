// Programs whose positions are known, for source-positions.test.ts.
//
// Before each line is how often `bun test --coverage` says it ran, or `-` if there is nothing on it to run.
// `at()` reports where the runtime says it was called from and counts its calls. `caught(e, "text")` reports where the
// runtime says `e` was thrown, which has to be the first "text" of the file. Neither position is written down anywhere:
// the test looks for the call in the text. A call in tail position has no caller to report, so `at()` is never returned.
// `ran()` only counts its calls, for the initializer of a field: JSC keeps the function it is in out of stack traces.

export type Case = {
  /** Functions that ran / functions in the file. */
  functions: string;
  lines: string;
};

export const cases: Record<string, Case> = {
  // A function that never ran has the lines its code is on, up to the last.
  "uncalled.ts": {
    functions: "1/2",
    lines: `
 1|export function called() {
 1|  return 1;
 -|}
 -|
 -|// a comment
 0|export function uncalled(a: number) {
 -|  // a comment
 -|
 0|  const b = a + 1;
 -|  /* another
 -|     comment */
 0|  return b;
 -|}
 1|called();
`,
  },
  // A file with nothing to run is listed.
  "only-types.ts": {
    functions: "0/0",
    lines: `
 -|// a comment
 -|export type T = number;
 -|export interface I {
 -|  a: T;
 -|}
`,
  },
  // How often, not how many characters.
  "counts.ts": {
    functions: "1/1",
    lines: `
 1|let total = 0;
 4|function add(n: number) {
 4|  total += n;
 -|}
 4|for (let i = 0; i < 3; i++) {
 3|  add(i);
 -|}
 1|add(1);
 1|export { total };
`,
  },
  "branches.ts": {
    functions: "4/5",
    lines: `
 2|export function f(x: boolean) {
 2|  if (x) {
 2|    return 1;
 0|  } else {
 0|    return 2;
 -|  }
 -|}
 1|export function g(x: number) {
 1|  switch (x) {
 0|    case 1:
 0|      return "one";
 1|    case 2:
 1|      return "two";
 0|    default:
 0|      return "many";
 -|  }
 -|}
 1|export function h() {
 1|  try {
 1|    throw new Error("x");
 1|  } catch (e) {
 1|    return 1;
 1|  } finally {
 1|    f(true);
 -|  }
 -|}
 1|export function k(x: boolean) {
 1|  if (x) {
 0|    const inner = () => true;
 0|    f(inner());
 0|    f(true);
 -|  }
 1|  return x;
 -|}
 1|f(true);
 1|g(2);
 1|h();
 1|k(false);
`,
  },
  "else.ts": {
    functions: "2/2",
    lines: `
 6|function a() {}
 2|function f(x: boolean) {
 2|  if (x) {
 0|    a();
 2|  } else {
 2|    a();
 -|  }
 2|  if (x) {
 0|    a();
 2|  } else if (!x) {
 2|    a();
 -|  }
 2|  if (x) a();
 2|  else a();
 -|}
 1|f(false);
 1|f(false);
`,
  },
  // Nothing is left of a type to run.
  "types.ts": {
    functions: "0/1",
    lines: `
 -|import type { A } from "./nothing";
 -|interface B {
 -|  a: number;
 -|}
 -|type C = {
 -|  b: string;
 -|};
 -|declare const d: number;
 1|export const e: B = {
 1|  a: 1,
 1|};
 0|export function f(x: C): A | undefined {
 0|  return undefined;
 -|}
`,
  },
  "multiline.ts": {
    functions: "2/3",
    lines: `
 1|function id<T>(x: T): T {
 1|  return x;
 -|}
 1|export const a = id(
 1|  1 +
 -|    2,
 1|);
 1|export const b = \`one
 1|two \${a}
 -|three\`;
 1|export const c = [
 1|  1,
 1|  2,
 2|].map(x =>
 2|  x * 2,
 1|);
 1|export const never = () => [
 0|  1,
 0|  2,
 0|];
`,
  },
  // Both braces of an object literal are code, and of a pattern that is assigned to, which a `var` in a block becomes.
  // Those of a block, a body, a class and a binding are not.
  "braces.ts": {
    functions: "5/7",
    lines: `
 2|const twice = (
 2|  n: number,
 2|): { x: number } => ({
 2|  x: n,
 2|});
 1|const typed: {
 -|  v: number;
 1|} = {
 1|  v: 1,
 1|};
 3|const thrice = () =>
 3|  ({
 3|    y: typed.v,
 3|  });
 1|export const never = () =>
 0|  ({
 0|    z: 1,
 0|  });
 1|const list = [
 1|  {
 1|    one: 1,
 1|  },
 1|  {
 1|    two: 2,
 1|  },
 1|];
 1|export const chosen = !typed.v
 0|  ? {
 0|      yes: 1,
 0|    }
 1|  : {
 1|      no: 1,
 1|    };
 1|export const neither = !typed.v &&
 0|  {
 0|    and: 1,
 0|  };
 1|export const empty = {
 1|};
 1|const withMethod = {
 1|  method() {
 1|    return 1;
 -|  },
 1|};
 1|withMethod.method();
 1|function pattern(
 -|  {
 1|    one,
 -|  }: { one?: number },
 -|) {
 1|  return one;
 -|}
 1|pattern({ one: 1 });
 2|for (const item of list) ({
 2|  two: item.two,
 2|}).two;
 2|for (const item of list) {
 2|  twice(item.one ?? 0);
 -|}
 1|function early() {
 1|  if (typed.v) {
 1|    return 1;
 -|  }
 0|  return 2;
 -|}
 1|early();
 1|if (typed.v)
 -|{
 1|  thrice();
 -|}
 0|else
 -|{
 0|  Object(0);
 -|}
 1|if (!typed.v)
 -|{
 0|  Object(0);
 -|}
 1|else
 -|{
 1|  Object(1);
 -|}
 1|switch (typed.v) {
 1|  case 1:
 -|  {
 1|    thrice();
 -|  }
 -|}
 -|{
 1|  thrice();
 -|}
 1|export class Empty
 -|{
 -|}
 1|let first: any;
 1|[
 1|  {
 1|    a: first,
 1|  },
 1|] = [{ a: 1 }];
 1|if (typed.v) {
 -|  var
 1|  {
 1|    v: hoisted,
 1|  }
 1|  = typed;
 -|}
 1|export const spaced = {
 0|  async am
 0|  () {},
 1|};
`,
  },
  // Where a constant is inlined, its value has the position of its declaration.
  "inlined.ts": {
    functions: "1/2",
    lines: `
 1|const A = 1;
 1|const B = 2;
 1|const C = 3;
 -|
 0|export function unused(x: number): number {
 0|  return x + B;
 -|}
 1|export function used(x: number): number {
 1|  return x + C;
 -|}
 1|used(A);
`,
  },
  // JSC's offsets count code units of a text that is Latin-1 here and UTF-16 below, never UTF-8 bytes.
  "latin1.ts": {
    functions: "1/2",
    lines: `
 1|export function café() {
 1|  return "éééééééé";
 -|}
 0|export function uncalled() {
 0|  return "é";
 -|}
 1|café();
`,
  },
  "utf16.ts": {
    functions: "1/2",
    lines: `
 1|export function a() {
 1|  return "漢字🎉漢字🎉";
 -|}
 0|export function uncalled() {
 0|  return "🎉";
 -|}
 1|a();
`,
  },
  // The function Bun wraps CommonJS in is not one of the file's.
  "wrapper.cjs": {
    functions: "1/1",
    lines: `
 1|function a() {
 1|  return 1;
 -|}
 1|module.exports = a();
`,
  },
  // An implicit constructor, the initializers of the fields and a static block are not functions of the file.
  "classes.ts": {
    functions: "2/3",
    lines: `
 4|function v() {
 4|  return 1;
 -|}
 1|export class Implicit {}
 1|export class Fields {
 2|  a = v();
 1|  static b = v();
 1|  c: number;
 -|  static {
 1|    v();
 -|  }
 -|}
 1|export class NeverConstructed {
 0|  a = v();
 0|  m() {
 0|    return 1;
 -|  }
 -|}
 1|export class Returns extends Implicit {
 1|  constructor(x: object) {
 1|    super();
 1|    try {
 1|      return x;
 0|    } catch {
 0|      v();
 -|    }
 0|    v();
 -|  }
 -|}
 1|new Fields();
 1|new Fields();
 1|new Returns({});
`,
  },
  "loops.ts": {
    functions: "1/1",
    lines: `
 3|function f() {}
 4|for (let i = 0; i < 3; i++) {
 3|  if (i > 5)
 0|    break;
 3|  if (i === 1)
 1|    continue;
 2|  f();
 -|}
 1|let n = 0;
 1|do {
 3|  n++;
 3|} while (n < 3);
 1|if (n === 0)
 0|  do {
 0|    n++;
 0|  } while (n < 3);
 1|if (n === 3)
 1|  do {
 2|    n++;
 2|  } while (n < 5);
 1|out: {
 1|  if (n)
 1|    break out;
 0|  f();
 -|}
 1|f();
`,
  },
  // What is after a loop runs once, however the loop ends.
  "iteration.ts": {
    functions: "2/2",
    lines: `
 9|function g() {}
 1|let n = 0;
 3|for (const key in { a: 1, b: 2, c: 3 }) {
 3|  n++;
 -|}
 1|g();
 1|for (const key in {}) {
 0|  n++;
 -|}
 1|g();
 2|for (const value of [1, 2]) {
 2|  n++;
 -|}
 1|g();
 3|while (n > 3) {
 2|  n--;
 -|}
 1|g();
 1|while (n > 3) {
 0|  n--;
 -|}
 1|g();
 3|outer: for (let i = 0; i < 2; i++) {
 4|  for (let j = 0; j < 3; j++) {
 4|    if (j === 1) {
 2|      continue outer;
 -|    }
 2|    g();
 -|  }
 0|  g();
 -|}
 1|g();
 3|function first(list: number[]) {
 3|  for (const value of list) {
 2|    return value;
 -|  }
 1|  g();
 -|}
 1|first([1]);
 1|first([1]);
 1|first([]);
`,
  },
  // What is after a statement that control flow left did not run.
  "leaves.ts": {
    functions: "7/7",
    lines: `
18|function g() {}
 3|function afterIf(x: boolean) {
 3|  if (x) {
 2|    return 1;
 -|  }
 1|  g();
 1|  return 2;
 -|}
 1|afterIf(true);
 1|afterIf(true);
 1|afterIf(false);
 3|function nested(x: boolean, y: boolean) {
 3|  if (x) {
 2|    if (y) {
 1|      return;
 -|    }
 1|    g();
 -|  }
 2|  g();
 -|}
 1|nested(true, true);
 1|nested(true, false);
 1|nested(false, false);
 3|function block(x: boolean) {
 -|  {
 3|    if (x) {
 2|      return;
 -|    }
 1|    g();
 -|  }
 1|  g();
 -|}
 1|block(true);
 1|block(true);
 1|block(false);
 4|function pick(x: number) {
 4|  switch (x) {
 1|    case 1:
 1|      return 1;
 1|    case 2:
 1|      g();
 3|    case 3:
 3|      g();
 3|      break;
 0|    default:
 0|      return 4;
 -|  }
 3|  g();
 -|}
 1|pick(1);
 1|pick(2);
 1|pick(3);
 1|pick(3);
 3|function cleanup(x: boolean) {
 3|  try {
 3|    if (x) {
 2|      return 1;
 -|    }
 1|    g();
 3|  } finally {
 3|    g();
 -|  }
 1|  g();
 -|}
 1|cleanup(true);
 1|cleanup(true);
 1|cleanup(false);
 1|function rethrows() {
 1|  try {
 1|    throw new Error();
 1|  } catch (e) {
 1|    throw e;
 -|  }
 0|  g();
 -|}
 1|try {
 1|  rethrows();
 1|} catch {}
`,
  },
  // `case` and `default` ran as often as what follows them, not as often as a `case` was compared.
  "switch.ts": {
    functions: "6/7",
    lines: `
 3|function defaultLast(x: number) {
 3|  switch (x) {
 1|    case
 1|      1:
 1|      at();
 1|      break;
 2|    default:
 2|      at();
 -|  }
 -|}
 1|defaultLast(1);
 1|defaultLast(2);
 1|defaultLast(2);
 3|function defaultFirst(x: number) {
 3|  switch (x) {
 2|    default:
 2|      at();
 3|    case 1:
 3|      at();
 -|  }
 -|}
 1|defaultFirst(1);
 1|defaultFirst(2);
 1|defaultFirst(2);
 3|function blocks(x: number) {
 3|  switch (x) {
 1|    case 1: {
 1|      at();
 1|      break;
 -|    }
 2|    default: {
 2|      at();
 -|    }
 -|  }
 -|}
 1|blocks(1);
 1|blocks(2);
 1|blocks(2);
 1|function empty(x: number) {
 1|  switch (x) {
 1|    case 1:
 1|    default:
 -|  }
 -|}
 1|empty(1);
 2|function uncalledArrow(x: unknown) {
 2|  switch (x) {
 2|    case 1:
 2|    case () => 1:
 2|      at();
 -|  }
 -|}
 1|uncalledArrow(1);
 1|uncalledArrow(1);
 3|function sameLine(x: number) {
 3|  switch (x) {
 2|    case 1: return; default:
 2|      at();
 -|  }
 -|}
 1|sameLine(1);
 1|sameLine(2);
 1|sameLine(2);
`,
  },
  // `finally` ran as often as its block, however the `try` was left.
  "finally.ts": {
    functions: "11/12",
    lines: `
 2|function completes() {
 2|  try {
 2|    at();
 2|  } finally {
 2|    at();
 -|  }
 -|}
 1|completes();
 1|completes();
 1|function handles() {
 1|  try {
 1|    throw new Error();
 1|  } catch {
 1|    at();
 1|  } finally {
 1|    at();
 -|  }
 -|}
 1|handles();
 1|function neverCatches() {
 1|  try {
 1|    at();
 0|  } catch {
 0|    at();
 1|  } finally {
 1|    at();
 -|  }
 -|}
 1|neverCatches();
 1|function throws() {
 1|  try {
 1|    throw new Error();
 1|  } finally {
 1|    at();
 -|  }
 -|}
 1|try {
 1|  throws();
 1|} catch {}
 1|function continues() {
 4|  for (let i = 0; i < 3; i++) {
 3|    try {
 3|      continue;
 3|    } finally {
 3|      at();
 -|    }
 -|  }
 -|}
 1|continues();
 1|function* closed() {
 1|  try {
 1|    yield 1;
 1|  } finally {
 1|    at();
 -|  }
 -|}
 1|const returned = closed();
 1|returned.next();
 1|returned.return();
 1|async function stuck() {
 1|  try {
 1|    await new Promise(() => {});
 0|  } finally {
 0|    at();
 -|  }
 -|}
 1|stuck();
 0|export function uncalled() {
 0|  try {
 0|    at();
 0|  } finally {
 0|    at();
 -|  }
 -|}
 1|function multiline() {
 1|  try
 -|  {
 1|    at();
 -|  }
 1|  finally
 -|  {
 1|    at();
 -|  }
 -|}
 1|multiline();
 3|function sameLine(x: boolean) {
 3|  try {
 3|    if (x) return 1;
 3|    at(); } finally {
 3|    at();
 -|  }
 -|}
 1|sameLine(true);
 1|sameLine(true);
 1|sameLine(false);
 1|function sameLineAsCatch() {
 1|  try {
 1|    at();
 1|  } catch { at(); } finally {
 1|    at();
 -|  }
 -|}
 1|sameLineAsCatch();
`,
  },
  // What is after a statement that the function was left at, and did not come back to.
  "generators.ts": {
    functions: "7/7",
    lines: `
 1|function* never() {
 0|  yield 1;
 -|}
 1|never();
 2|function* generator() {
 2|  at();
 2|  yield 1;
 1|  at();
 1|  yield 2;
 0|  at();
 -|}
 1|const resumed = generator();
 1|resumed.next();
 1|resumed.next();
 1|generator().next();
 2|function* left() {
 2|  try {
 2|    yield 1;
 0|    at();
 1|  } catch {
 1|    at();
 -|  }
 1|  at();
 -|}
 1|const returned = left();
 1|returned.next();
 1|returned.return();
 1|const thrown = left();
 1|thrown.next();
 1|thrown.throw(new Error());
 1|function* delegates() {
 1|  yield* [1, 2];
 0|  at();
 -|}
 1|delegates().next();
 1|async function stuck() {
 1|  at();
 1|  await new Promise(() => {});
 0|  at();
 -|}
 1|stuck();
 1|async function rejected() {
 1|  try {
 1|    await Promise.reject(new Error());
 0|    at();
 1|  } catch {
 1|    at();
 -|  }
 1|  at();
 -|}
 1|rejected();
`,
  },
  // What `?.`, a logical assignment and a value that is there skip. A `case` that does not match did not run.
  "skipped.ts": {
    functions: "8/8",
    lines: `
 4|function one() {
 4|  at();
 4|  return 1;
 -|}
 2|function chain(o?: { a(n: number): void }) {
 2|  o
 1|    ?.a(
 1|      one(),
 1|    );
 -|}
 1|chain();
 1|chain({ a() {} });
 2|function call(f?: (n: number) => void) {
 2|  f?.(
 1|    one(),
 1|  );
 -|}
 1|call();
 1|call(() => {});
 2|function assign(o: Record<string, number | null>) {
 2|  o.a ||=
 1|    one();
 2|  o.b &&=
 0|    one();
 2|  o.c ??=
 0|    one();
 -|}
 1|assign({ a: 1, b: 0, c: 0 });
 1|assign({ a: 0, b: 0, c: 0 });
 2|function parameter(
 2|  v =
 1|    one(),
 -|) {
 2|  at();
 -|}
 1|parameter();
 1|parameter(1);
 1|function pattern({
 1|  v =
 0|    one(),
 -|}: { v?: number }) {
 1|  at();
 -|}
 1|pattern({ v: 1 });
 1|let node: any = { next: { next: {} } };
 3|while (node?.next) {
 2|  node = node.next;
 -|}
 1|switch (2 as number) {
 0|  case node?.next: at();
 -|}
`,
  },
  // What is a function to the engine alone: not one of the file's functions, and not run until it is.
  "engine-functions.ts": {
    functions: "5/6",
    lines: `
 1|function* branches(x: boolean) {
 1|  if (x) {
 1|    yield 1;
 -|  }
 1|  yield 2;
 -|}
 1|function thrower(): number {
 1|  throw new Error();
 -|}
 1|try {
 1|  class A {
 1|    static a = thrower();
 -|    static {
 0|      ran();
 -|    }
 -|  }
 1|} catch {}
 1|const key = "k";
 1|class B {
 1|  [key] =
 3|    () => { at(); };
 -|}
 1|const b: any = new B();
 1|b.k();
 1|b.k();
 1|b.k();
 1|const pick = (x: boolean) =>
 1|  x
 2|    ? () => { at(); }
 0|    : () => { ran(); };
 1|const picked = pick(true);
 1|picked();
 1|picked();
 1|[...branches(true)];
`,
  },
  "logical.ts": {
    functions: "1/2",
    lines: `
 3|const t = () => true;
 1|const never = () => 1;
 1|export const a =
 1|  t() ||
 0|  never();
 1|export const b =
 1|  !t() &&
 0|  never();
 1|export const c =
 1|  1 ??
 0|  never();
 1|export const d =
 1|  t()
 1|    ? 1
 0|    : never();
`,
  },
  "calls.ts": {
    functions: "2/2",
    lines: `
 1|function outer() {
 1|  at();
 1|  const list = [at(), at()];
 1|  return inner(at(), list);
 -|}
 1|function inner(...args: unknown[]) {
 1|  at();
 -|}
 1|outer();
`,
  },
  // What is erased is before the call, on its line or above.
  "erased.ts": {
    functions: "2/2",
    lines: `
 -|interface Erased {
 -|  a: number;
 -|}
 1|const typed = <T,>(value: T): T => (at(), value);
 1|typed<number>(1) as number; at();
 1|const cast = (at() as unknown) satisfies unknown; at();
 1|function generic<A extends object, B = A>(this: void, a?: A, b?: B): void { at(); }
 1|generic<{}>(); at();
 -|declare const nothing: number;
 1|at();
`,
  },
  // An enum and a namespace are compiled to a function each.
  "lowered.ts": {
    functions: "3/3",
    lines: `
 1|enum Color {
 1|  Red = 1,
 1|  Green = (at(), 2),
 -|}
 1|namespace Space {
 1|  export const value = at();
 -|}
 1|class Point {
 1|  constructor(public x = at(), private y = at()) {
 1|    at();
 -|  }
 -|}
 1|new Point(); at();
 1|void [Color.Green, Space.value];
`,
  },
  "members.ts": {
    functions: "6/6",
    lines: `
 1|class Members {
 2|  field = ran();
 1|  static fixed = ran();
 2|  #hidden = ran();
 1|  get value() { at(); return 1; }
 1|  set value(v) { at(); }
 1|  static { at(); }
 1|  method() { at(); return this.#hidden; }
 1|  async later() { await null; at(); }
 1|  *steps() { at(); yield 1; at(); }
 1|  ["computed" + at()]() { at(); }
 -|}
 1|const members = new Members();
 1|new Members();
 1|members.value; members.value = 1; members.method(); members.later(); [...members.steps()];
 1|(members as any).computedundefined();
`,
  },
  // A token that is on several lines is before the call.
  "spans.ts": {
    functions: "0/0",
    lines: `
 1|const text = \`one
 1|two \${at()} three
 1|four\`; at();
 -|/* a comment
 1|   on two lines */ at();
 1|const pattern = /[/]\\//g; at();
 1|const continued = "a\\
 1|b"; at();
 1|void [text, pattern, continued];
`,
  },
  "operators.ts": {
    functions: "2/2",
    lines: `
 1|at?.();
 1|new (at(), Object)();
 1|const tag = (strings: TemplateStringsArray, ...values: unknown[]) => [at()];
 1|tag\`a\${at()}b\`;
 1|const { a = at(), ...rest } = {} as any;
 1|const [b = at()] = [];
 1|const spread = [...[at()]];
 1|const chosen = at() ? at() : at();
 1|void (at() ?? at());
 1|const object = { key: at(), [\`k\${at()}\`]: at(), method() { at(); } };
 1|object.method();
 1|label: for (const x of [at()]) { at(); break label; }
 1|switch (at()) { case at(): at(); default: at(); }
 1|try { at(); throw at(); } catch { at(); } finally { at(); }
 1|void [a, rest, b, spread, chosen];
`,
  },
  "elements.tsx": {
    functions: "2/2",
    lines: `
 -|/** @jsxRuntime classic */
 -|/** @jsx h */
 -|/** @jsxFrag Fragment */
 1|const Fragment = "fragment";
 3|function h(tag: any, props: any, ...children: any[]) {
 3|  return typeof tag === "function" ? tag({ ...props, children }) : tag;
 -|}
 1|function Component(props: any) {
 1|  at();
 -|}
 1|const tree = (
 1|  <div id={at()}>
 1|    text {at()}
 1|    <Component value={at()}>
 1|      {at()}
 1|    </Component>
 1|    <>
 1|      {at()}
 1|    </>
 1|  </div>
 -|);
 1|try {
 -|  (
 1|    <Missing>
 -|      text
 1|    </Missing>
 -|  );
 1|} catch (e) {
 1|  caught(e, "Missing>");
 -|}
 1|void tree;
`,
  },
  // Errors that the engine throws.
  "thrown.ts": {
    functions: "0/0",
    lines: `
 1|const empty: any = {};
 1|try { notDefined; } catch (e) { caught(e, "notDefined"); }
 1|try { empty.first.second; } catch (e) { caught(e, "first.second"); }
 1|try { empty.notFunction(); } catch (e) { caught(e, "notFunction"); }
 1|try { new empty.notConstructor(); } catch (e) { caught(e, "new empty"); }
 1|try { tooEarly; let tooEarly = 1; } catch (e) { caught(e, "tooEarly"); }
 1|try { throw new RangeError("thrown"); } catch (e) { caught(e, "RangeError"); }
 1|try { null!.ofNull; } catch (e) { caught(e, "null!"); }
`,
  },
  "common.cjs": {
    functions: "1/1",
    lines: `
 1|exports.value = at();
 1|function common() {
 1|  at();
 -|}
 1|common();
`,
  },
  "module.mjs": {
    functions: "2/3",
    lines: `
 1|export const value = at();
 0|export default function never() {
 0|  at();
 -|}
 1|export function called() {
 1|  at();
 -|}
 1|export async function awaited() {
 1|  at();
 -|}
 1|called();
 1|awaited();
`,
  },
  // What a bundle keeps of a default export is a declaration without `export default`.
  "function.ts": {
    functions: "1/1",
    lines: `
 1|export default function imported() {
 1|  at();
 -|}
`,
  },
  "class.ts": {
    functions: "1/1",
    lines: `
 1|export default class Imported {
 1|  method() {
 1|    at();
 -|  }
 -|}
`,
  },
  "async.ts": {
    functions: "1/1",
    lines: `
 1|export default async function awaited() {
 1|  at();
 -|}
`,
  },
  "abstract.ts": {
    functions: "1/1",
    lines: `
 1|abstract class Plain {
 1|  method() {
 1|    at();
 -|  }
 -|}
 1|export default abstract class Base extends Plain {}
`,
  },
  "importer.ts": {
    functions: "0/0",
    lines: `
 1|import Base from "./abstract.ts";
 1|import awaited from "./async.ts";
 1|import Imported from "./class.ts";
 1|import imported from "./function.ts";
 1|imported();
 1|awaited();
 1|new Imported().method();
 1|new (class extends Base {})().method();
`,
  },
  // The error is from the file that is loaded. Below it is who loads it.
  "requires.cjs": {
    functions: "0/0",
    lines: `
 1|try {
 1|  const list = [1, require("../throws.cjs")];
 1|} catch (e) {
 1|  caught(e, "require(");
 -|}
 1|require.resolve("node:fs");
 1|require.resolve(
 -|  "node:fs",
 -|);
`,
  },
  // The path of a chunk is put in once its length is known, which moves what follows it on the line.
  "lazy.mjs": {
    functions: "0/0",
    lines: `
 1|export const lazy = at();
`,
  },
  "chunks.ts": {
    functions: "0/0",
    lines: `
 1|const text = "é汉🎉"; at(); import("./lazy.mjs"); at();
 1|export { text };
`,
  },
  // Columns far from the start of the line.
  "wide.js": {
    functions: "0/0",
    lines: `
 1|${Array(8)
   .fill(`${JSON.stringify(Buffer.alloc(500, "x").toString())}; at();`)
   .join(" ")}
`,
  },
};

// Programs that do not build. `«` is before what the message is about.
export const broken: Record<string, string> = {
  "syntax.ts": `
const a = 1;
const b = a +«* 2;
`,
  "redeclared.ts": `
let a = 1;
  let «a = 2;
`,
  "unresolved.ts": `
const a = 1;
import «"./missing";
`,
  "required.cjs": `
const a = 1;
const b = 2, c = require(«"./missing");
`,
  "element.tsx": `
const a = 1;
const b = <div>text</«span>;
`,
  "imported.css": `
a {
  color: red;
}
@import« "./missing.css";
`,
  "data.jsonc": `
{
  "a": 1,
  "b": «]
}
`,
};

// A test file. `bun test` writes what is between `«` and `»`.
export const snapshots = `
import { expect, test } from "bun:test";
type Erased = number;
test("snapshots", () => {
  expect(1 as Erased).toMatchInlineSnapshot(«\`1\`»); expect("two").toMatchInlineSnapshot(«\`"two"\`»);
  expect(3)
    .toMatchInlineSnapshot(«\`3\`»);
});
`;
