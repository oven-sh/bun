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

type S12 = string;
type T12 = { length: number; blink(): string };
function honest12(): T12 {
  return { length: 12, blink: () => "" };
}
function use12(t: T12): number {
  return t.length + 1;
}
class Holder12 {
  before = 1;
  held: T12;
  constructor(held: T12) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via12(s: S12): T12 {
  const holder: { held: T12 } = { held: s };
  return holder.held;
}

type S13 = string;
type T13 = { length: number; bold(): string };
function honest13(): T13 {
  return { length: 13, bold: () => "" };
}
function use13(t: T13): number {
  return t.length + 1;
}
class Holder13 {
  before = 1;
  held: T13;
  constructor(held: T13) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via13(s: S13): T13 {
  const held = s;
  const holder: { held: T13 } = { held };
  return holder.held;
}

type S14 = string;
type T14 = { length: number; fixed(): string };
function honest14(): T14 {
  return { length: 14, fixed: () => "" };
}
function use14(t: T14): number {
  return t.length + 1;
}
class Holder14 {
  before = 1;
  held: T14;
  constructor(held: T14) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via14(s: S14): T14 {
  class Keeper {
    held: T14 = s;
  }
  return new Keeper().held;
}

type S15 = string;
type T15 = { length: number; italics(): string };
function honest15(): T15 {
  return { length: 15, italics: () => "" };
}
function use15(t: T15): number {
  return t.length + 1;
}
class Holder15 {
  before = 1;
  held: T15;
  constructor(held: T15) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
class Keeper15 {
  constructor(public held: T15) {}
}
function via15(s: S15): T15 {
  return new Keeper15(s).held;
}

type S16 = string;
type T16 = { length: number; small(): string };
function honest16(): T16 {
  return { length: 16, small: () => "" };
}
function use16(t: T16): number {
  return t.length + 1;
}
class Holder16 {
  before = 1;
  held: T16;
  constructor(held: T16) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via16(s: S16): T16 {
  const take = (t: T16 = s): T16 => t;
  return take();
}

type S17 = string;
type T17 = { length: number; strike(): string };
function honest17(): T17 {
  return { length: 17, strike: () => "" };
}
function use17(t: T17): number {
  return t.length + 1;
}
class Holder17 {
  before = 1;
  held: T17;
  constructor(held: T17) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via17(s: S17): T17 {
  const { held = s }: { held?: T17 } = {};
  return held;
}

type S18 = string;
type T18 = { length: number; sub(): string };
function honest18(): T18 {
  return { length: 18, sub: () => "" };
}
function use18(t: T18): number {
  return t.length + 1;
}
class Holder18 {
  before = 1;
  held: T18;
  constructor(held: T18) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function take18(t: T18): T18 {
  return t;
}
function via18(s: S18): T18 {
  const list: [S18] = [s];
  return take18(...list);
}

type S19 = string;
type T19 = { length: number; sup(): string };
function honest19(): T19 {
  return { length: 19, sup: () => "" };
}
function use19(t: T19): number {
  return t.length + 1;
}
class Holder19 {
  before = 1;
  held: T19;
  constructor(held: T19) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function last19(...list: T19[]): T19 {
  return list[list.length - 1];
}
function via19(s: S19): T19 {
  return last19(honest19(), s);
}

type S20 = string;
type T20 = { length: number; slice(): string };
function honest20(): T20 {
  return { length: 20, slice: () => "" };
}
function use20(t: T20): number {
  return t.length + 1;
}
class Holder20 {
  before = 1;
  held: T20;
  constructor(held: T20) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via20(s: S20): T20 {
  const sources: S20[] = [s];
  const list: T20[] = [...sources];
  return list[0];
}

type S21 = string;
type T21 = { length: number; concat(): string };
function honest21(): T21 {
  return { length: 21, concat: () => "" };
}
function use21(t: T21): number {
  return t.length + 1;
}
class Holder21 {
  before = 1;
  held: T21;
  constructor(held: T21) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via21(s: S21): T21 {
  const source = { held: s };
  const holder: { held: T21 } = { ...source };
  return holder.held;
}

type S22 = string;
type T22 = { length: number; charAt(count: number): string };
function honest22(): T22 {
  return { length: 22, charAt: () => "" };
}
function use22(t: T22): number {
  return t.length + 1;
}
class Holder22 {
  before = 1;
  held: T22;
  constructor(held: T22) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via22(s: S22): T22 {
  const list: T22[] = [];
  list.push(s);
  return list[0];
}

type S23 = string;
type T23 = { length: number; repeat(count: number): string };
function honest23(): T23 {
  return { length: 23, repeat: () => "" };
}
function use23(t: T23): number {
  return t.length + 1;
}
class Holder23 {
  before = 1;
  held: T23;
  constructor(held: T23) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via23(s: S23): T23 {
  const map = new Map<string, T23>();
  map.set("k", s);
  return map.get("k") ?? honest23();
}

let warm = 0;
for (let i = 0; i < 500; i++) warm += use12(honest12()) + new Holder12(honest12()).size();
{
  const t = await via12(text);
  attempt("a member of an object literal: typeof", () => typeof t);
  attempt("a member of an object literal: length + 1", () => use12(t));
  attempt("a member of an object literal: in a field", () => new Holder12(t).size());
  attempt("a member of an object literal: honest again", () => use12(honest12()));
}
for (let i = 0; i < 500; i++) warm += use13(honest13()) + new Holder13(honest13()).size();
{
  const t = await via13(text);
  attempt("a shorthand member: typeof", () => typeof t);
  attempt("a shorthand member: length + 1", () => use13(t));
  attempt("a shorthand member: in a field", () => new Holder13(t).size());
  attempt("a shorthand member: honest again", () => use13(honest13()));
}
for (let i = 0; i < 500; i++) warm += use14(honest14()) + new Holder14(honest14()).size();
{
  const t = await via14(text);
  attempt("the initializer of a field: typeof", () => typeof t);
  attempt("the initializer of a field: length + 1", () => use14(t));
  attempt("the initializer of a field: in a field", () => new Holder14(t).size());
  attempt("the initializer of a field: honest again", () => use14(honest14()));
}
for (let i = 0; i < 500; i++) warm += use15(honest15()) + new Holder15(honest15()).size();
{
  const t = await via15(text);
  attempt("a parameter property: typeof", () => typeof t);
  attempt("a parameter property: length + 1", () => use15(t));
  attempt("a parameter property: in a field", () => new Holder15(t).size());
  attempt("a parameter property: honest again", () => use15(honest15()));
}
for (let i = 0; i < 500; i++) warm += use16(honest16()) + new Holder16(honest16()).size();
{
  const t = await via16(text);
  attempt("the default of a parameter: typeof", () => typeof t);
  attempt("the default of a parameter: length + 1", () => use16(t));
  attempt("the default of a parameter: in a field", () => new Holder16(t).size());
  attempt("the default of a parameter: honest again", () => use16(honest16()));
}
for (let i = 0; i < 500; i++) warm += use17(honest17()) + new Holder17(honest17()).size();
{
  const t = await via17(text);
  attempt("the default in a pattern: typeof", () => typeof t);
  attempt("the default in a pattern: length + 1", () => use17(t));
  attempt("the default in a pattern: in a field", () => new Holder17(t).size());
  attempt("the default in a pattern: honest again", () => use17(honest17()));
}
for (let i = 0; i < 500; i++) warm += use18(honest18()) + new Holder18(honest18()).size();
{
  const t = await via18(text);
  attempt("a spread argument: typeof", () => typeof t);
  attempt("a spread argument: length + 1", () => use18(t));
  attempt("a spread argument: in a field", () => new Holder18(t).size());
  attempt("a spread argument: honest again", () => use18(honest18()));
}
for (let i = 0; i < 500; i++) warm += use19(honest19()) + new Holder19(honest19()).size();
{
  const t = await via19(text);
  attempt("a rest parameter: typeof", () => typeof t);
  attempt("a rest parameter: length + 1", () => use19(t));
  attempt("a rest parameter: in a field", () => new Holder19(t).size());
  attempt("a rest parameter: honest again", () => use19(honest19()));
}
for (let i = 0; i < 500; i++) warm += use20(honest20()) + new Holder20(honest20()).size();
{
  const t = await via20(text);
  attempt("a spread into an array literal: typeof", () => typeof t);
  attempt("a spread into an array literal: length + 1", () => use20(t));
  attempt("a spread into an array literal: in a field", () => new Holder20(t).size());
  attempt("a spread into an array literal: honest again", () => use20(honest20()));
}
for (let i = 0; i < 500; i++) warm += use21(honest21()) + new Holder21(honest21()).size();
{
  const t = await via21(text);
  attempt("a spread into an object literal: typeof", () => typeof t);
  attempt("a spread into an object literal: length + 1", () => use21(t));
  attempt("a spread into an object literal: in a field", () => new Holder21(t).size());
  attempt("a spread into an object literal: honest again", () => use21(honest21()));
}
for (let i = 0; i < 500; i++) warm += use22(honest22()) + new Holder22(honest22()).size();
{
  const t = await via22(text);
  attempt("push: typeof", () => typeof t);
  attempt("push: length + 1", () => use22(t));
  attempt("push: in a field", () => new Holder22(t).size());
  attempt("push: honest again", () => use22(honest22()));
}
for (let i = 0; i < 500; i++) warm += use23(honest23()) + new Holder23(honest23()).size();
{
  const t = await via23(text);
  attempt("the value of a map entry: typeof", () => typeof t);
  attempt("the value of a map entry: length + 1", () => use23(t));
  attempt("the value of a map entry: in a field", () => new Holder23(t).size());
  attempt("the value of a map entry: honest again", () => use23(honest23()));
}
console.log("honest uses", warm);

export {};
