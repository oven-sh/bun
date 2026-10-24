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

type S36 = string;
type T36 = { length: number; toLowerCase(): string; toLocaleUpperCase(): string };
function honest36(): T36 {
  return { length: 36, toLowerCase: () => "", toLocaleUpperCase: () => "" };
}
function use36(t: T36): number {
  return t.length + 1;
}
class Holder36 {
  before = 1;
  held: T36;
  constructor(held: T36) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via36(s: S36): T36 {
  let t: T36 | undefined;
  t ??= s;
  return t;
}

type S37 = string;
type T37 = { length: number; toLocaleUpperCase(): string; toLocaleLowerCase(): string };
function honest37(): T37 {
  return { length: 37, toLocaleUpperCase: () => "", toLocaleLowerCase: () => "" };
}
function use37(t: T37): number {
  return t.length + 1;
}
class Holder37 {
  before = 1;
  held: T37;
  constructor(held: T37) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via37(s: S37): T37 {
  let t: T37 | undefined;
  t ||= s;
  return t;
}

type S38 = string;
type T38 = { length: number; toLocaleLowerCase(): string; toString(): string };
function honest38(): T38 {
  return { length: 38, toLocaleLowerCase: () => "", toString: () => "" };
}
function use38(t: T38): number {
  return t.length + 1;
}
class Holder38 {
  before = 1;
  held: T38;
  constructor(held: T38) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via38(s: S38): T38 {
  const holder = {
    get held(): T38 {
      return s;
    },
  };
  return holder.held;
}

type S39 = string;
type T39 = { length: number; toString(): string; valueOf(): string };
function honest39(): T39 {
  return { length: 39, toString: () => "", valueOf: () => "" };
}
function use39(t: T39): number {
  return t.length + 1;
}
class Holder39 {
  before = 1;
  held: T39;
  constructor(held: T39) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
class Keeper39 {
  private stored: T39 = honest39();
  set held(t: T39) {
    this.stored = t;
  }
  get held(): T39 {
    return this.stored;
  }
}
function via39(s: S39): T39 {
  const keeper = new Keeper39();
  keeper.held = s;
  return keeper.held;
}

type S40 = string;
type T40 = { length: number; valueOf(): string; normalize(): string };
function honest40(): T40 {
  return { length: 40, valueOf: () => "", normalize: () => "" };
}
function use40(t: T40): number {
  return t.length + 1;
}
class Holder40 {
  before = 1;
  held: T40;
  constructor(held: T40) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via40(s: S40): T40 {
  const give = (): S40 => s;
  const wider: () => T40 = give;
  return wider();
}

type S41 = string;
type T41 = { length: number; normalize(): string; toWellFormed(): string };
function honest41(): T41 {
  return { length: 41, normalize: () => "", toWellFormed: () => "" };
}
function use41(t: T41): number {
  return t.length + 1;
}
class Holder41 {
  before = 1;
  held: T41;
  constructor(held: T41) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via41(s: S41): T41 {
  const kept: T41[] = [];
  const take = (t: T41): void => void kept.push(t);
  const narrower: (s: S41) => void = take;
  narrower(s);
  return kept[0];
}

type S42 = string;
type T42 = { length: number; toWellFormed(): string; big(): string };
function honest42(): T42 {
  return { length: 42, toWellFormed: () => "", big: () => "" };
}
function use42(t: T42): number {
  return t.length + 1;
}
class Holder42 {
  before = 1;
  held: T42;
  constructor(held: T42) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
interface Taker42 {
  take(s: S42): T42;
}
class Wide42 implements Taker42 {
  take(t: T42): T42 {
    return t;
  }
}
function via42(s: S42): T42 {
  const taker: Taker42 = new Wide42();
  return taker.take(s);
}

type S43 = string;
type T43 = { length: number; big(): string; blink(): string };
function honest43(): T43 {
  return { length: 43, big: () => "", blink: () => "" };
}
function use43(t: T43): number {
  return t.length + 1;
}
class Holder43 {
  before = 1;
  held: T43;
  constructor(held: T43) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via43(s: S43): T43 {
  const pair: [number, T43] = [1, s];
  return pair[1];
}

type S44 = string;
type T44 = { length: number; blink(): string; bold(): string };
function honest44(): T44 {
  return { length: 44, blink: () => "", bold: () => "" };
}
function use44(t: T44): number {
  return t.length + 1;
}
class Holder44 {
  before = 1;
  held: T44;
  constructor(held: T44) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function tag44(strings: TemplateStringsArray, t: T44): T44 {
  return t;
}
function via44(s: S44): T44 {
  return tag44`${s}`;
}

type S45 = string;
type T45 = { length: number; bold(): string; fixed(): string };
function honest45(): T45 {
  return { length: 45, bold: () => "", fixed: () => "" };
}
function use45(t: T45): number {
  return t.length + 1;
}
class Holder45 {
  before = 1;
  held: T45;
  constructor(held: T45) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
class Base45 {
  constructor(public held: T45) {}
}
class Derived45 extends Base45 {
  constructor(s: S45) {
    super(s);
  }
}
function via45(s: S45): T45 {
  return new Derived45(s).held;
}

type S46 = string;
type T46 = { length: number; fixed(): string; italics(): string };
function honest46(): T46 {
  return { length: 46, fixed: () => "", italics: () => "" };
}
function use46(t: T46): number {
  return t.length + 1;
}
class Holder46 {
  before = 1;
  held: T46;
  constructor(held: T46) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function via46(s: S46): T46 {
  const holder: { take?: (t: T46) => T46 } = { take: t => t };
  return holder.take?.(s) ?? honest46();
}

type S47 = string;
type T47 = { length: number; italics(): string; small(): string };
function honest47(): T47 {
  return { length: 47, italics: () => "", small: () => "" };
}
function use47(t: T47): number {
  return t.length + 1;
}
class Holder47 {
  before = 1;
  held: T47;
  constructor(held: T47) {
    this.held = held;
  }
  size(): number {
    return this.held.length + this.before;
  }
}
function take47(t: T47): T47 {
  return t;
}
function via47(s: S47): T47 {
  return take47.call(undefined, s);
}

let warm = 0;
for (let i = 0; i < 500; i++) warm += use36(honest36()) + new Holder36(honest36()).size();
{
  const t = await via36(text);
  attempt("??=: typeof", () => typeof t);
  attempt("??=: length + 1", () => use36(t));
  attempt("??=: in a field", () => new Holder36(t).size());
  attempt("??=: honest again", () => use36(honest36()));
}
for (let i = 0; i < 500; i++) warm += use37(honest37()) + new Holder37(honest37()).size();
{
  const t = await via37(text);
  attempt("||=: typeof", () => typeof t);
  attempt("||=: length + 1", () => use37(t));
  attempt("||=: in a field", () => new Holder37(t).size());
  attempt("||=: honest again", () => use37(honest37()));
}
for (let i = 0; i < 500; i++) warm += use38(honest38()) + new Holder38(honest38()).size();
{
  const t = await via38(text);
  attempt("the result of a getter: typeof", () => typeof t);
  attempt("the result of a getter: length + 1", () => use38(t));
  attempt("the result of a getter: in a field", () => new Holder38(t).size());
  attempt("the result of a getter: honest again", () => use38(honest38()));
}
for (let i = 0; i < 500; i++) warm += use39(honest39()) + new Holder39(honest39()).size();
{
  const t = await via39(text);
  attempt("the parameter of a setter: typeof", () => typeof t);
  attempt("the parameter of a setter: length + 1", () => use39(t));
  attempt("the parameter of a setter: in a field", () => new Holder39(t).size());
  attempt("the parameter of a setter: honest again", () => use39(honest39()));
}
for (let i = 0; i < 500; i++) warm += use40(honest40()) + new Holder40(honest40()).size();
{
  const t = await via40(text);
  attempt("the result of a function type: typeof", () => typeof t);
  attempt("the result of a function type: length + 1", () => use40(t));
  attempt("the result of a function type: in a field", () => new Holder40(t).size());
  attempt("the result of a function type: honest again", () => use40(honest40()));
}
for (let i = 0; i < 500; i++) warm += use41(honest41()) + new Holder41(honest41()).size();
{
  const t = await via41(text);
  attempt("the parameter of a function type: typeof", () => typeof t);
  attempt("the parameter of a function type: length + 1", () => use41(t));
  attempt("the parameter of a function type: in a field", () => new Holder41(t).size());
  attempt("the parameter of a function type: honest again", () => use41(honest41()));
}
for (let i = 0; i < 500; i++) warm += use42(honest42()) + new Holder42(honest42()).size();
{
  const t = await via42(text);
  attempt("a method that implements an interface: typeof", () => typeof t);
  attempt("a method that implements an interface: length + 1", () => use42(t));
  attempt("a method that implements an interface: in a field", () => new Holder42(t).size());
  attempt("a method that implements an interface: honest again", () => use42(honest42()));
}
for (let i = 0; i < 500; i++) warm += use43(honest43()) + new Holder43(honest43()).size();
{
  const t = await via43(text);
  attempt("a place of a tuple: typeof", () => typeof t);
  attempt("a place of a tuple: length + 1", () => use43(t));
  attempt("a place of a tuple: in a field", () => new Holder43(t).size());
  attempt("a place of a tuple: honest again", () => use43(honest43()));
}
for (let i = 0; i < 500; i++) warm += use44(honest44()) + new Holder44(honest44()).size();
{
  const t = await via44(text);
  attempt("a tagged template: typeof", () => typeof t);
  attempt("a tagged template: length + 1", () => use44(t));
  attempt("a tagged template: in a field", () => new Holder44(t).size());
  attempt("a tagged template: honest again", () => use44(honest44()));
}
for (let i = 0; i < 500; i++) warm += use45(honest45()) + new Holder45(honest45()).size();
{
  const t = await via45(text);
  attempt("an argument of super: typeof", () => typeof t);
  attempt("an argument of super: length + 1", () => use45(t));
  attempt("an argument of super: in a field", () => new Holder45(t).size());
  attempt("an argument of super: honest again", () => use45(honest45()));
}
for (let i = 0; i < 500; i++) warm += use46(honest46()) + new Holder46(honest46()).size();
{
  const t = await via46(text);
  attempt("an optional call: typeof", () => typeof t);
  attempt("an optional call: length + 1", () => use46(t));
  attempt("an optional call: in a field", () => new Holder46(t).size());
  attempt("an optional call: honest again", () => use46(honest46()));
}
for (let i = 0; i < 500; i++) warm += use47(honest47()) + new Holder47(honest47()).size();
{
  const t = await via47(text);
  attempt("call: typeof", () => typeof t);
  attempt("call: length + 1", () => use47(t));
  attempt("call: in a field", () => new Holder47(t).size());
  attempt("call: honest again", () => use47(honest47()));
}
console.log("honest uses", warm);

export {};
