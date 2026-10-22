function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

const yes = [1].length === 1;
function touch(): void {}

const text = "hel".concat("lo");

type S24 = string;
type T24 = { length: number; padStart(count: number): string };
function honest24(): T24 {
  return { length: 24, padStart: () => "" };
}
function use24(t: T24): number {
  return t.length + 1;
}
class Holder24 {
  before = 1;
  held: T24;
  constructor(held: T24) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via24(s: S24): T24 {
  const map = new Map<string, T24>([["k", s]]);
  return map.get("k") ?? honest24();
}

type S25 = string;
type T25 = { length: number; padEnd(count: number): string };
function honest25(): T25 {
  return { length: 25, padEnd: () => "" };
}
function use25(t: T25): number {
  return t.length + 1;
}
class Holder25 {
  before = 1;
  held: T25;
  constructor(held: T25) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via25(s: S25): T25 {
  const set = new Set<T25>();
  set.add(s);
  for (const t of set) return t;
  return honest25();
}

type S26 = string;
type T26 = { length: number; substring(count: number): string };
function honest26(): T26 {
  return { length: 26, substring: () => "" };
}
function use26(t: T26): number {
  return t.length + 1;
}
class Holder26 {
  before = 1;
  held: T26;
  constructor(held: T26) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via26(s: S26): T26 {
  function* give(): Generator<T26> {
    yield s;
  }
  for (const t of give()) return t;
  return honest26();
}

type S27 = string;
type T27 = { length: number; substr(count: number): string };
function honest27(): T27 {
  return { length: 27, substr: () => "" };
}
function use27(t: T27): number {
  return t.length + 1;
}
class Holder27 {
  before = 1;
  held: T27;
  constructor(held: T27) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via27(s: S27): T27 {
  const seen: T27[] = [];
  function* take(): Generator<undefined, void, T27> {
    seen.push(yield);
  }
  const generator = take();
  generator.next(honest27());
  generator.next(s);
  return seen[0];
}

type S28 = string;
type T28 = { length: number; fontsize(count: number): string };
function honest28(): T28 {
  return { length: 28, fontsize: () => "" };
}
function use28(t: T28): number {
  return t.length + 1;
}
class Holder28 {
  before = 1;
  held: T28;
  constructor(held: T28) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
async function via28(s: S28): Promise<T28> {
  return s;
}

type S29 = string;
type T29 = { length: number; anchor(text: string): string };
function honest29(): T29 {
  return { length: 29, anchor: () => "" };
}
function use29(t: T29): number {
  return t.length + 1;
}
class Holder29 {
  before = 1;
  held: T29;
  constructor(held: T29) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via29(s: S29): Promise<T29> {
  return Promise.resolve<T29>(s);
}

type S30 = string;
type T30 = { length: number; fontcolor(text: string): string };
function honest30(): T30 {
  return { length: 30, fontcolor: () => "" };
}
function use30(t: T30): number {
  return t.length + 1;
}
class Holder30 {
  before = 1;
  held: T30;
  constructor(held: T30) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via30(s: S30): Promise<T30> {
  return Promise.resolve(0).then((): T30 => s);
}

type S31 = string;
type T31 = { length: number; link(text: string): string };
function honest31(): T31 {
  return { length: 31, link: () => "" };
}
function use31(t: T31): number {
  return t.length + 1;
}
class Holder31 {
  before = 1;
  held: T31;
  constructor(held: T31) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via31(s: S31): Promise<T31> {
  return new Promise<T31>(resolve => resolve(s));
}

type S32 = string;
type T32 = { length: number; trim(): string; trimStart(): string };
function honest32(): T32 {
  return { length: 32, trim: () => "", trimStart: () => "" };
}
function use32(t: T32): number {
  return t.length + 1;
}
class Holder32 {
  before = 1;
  held: T32;
  constructor(held: T32) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via32(s: S32): T32 {
  return [0].map((): T32 => s)[0];
}

type S33 = string;
type T33 = { length: number; trimStart(): string; trimEnd(): string };
function honest33(): T33 {
  return { length: 33, trimStart: () => "", trimEnd: () => "" };
}
function use33(t: T33): number {
  return t.length + 1;
}
class Holder33 {
  before = 1;
  held: T33;
  constructor(held: T33) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function same33<X>(x: X): X {
  return x;
}
function via33(s: S33): T33 {
  return same33<T33>(s);
}

type S34 = string;
type T34 = { length: number; trimEnd(): string; toUpperCase(): string };
function honest34(): T34 {
  return { length: 34, trimEnd: () => "", toUpperCase: () => "" };
}
function use34(t: T34): number {
  return t.length + 1;
}
class Holder34 {
  before = 1;
  held: T34;
  constructor(held: T34) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function widen34<X extends T34>(x: X): T34 {
  return x;
}
function via34(s: S34): T34 {
  return widen34(s);
}

type S35 = string;
type T35 = { length: number; toUpperCase(): string; toLowerCase(): string };
function honest35(): T35 {
  return { length: 35, toUpperCase: () => "", toLowerCase: () => "" };
}
function use35(t: T35): number {
  return t.length + 1;
}
class Holder35 {
  before = 1;
  held: T35;
  constructor(held: T35) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via35(s: S35): T35 {
  let t: T35 = honest35();
  for (t of [s]);
  return t;
}

let warm = 0;
for (let i = 0; i < 500; i++) warm += use24(honest24()) + new Holder24(honest24()).size();
{
  const t = await via24(text);
  attempt("the entries a map is made from: typeof", () => typeof t);
  attempt("the entries a map is made from: length + 1", () => use24(t));
  attempt("the entries a map is made from: in a field", () => new Holder24(t).size());
  attempt("the entries a map is made from: honest again", () => use24(honest24()));
}
for (let i = 0; i < 500; i++) warm += use25(honest25()) + new Holder25(honest25()).size();
{
  const t = await via25(text);
  attempt("a member of a set: typeof", () => typeof t);
  attempt("a member of a set: length + 1", () => use25(t));
  attempt("a member of a set: in a field", () => new Holder25(t).size());
  attempt("a member of a set: honest again", () => use25(honest25()));
}
for (let i = 0; i < 500; i++) warm += use26(honest26()) + new Holder26(honest26()).size();
{
  const t = await via26(text);
  attempt("yield: typeof", () => typeof t);
  attempt("yield: length + 1", () => use26(t));
  attempt("yield: in a field", () => new Holder26(t).size());
  attempt("yield: honest again", () => use26(honest26()));
}
for (let i = 0; i < 500; i++) warm += use27(honest27()) + new Holder27(honest27()).size();
{
  const t = await via27(text);
  attempt("the value sent into a generator: typeof", () => typeof t);
  attempt("the value sent into a generator: length + 1", () => use27(t));
  attempt("the value sent into a generator: in a field", () => new Holder27(t).size());
  attempt("the value sent into a generator: honest again", () => use27(honest27()));
}
for (let i = 0; i < 500; i++) warm += use28(honest28()) + new Holder28(honest28()).size();
{
  const t = await via28(text);
  attempt("the result of an async function: typeof", () => typeof t);
  attempt("the result of an async function: length + 1", () => use28(t));
  attempt("the result of an async function: in a field", () => new Holder28(t).size());
  attempt("the result of an async function: honest again", () => use28(honest28()));
}
for (let i = 0; i < 500; i++) warm += use29(honest29()) + new Holder29(honest29()).size();
{
  const t = await via29(text);
  attempt("Promise.resolve: typeof", () => typeof t);
  attempt("Promise.resolve: length + 1", () => use29(t));
  attempt("Promise.resolve: in a field", () => new Holder29(t).size());
  attempt("Promise.resolve: honest again", () => use29(honest29()));
}
for (let i = 0; i < 500; i++) warm += use30(honest30()) + new Holder30(honest30()).size();
{
  const t = await via30(text);
  attempt("the result of a reaction: typeof", () => typeof t);
  attempt("the result of a reaction: length + 1", () => use30(t));
  attempt("the result of a reaction: in a field", () => new Holder30(t).size());
  attempt("the result of a reaction: honest again", () => use30(honest30()));
}
for (let i = 0; i < 500; i++) warm += use31(honest31()) + new Holder31(honest31()).size();
{
  const t = await via31(text);
  attempt("the resolver of a promise: typeof", () => typeof t);
  attempt("the resolver of a promise: length + 1", () => use31(t));
  attempt("the resolver of a promise: in a field", () => new Holder31(t).size());
  attempt("the resolver of a promise: honest again", () => use31(honest31()));
}
for (let i = 0; i < 500; i++) warm += use32(honest32()) + new Holder32(honest32()).size();
{
  const t = await via32(text);
  attempt("the result of a callback: typeof", () => typeof t);
  attempt("the result of a callback: length + 1", () => use32(t));
  attempt("the result of a callback: in a field", () => new Holder32(t).size());
  attempt("the result of a callback: honest again", () => use32(honest32()));
}
for (let i = 0; i < 500; i++) warm += use33(honest33()) + new Holder33(honest33()).size();
{
  const t = await via33(text);
  attempt("an explicit type argument: typeof", () => typeof t);
  attempt("an explicit type argument: length + 1", () => use33(t));
  attempt("an explicit type argument: in a field", () => new Holder33(t).size());
  attempt("an explicit type argument: honest again", () => use33(honest33()));
}
for (let i = 0; i < 500; i++) warm += use34(honest34()) + new Holder34(honest34()).size();
{
  const t = await via34(text);
  attempt("a constrained type parameter: typeof", () => typeof t);
  attempt("a constrained type parameter: length + 1", () => use34(t));
  attempt("a constrained type parameter: in a field", () => new Holder34(t).size());
  attempt("a constrained type parameter: honest again", () => use34(honest34()));
}
for (let i = 0; i < 500; i++) warm += use35(honest35()) + new Holder35(honest35()).size();
{
  const t = await via35(text);
  attempt("the target of a for-of: typeof", () => typeof t);
  attempt("the target of a for-of: length + 1", () => use35(t));
  attempt("the target of a for-of: in a field", () => new Holder35(t).size());
  attempt("the target of a for-of: honest again", () => use35(honest35()));
}
console.log("honest uses", warm);

export {};
