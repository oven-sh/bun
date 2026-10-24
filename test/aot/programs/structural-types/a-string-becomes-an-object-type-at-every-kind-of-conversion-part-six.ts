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

type S60 = string;
type T60 = { length: number; fontsize(count: number): string; anchor(text: string): string };
function honest60(): T60 {
  return { length: 60, fontsize: () => "", anchor: () => "" };
}
function use60(t: T60): number {
  return t.length + 1;
}
class Holder60 {
  before = 1;
  held: T60;
  constructor(held: T60) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via60(s: S60): T60 {
  const source: { held: S60 } = { held: s };
  const holder: { held: T60 } = source;
  return holder.held;
}

type S61 = string;
type T61 = { length: number; anchor(text: string): string; fontcolor(text: string): string };
function honest61(): T61 {
  return { length: 61, anchor: () => "", fontcolor: () => "" };
}
function use61(t: T61): number {
  return t.length + 1;
}
class Holder61 {
  before = 1;
  held: T61;
  constructor(held: T61) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via61(s: S61): T61 {
  const sources = new Map<string, S61>([["k", s]]);
  const map: Map<string, T61> = sources;
  return map.get("k") ?? honest61();
}

type S62 = string;
type T62 = { length: number; fontcolor(text: string): string; link(text: string): string };
function honest62(): T62 {
  return { length: 62, fontcolor: () => "", link: () => "" };
}
function use62(t: T62): number {
  return t.length + 1;
}
class Holder62 {
  before = 1;
  held: T62;
  constructor(held: T62) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
class Source62 {
  constructor(public held: S62) {}
}
function via62(s: S62): T62 {
  const holder: { held: T62 } = new Source62(s);
  return holder.held;
}

type S63 = string;
type T63 = { length: number; link(text: string): string; trim(): string };
function honest63(): T63 {
  return { length: 63, link: () => "", trim: () => "" };
}
function use63(t: T63): number {
  return t.length + 1;
}
class Holder63 {
  before = 1;
  held: T63;
  constructor(held: T63) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via63(s: S63): T63 {
  class Keeper {
    static held: T63 = s;
  }
  return Keeper.held;
}

type S64 = string;
type T64 = { length: number; trim(): string; trimEnd(): string };
function honest64(): T64 {
  return { length: 64, trim: () => "", trimEnd: () => "" };
}
function use64(t: T64): number {
  return t.length + 1;
}
class Holder64 {
  before = 1;
  held: T64;
  constructor(held: T64) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
class Box64<X> {
  constructor(public held: X) {}
}
function via64(s: S64): T64 {
  return new Box64<T64>(s).held;
}

type S65 = string;
type T65 = { length: number; trimStart(): string; toUpperCase(): string };
function honest65(): T65 {
  return { length: 65, trimStart: () => "", toUpperCase: () => "" };
}
function use65(t: T65): number {
  return t.length + 1;
}
class Holder65 {
  before = 1;
  held: T65;
  constructor(held: T65) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via65(s: S65): T65 {
  return Array.of<T65>(s)[0];
}

type S66 = string;
type T66 = { length: number; trimEnd(): string; toLowerCase(): string };
function honest66(): T66 {
  return { length: 66, trimEnd: () => "", toLowerCase: () => "" };
}
function use66(t: T66): number {
  return t.length + 1;
}
class Holder66 {
  before = 1;
  held: T66;
  constructor(held: T66) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via66(s: S66): T66 {
  const sources: S66[] = [s];
  return Array.from<T66>(sources)[0];
}

type S67 = string;
type T67 = { length: number; toUpperCase(): string; toLocaleUpperCase(): string };
function honest67(): T67 {
  return { length: 67, toUpperCase: () => "", toLocaleUpperCase: () => "" };
}
function use67(t: T67): number {
  return t.length + 1;
}
class Holder67 {
  before = 1;
  held: T67;
  constructor(held: T67) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via67(s: S67): T67 {
  const list: T67[] = [honest67()];
  list.fill(s);
  return list[0];
}

type S68 = string;
type T68 = { length: number; toLowerCase(): string; toLocaleLowerCase(): string };
function honest68(): T68 {
  return { length: 68, toLowerCase: () => "", toLocaleLowerCase: () => "" };
}
function use68(t: T68): number {
  return t.length + 1;
}
class Holder68 {
  before = 1;
  held: T68;
  constructor(held: T68) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via68(s: S68): T68 {
  const list: T68[] = [honest68()];
  list.splice(0, 1, s);
  return list[0];
}

type S69 = string;
type T69 = { length: number; toLocaleUpperCase(): string; toString(): string };
function honest69(): T69 {
  return { length: 69, toLocaleUpperCase: () => "", toString: () => "" };
}
function use69(t: T69): number {
  return t.length + 1;
}
class Holder69 {
  before = 1;
  held: T69;
  constructor(held: T69) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via69(s: S69): T69 {
  const list: T69[] = [];
  return list.concat([s])[0];
}

type S70 = string;
type T70 = { length: number; toLocaleLowerCase(): string; valueOf(): string };
function honest70(): T70 {
  return { length: 70, toLocaleLowerCase: () => "", valueOf: () => "" };
}
function use70(t: T70): number {
  return t.length + 1;
}
class Holder70 {
  before = 1;
  held: T70;
  constructor(held: T70) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via70(s: S70): T70 {
  let t: T70 = honest70();
  const put = (): void => {
    t = s;
  };
  put();
  return t;
}

type S71 = string;
type T71 = { length: number; toString(): string; normalize(): string };
function honest71(): T71 {
  return { length: 71, toString: () => "", normalize: () => "" };
}
function use71(t: T71): number {
  return t.length + 1;
}
class Holder71 {
  before = 1;
  held: T71;
  constructor(held: T71) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via71(s: S71): T71 {
  const t: T71 & {} = s;
  return t;
}

let warm = 0;
for (let i = 0; i < 500; i++) warm += use60(honest60()) + new Holder60(honest60()).size();
{
  const t = await via60(text);
  attempt("an object with a member of the narrower type: typeof", () => typeof t);
  attempt("an object with a member of the narrower type: length + 1", () => use60(t));
  attempt("an object with a member of the narrower type: in a field", () => new Holder60(t).size());
  attempt("an object with a member of the narrower type: honest again", () => use60(honest60()));
}
for (let i = 0; i < 500; i++) warm += use61(honest61()) + new Holder61(honest61()).size();
{
  const t = await via61(text);
  attempt("a map of the narrower type: typeof", () => typeof t);
  attempt("a map of the narrower type: length + 1", () => use61(t));
  attempt("a map of the narrower type: in a field", () => new Holder61(t).size());
  attempt("a map of the narrower type: honest again", () => use61(honest61()));
}
for (let i = 0; i < 500; i++) warm += use62(honest62()) + new Holder62(honest62()).size();
{
  const t = await via62(text);
  attempt("an instance with a field of the narrower type: typeof", () => typeof t);
  attempt("an instance with a field of the narrower type: length + 1", () => use62(t));
  attempt("an instance with a field of the narrower type: in a field", () => new Holder62(t).size());
  attempt("an instance with a field of the narrower type: honest again", () => use62(honest62()));
}
for (let i = 0; i < 500; i++) warm += use63(honest63()) + new Holder63(honest63()).size();
{
  const t = await via63(text);
  attempt("a static field: typeof", () => typeof t);
  attempt("a static field: length + 1", () => use63(t));
  attempt("a static field: in a field", () => new Holder63(t).size());
  attempt("a static field: honest again", () => use63(honest63()));
}
for (let i = 0; i < 500; i++) warm += use64(honest64()) + new Holder64(honest64()).size();
{
  const t = await via64(text);
  attempt("a generic class: typeof", () => typeof t);
  attempt("a generic class: length + 1", () => use64(t));
  attempt("a generic class: in a field", () => new Holder64(t).size());
  attempt("a generic class: honest again", () => use64(honest64()));
}
for (let i = 0; i < 500; i++) warm += use65(honest65()) + new Holder65(honest65()).size();
{
  const t = await via65(text);
  attempt("Array.of: typeof", () => typeof t);
  attempt("Array.of: length + 1", () => use65(t));
  attempt("Array.of: in a field", () => new Holder65(t).size());
  attempt("Array.of: honest again", () => use65(honest65()));
}
for (let i = 0; i < 500; i++) warm += use66(honest66()) + new Holder66(honest66()).size();
{
  const t = await via66(text);
  attempt("Array.from: typeof", () => typeof t);
  attempt("Array.from: length + 1", () => use66(t));
  attempt("Array.from: in a field", () => new Holder66(t).size());
  attempt("Array.from: honest again", () => use66(honest66()));
}
for (let i = 0; i < 500; i++) warm += use67(honest67()) + new Holder67(honest67()).size();
{
  const t = await via67(text);
  attempt("fill: typeof", () => typeof t);
  attempt("fill: length + 1", () => use67(t));
  attempt("fill: in a field", () => new Holder67(t).size());
  attempt("fill: honest again", () => use67(honest67()));
}
for (let i = 0; i < 500; i++) warm += use68(honest68()) + new Holder68(honest68()).size();
{
  const t = await via68(text);
  attempt("splice: typeof", () => typeof t);
  attempt("splice: length + 1", () => use68(t));
  attempt("splice: in a field", () => new Holder68(t).size());
  attempt("splice: honest again", () => use68(honest68()));
}
for (let i = 0; i < 500; i++) warm += use69(honest69()) + new Holder69(honest69()).size();
{
  const t = await via69(text);
  attempt("concat: typeof", () => typeof t);
  attempt("concat: length + 1", () => use69(t));
  attempt("concat: in a field", () => new Holder69(t).size());
  attempt("concat: honest again", () => use69(honest69()));
}
for (let i = 0; i < 500; i++) warm += use70(honest70()) + new Holder70(honest70()).size();
{
  const t = await via70(text);
  attempt("a variable that a closure assigns: typeof", () => typeof t);
  attempt("a variable that a closure assigns: length + 1", () => use70(t));
  attempt("a variable that a closure assigns: in a field", () => new Holder70(t).size());
  attempt("a variable that a closure assigns: honest again", () => use70(honest70()));
}
for (let i = 0; i < 500; i++) warm += use71(honest71()) + new Holder71(honest71()).size();
{
  const t = await via71(text);
  attempt("an intersection with the empty object type: typeof", () => typeof t);
  attempt("an intersection with the empty object type: length + 1", () => use71(t));
  attempt("an intersection with the empty object type: in a field", () => new Holder71(t).size());
  attempt("an intersection with the empty object type: honest again", () => use71(honest71()));
}
console.log("honest uses", warm);

export {};
