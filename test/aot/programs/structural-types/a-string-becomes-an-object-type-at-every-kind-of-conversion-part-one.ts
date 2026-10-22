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

type S0 = string;
type T0 = { length: number; trim(): string };
function honest0(): T0 {
  return { length: 0, trim: () => "" };
}
function use0(t: T0): number {
  return t.length + 1;
}
class Holder0 {
  before = 1;
  held: T0;
  constructor(held: T0) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via0(s: S0): T0 {
  const t: T0 = s;
  return t;
}

type S1 = string;
type T1 = { length: number; trimStart(): string };
function honest1(): T1 {
  return { length: 1, trimStart: () => "" };
}
function use1(t: T1): number {
  return t.length + 1;
}
class Holder1 {
  before = 1;
  held: T1;
  constructor(held: T1) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via1(s: S1): T1 {
  let t: T1 = honest1();
  t = s;
  return t;
}

type S2 = string;
type T2 = { length: number; trimEnd(): string };
function honest2(): T2 {
  return { length: 2, trimEnd: () => "" };
}
function use2(t: T2): number {
  return t.length + 1;
}
class Holder2 {
  before = 1;
  held: T2;
  constructor(held: T2) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function take2(t: T2): T2 {
  return t;
}
function via2(s: S2): T2 {
  return take2(s);
}

type S3 = string;
type T3 = { length: number; toUpperCase(): string };
function honest3(): T3 {
  return { length: 3, toUpperCase: () => "" };
}
function use3(t: T3): number {
  return t.length + 1;
}
class Holder3 {
  before = 1;
  held: T3;
  constructor(held: T3) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via3(s: S3): T3 {
  return s;
}

type S4 = string;
type T4 = { length: number; toLowerCase(): string };
function honest4(): T4 {
  return { length: 4, toLowerCase: () => "" };
}
function use4(t: T4): number {
  return t.length + 1;
}
class Holder4 {
  before = 1;
  held: T4;
  constructor(held: T4) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
const via4 = (s: S4): T4 => s;

type S5 = string;
type T5 = { length: number; toLocaleUpperCase(): string };
function honest5(): T5 {
  return { length: 5, toLocaleUpperCase: () => "" };
}
function use5(t: T5): number {
  return t.length + 1;
}
class Holder5 {
  before = 1;
  held: T5;
  constructor(held: T5) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via5(s: S5): T5 {
  const t: T5 = yes ? s : honest5();
  return t;
}

type S6 = string;
type T6 = { length: number; toLocaleLowerCase(): string };
function honest6(): T6 {
  return { length: 6, toLocaleLowerCase: () => "" };
}
function use6(t: T6): number {
  return t.length + 1;
}
class Holder6 {
  before = 1;
  held: T6;
  constructor(held: T6) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via6(s: S6, none?: T6): T6 {
  return none ?? s;
}

type S7 = string;
type T7 = { length: number; toString(): string };
function honest7(): T7 {
  return { length: 7, toString: () => "" };
}
function use7(t: T7): number {
  return t.length + 1;
}
class Holder7 {
  before = 1;
  held: T7;
  constructor(held: T7) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via7(s: S7, none?: T7): T7 {
  return none || s;
}

type S8 = string;
type T8 = { length: number; valueOf(): string };
function honest8(): T8 {
  return { length: 8, valueOf: () => "" };
}
function use8(t: T8): number {
  return t.length + 1;
}
class Holder8 {
  before = 1;
  held: T8;
  constructor(held: T8) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via8(s: S8): T8 {
  const t: T8 | boolean = yes && s;
  return typeof t === "boolean" ? honest8() : t;
}

type S9 = string;
type T9 = { length: number; normalize(): string };
function honest9(): T9 {
  return { length: 9, normalize: () => "" };
}
function use9(t: T9): number {
  return t.length + 1;
}
class Holder9 {
  before = 1;
  held: T9;
  constructor(held: T9) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via9(s: S9): T9 {
  return (touch(), s);
}

type S10 = string;
type T10 = { length: number; toWellFormed(): string };
function honest10(): T10 {
  return { length: 10, toWellFormed: () => "" };
}
function use10(t: T10): number {
  return t.length + 1;
}
class Holder10 {
  before = 1;
  held: T10;
  constructor(held: T10) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via10(s: S10): T10 {
  return s satisfies T10;
}

type S11 = string;
type T11 = { length: number; big(): string };
function honest11(): T11 {
  return { length: 11, big: () => "" };
}
function use11(t: T11): number {
  return t.length + 1;
}
class Holder11 {
  before = 1;
  held: T11;
  constructor(held: T11) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via11(s: S11): T11 {
  const list: T11[] = [honest11(), s];
  return list[1];
}

let warm = 0;
for (let i = 0; i < 500; i++) warm += use0(honest0()) + new Holder0(honest0()).size();
{
  const t = await via0(text);
  attempt("a declaration: typeof", () => typeof t);
  attempt("a declaration: length + 1", () => use0(t));
  attempt("a declaration: in a field", () => new Holder0(t).size());
  attempt("a declaration: honest again", () => use0(honest0()));
}
for (let i = 0; i < 500; i++) warm += use1(honest1()) + new Holder1(honest1()).size();
{
  const t = await via1(text);
  attempt("an assignment: typeof", () => typeof t);
  attempt("an assignment: length + 1", () => use1(t));
  attempt("an assignment: in a field", () => new Holder1(t).size());
  attempt("an assignment: honest again", () => use1(honest1()));
}
for (let i = 0; i < 500; i++) warm += use2(honest2()) + new Holder2(honest2()).size();
{
  const t = await via2(text);
  attempt("an argument: typeof", () => typeof t);
  attempt("an argument: length + 1", () => use2(t));
  attempt("an argument: in a field", () => new Holder2(t).size());
  attempt("an argument: honest again", () => use2(honest2()));
}
for (let i = 0; i < 500; i++) warm += use3(honest3()) + new Holder3(honest3()).size();
{
  const t = await via3(text);
  attempt("a return statement: typeof", () => typeof t);
  attempt("a return statement: length + 1", () => use3(t));
  attempt("a return statement: in a field", () => new Holder3(t).size());
  attempt("a return statement: honest again", () => use3(honest3()));
}
for (let i = 0; i < 500; i++) warm += use4(honest4()) + new Holder4(honest4()).size();
{
  const t = await via4(text);
  attempt("the body of an arrow function: typeof", () => typeof t);
  attempt("the body of an arrow function: length + 1", () => use4(t));
  attempt("the body of an arrow function: in a field", () => new Holder4(t).size());
  attempt("the body of an arrow function: honest again", () => use4(honest4()));
}
for (let i = 0; i < 500; i++) warm += use5(honest5()) + new Holder5(honest5()).size();
{
  const t = await via5(text);
  attempt("an arm of a conditional expression: typeof", () => typeof t);
  attempt("an arm of a conditional expression: length + 1", () => use5(t));
  attempt("an arm of a conditional expression: in a field", () => new Holder5(t).size());
  attempt("an arm of a conditional expression: honest again", () => use5(honest5()));
}
for (let i = 0; i < 500; i++) warm += use6(honest6()) + new Holder6(honest6()).size();
{
  const t = await via6(text);
  attempt("the right side of ??: typeof", () => typeof t);
  attempt("the right side of ??: length + 1", () => use6(t));
  attempt("the right side of ??: in a field", () => new Holder6(t).size());
  attempt("the right side of ??: honest again", () => use6(honest6()));
}
for (let i = 0; i < 500; i++) warm += use7(honest7()) + new Holder7(honest7()).size();
{
  const t = await via7(text);
  attempt("the right side of ||: typeof", () => typeof t);
  attempt("the right side of ||: length + 1", () => use7(t));
  attempt("the right side of ||: in a field", () => new Holder7(t).size());
  attempt("the right side of ||: honest again", () => use7(honest7()));
}
for (let i = 0; i < 500; i++) warm += use8(honest8()) + new Holder8(honest8()).size();
{
  const t = await via8(text);
  attempt("the right side of &&: typeof", () => typeof t);
  attempt("the right side of &&: length + 1", () => use8(t));
  attempt("the right side of &&: in a field", () => new Holder8(t).size());
  attempt("the right side of &&: honest again", () => use8(honest8()));
}
for (let i = 0; i < 500; i++) warm += use9(honest9()) + new Holder9(honest9()).size();
{
  const t = await via9(text);
  attempt("the last operand of a comma: typeof", () => typeof t);
  attempt("the last operand of a comma: length + 1", () => use9(t));
  attempt("the last operand of a comma: in a field", () => new Holder9(t).size());
  attempt("the last operand of a comma: honest again", () => use9(honest9()));
}
for (let i = 0; i < 500; i++) warm += use10(honest10()) + new Holder10(honest10()).size();
{
  const t = await via10(text);
  attempt("satisfies: typeof", () => typeof t);
  attempt("satisfies: length + 1", () => use10(t));
  attempt("satisfies: in a field", () => new Holder10(t).size());
  attempt("satisfies: honest again", () => use10(honest10()));
}
for (let i = 0; i < 500; i++) warm += use11(honest11()) + new Holder11(honest11()).size();
{
  const t = await via11(text);
  attempt("an element of an array literal: typeof", () => typeof t);
  attempt("an element of an array literal: length + 1", () => use11(t));
  attempt("an element of an array literal: in a field", () => new Holder11(t).size());
  attempt("an element of an array literal: honest again", () => use11(honest11()));
}
console.log("honest uses", warm);

export {};
