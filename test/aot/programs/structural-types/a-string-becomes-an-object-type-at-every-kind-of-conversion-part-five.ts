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

type S48 = string;
type T48 = { length: number; small(): string; strike(): string };
function honest48(): T48 {
  return { length: 48, small: () => "", strike: () => "" };
}
function use48(t: T48): number {
  return t.length + 1;
}
class Holder48 {
  before = 1;
  held: T48;
  constructor(held: T48) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function take48(t: T48): T48 {
  return t;
}
function via48(s: S48): T48 {
  return take48.apply(undefined, [s]);
}

type S49 = string;
type T49 = { length: number; strike(): string; sub(): string };
function honest49(): T49 {
  return { length: 49, strike: () => "", sub: () => "" };
}
function use49(t: T49): number {
  return t.length + 1;
}
class Holder49 {
  before = 1;
  held: T49;
  constructor(held: T49) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function take49(t: T49): T49 {
  return t;
}
function via49(s: S49): T49 {
  return take49.bind(undefined, s)();
}

type S50 = string;
type T50 = { length: number; sub(): string; sup(): string };
function honest50(): T50 {
  return { length: 50, sub: () => "", sup: () => "" };
}
function use50(t: T50): number {
  return t.length + 1;
}
class Holder50 {
  before = 1;
  held: T50;
  constructor(held: T50) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function take50(t: T50): T50 {
  return t;
}
function via50(s: S50): T50 {
  return Reflect.apply(take50, undefined, [s]);
}

type S51 = string;
type T51 = { length: number; sup(): string; slice(): string };
function honest51(): T51 {
  return { length: 51, sup: () => "", slice: () => "" };
}
function use51(t: T51): number {
  return t.length + 1;
}
class Holder51 {
  before = 1;
  held: T51;
  constructor(held: T51) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function self51(this: T51): T51 {
  return this;
}
function via51(s: S51): T51 {
  return self51.call(s);
}

type S52 = string;
type T52 = { length: number; slice(): string; concat(): string };
function honest52(): T52 {
  return { length: 52, slice: () => "", concat: () => "" };
}
function use52(t: T52): number {
  return t.length + 1;
}
class Holder52 {
  before = 1;
  held: T52;
  constructor(held: T52) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via52(s: S52): T52 {
  const holder: { held: T52 } = { held: honest52() };
  holder.held = s;
  return holder.held;
}

type S53 = string;
type T53 = { length: number; concat(): string; charAt(count: number): string };
function honest53(): T53 {
  return { length: 53, concat: () => "", charAt: () => "" };
}
function use53(t: T53): number {
  return t.length + 1;
}
class Holder53 {
  before = 1;
  held: T53;
  constructor(held: T53) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via53(s: S53): T53 {
  const list: T53[] = [honest53()];
  list[0] = s;
  return list[0];
}

type S54 = string;
type T54 = { length: number; charAt(count: number): string; repeat(count: number): string };
function honest54(): T54 {
  return { length: 54, charAt: () => "", repeat: () => "" };
}
function use54(t: T54): number {
  return t.length + 1;
}
class Holder54 {
  before = 1;
  held: T54;
  constructor(held: T54) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via54(s: S54): T54 {
  const holder: { held: T54 } = { held: honest54() };
  [holder.held] = [s];
  return holder.held;
}

type S55 = string;
type T55 = { length: number; repeat(count: number): string; padStart(count: number): string };
function honest55(): T55 {
  return { length: 55, repeat: () => "", padStart: () => "" };
}
function use55(t: T55): number {
  return t.length + 1;
}
class Holder55 {
  before = 1;
  held: T55;
  constructor(held: T55) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via55(s: S55): T55 {
  const holder: { held: T55 } = { held: honest55() };
  ({ from: holder.held } = { from: s });
  return holder.held;
}

type S56 = string;
type T56 = { length: number; padStart(count: number): string; padEnd(count: number): string };
function honest56(): T56 {
  return { length: 56, padStart: () => "", padEnd: () => "" };
}
function use56(t: T56): number {
  return t.length + 1;
}
class Holder56 {
  before = 1;
  held: T56;
  constructor(held: T56) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via56(s: S56): T56 {
  const holder: { held: T56 } = { held: honest56() };
  Object.assign(holder, { held: s });
  return holder.held;
}

type S57 = string;
type T57 = { length: number; padEnd(count: number): string; substring(count: number): string };
function honest57(): T57 {
  return { length: 57, padEnd: () => "", substring: () => "" };
}
function use57(t: T57): number {
  return t.length + 1;
}
class Holder57 {
  before = 1;
  held: T57;
  constructor(held: T57) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via57(s: S57): T57 {
  const either: T57 | number = s;
  return typeof either === "number" ? honest57() : either;
}

type S58 = string;
type T58 = { length: number; substring(count: number): string; substr(count: number): string };
function honest58(): T58 {
  return { length: 58, substring: () => "", substr: () => "" };
}
function use58(t: T58): number {
  return t.length + 1;
}
class Holder58 {
  before = 1;
  held: T58;
  constructor(held: T58) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via58(s: S58): T58 {
  const record: Record<string, T58> = { k: s };
  return record.k;
}

type S59 = string;
type T59 = { length: number; substr(count: number): string; fontsize(count: number): string };
function honest59(): T59 {
  return { length: 59, substr: () => "", fontsize: () => "" };
}
function use59(t: T59): number {
  return t.length + 1;
}
class Holder59 {
  before = 1;
  held: T59;
  constructor(held: T59) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via59(s: S59): T59 {
  const sources: S59[] = [s];
  const list: T59[] = sources;
  return list[0];
}

let warm = 0;
for (let i = 0; i < 500; i++) warm += use48(honest48()) + new Holder48(honest48()).size();
{
  const t = await via48(text);
  attempt("apply: typeof", () => typeof t);
  attempt("apply: length + 1", () => use48(t));
  attempt("apply: in a field", () => new Holder48(t).size());
  attempt("apply: honest again", () => use48(honest48()));
}
for (let i = 0; i < 500; i++) warm += use49(honest49()) + new Holder49(honest49()).size();
{
  const t = await via49(text);
  attempt("bind: typeof", () => typeof t);
  attempt("bind: length + 1", () => use49(t));
  attempt("bind: in a field", () => new Holder49(t).size());
  attempt("bind: honest again", () => use49(honest49()));
}
for (let i = 0; i < 500; i++) warm += use50(honest50()) + new Holder50(honest50()).size();
{
  const t = await via50(text);
  attempt("Reflect.apply: typeof", () => typeof t);
  attempt("Reflect.apply: length + 1", () => use50(t));
  attempt("Reflect.apply: in a field", () => new Holder50(t).size());
  attempt("Reflect.apply: honest again", () => use50(honest50()));
}
for (let i = 0; i < 500; i++) warm += use51(honest51()) + new Holder51(honest51()).size();
{
  const t = await via51(text);
  attempt("this of a call: typeof", () => typeof t);
  attempt("this of a call: length + 1", () => use51(t));
  attempt("this of a call: in a field", () => new Holder51(t).size());
  attempt("this of a call: honest again", () => use51(honest51()));
}
for (let i = 0; i < 500; i++) warm += use52(honest52()) + new Holder52(honest52()).size();
{
  const t = await via52(text);
  attempt("a store to a member: typeof", () => typeof t);
  attempt("a store to a member: length + 1", () => use52(t));
  attempt("a store to a member: in a field", () => new Holder52(t).size());
  attempt("a store to a member: honest again", () => use52(honest52()));
}
for (let i = 0; i < 500; i++) warm += use53(honest53()) + new Holder53(honest53()).size();
{
  const t = await via53(text);
  attempt("a store to an element: typeof", () => typeof t);
  attempt("a store to an element: length + 1", () => use53(t));
  attempt("a store to an element: in a field", () => new Holder53(t).size());
  attempt("a store to an element: honest again", () => use53(honest53()));
}
for (let i = 0; i < 500; i++) warm += use54(honest54()) + new Holder54(honest54()).size();
{
  const t = await via54(text);
  attempt("an array pattern that is assigned to: typeof", () => typeof t);
  attempt("an array pattern that is assigned to: length + 1", () => use54(t));
  attempt("an array pattern that is assigned to: in a field", () => new Holder54(t).size());
  attempt("an array pattern that is assigned to: honest again", () => use54(honest54()));
}
for (let i = 0; i < 500; i++) warm += use55(honest55()) + new Holder55(honest55()).size();
{
  const t = await via55(text);
  attempt("an object pattern that is assigned to: typeof", () => typeof t);
  attempt("an object pattern that is assigned to: length + 1", () => use55(t));
  attempt("an object pattern that is assigned to: in a field", () => new Holder55(t).size());
  attempt("an object pattern that is assigned to: honest again", () => use55(honest55()));
}
for (let i = 0; i < 500; i++) warm += use56(honest56()) + new Holder56(honest56()).size();
{
  const t = await via56(text);
  attempt("Object.assign: typeof", () => typeof t);
  attempt("Object.assign: length + 1", () => use56(t));
  attempt("Object.assign: in a field", () => new Holder56(t).size());
  attempt("Object.assign: honest again", () => use56(honest56()));
}
for (let i = 0; i < 500; i++) warm += use57(honest57()) + new Holder57(honest57()).size();
{
  const t = await via57(text);
  attempt("a union that is narrowed again: typeof", () => typeof t);
  attempt("a union that is narrowed again: length + 1", () => use57(t));
  attempt("a union that is narrowed again: in a field", () => new Holder57(t).size());
  attempt("a union that is narrowed again: honest again", () => use57(honest57()));
}
for (let i = 0; i < 500; i++) warm += use58(honest58()) + new Holder58(honest58()).size();
{
  const t = await via58(text);
  attempt("an entry of a record: typeof", () => typeof t);
  attempt("an entry of a record: length + 1", () => use58(t));
  attempt("an entry of a record: in a field", () => new Holder58(t).size());
  attempt("an entry of a record: honest again", () => use58(honest58()));
}
for (let i = 0; i < 500; i++) warm += use59(honest59()) + new Holder59(honest59()).size();
{
  const t = await via59(text);
  attempt("an array of the narrower type: typeof", () => typeof t);
  attempt("an array of the narrower type: length + 1", () => use59(t));
  attempt("an array of the narrower type: in a field", () => new Holder59(t).size());
  attempt("an array of the narrower type: honest again", () => use59(honest59()));
}
console.log("honest uses", warm);

export {};
