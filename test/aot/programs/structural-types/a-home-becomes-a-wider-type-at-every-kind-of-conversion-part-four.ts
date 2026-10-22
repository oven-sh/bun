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

class A36 {
  name = "a36";
}
class D36 extends A36 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C36 extends A36 {
  lives = "nine";
}
class S36 {
  street = "main";
  pet: D36 = new D36();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T36 = { pet: A36 };
function honest36(): T36 {
  return { pet: new A36() };
}
function adopt36(t: T36): void {
  t.pet = new C36();
}
function legs36(home: S36): number {
  return home.pet.legs + 1;
}
function via36(s: S36): T36 {
  let t: T36 | undefined;
  t ??= s;
  return t;
}

class A37 {
  name = "a37";
}
class D37 extends A37 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C37 extends A37 {
  lives = "nine";
}
class S37 {
  street = "main";
  pet: D37 = new D37();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T37 = { pet: A37 };
function honest37(): T37 {
  return { pet: new A37() };
}
function adopt37(t: T37): void {
  t.pet = new C37();
}
function legs37(home: S37): number {
  return home.pet.legs + 1;
}
function via37(s: S37): T37 {
  let t: T37 | undefined;
  t ||= s;
  return t;
}

class A38 {
  name = "a38";
}
class D38 extends A38 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C38 extends A38 {
  lives = "nine";
}
class S38 {
  street = "main";
  pet: D38 = new D38();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T38 = { pet: A38 };
function honest38(): T38 {
  return { pet: new A38() };
}
function adopt38(t: T38): void {
  t.pet = new C38();
}
function legs38(home: S38): number {
  return home.pet.legs + 1;
}
function via38(s: S38): T38 {
  const holder = {
    get held(): T38 {
      return s;
    },
  };
  return holder.held;
}

class A39 {
  name = "a39";
}
class D39 extends A39 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C39 extends A39 {
  lives = "nine";
}
class S39 {
  street = "main";
  pet: D39 = new D39();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T39 = { pet: A39 };
function honest39(): T39 {
  return { pet: new A39() };
}
function adopt39(t: T39): void {
  t.pet = new C39();
}
function legs39(home: S39): number {
  return home.pet.legs + 1;
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

class A40 {
  name = "a40";
}
class D40 extends A40 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C40 extends A40 {
  lives = "nine";
}
class S40 {
  street = "main";
  pet: D40 = new D40();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T40 = { pet: A40 };
function honest40(): T40 {
  return { pet: new A40() };
}
function adopt40(t: T40): void {
  t.pet = new C40();
}
function legs40(home: S40): number {
  return home.pet.legs + 1;
}
function via40(s: S40): T40 {
  const give = (): S40 => s;
  const wider: () => T40 = give;
  return wider();
}

class A41 {
  name = "a41";
}
class D41 extends A41 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C41 extends A41 {
  lives = "nine";
}
class S41 {
  street = "main";
  pet: D41 = new D41();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T41 = { pet: A41 };
function honest41(): T41 {
  return { pet: new A41() };
}
function adopt41(t: T41): void {
  t.pet = new C41();
}
function legs41(home: S41): number {
  return home.pet.legs + 1;
}
function via41(s: S41): T41 {
  const kept: T41[] = [];
  const take = (t: T41): void => void kept.push(t);
  const narrower: (s: S41) => void = take;
  narrower(s);
  return kept[0];
}

class A42 {
  name = "a42";
}
class D42 extends A42 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C42 extends A42 {
  lives = "nine";
}
class S42 {
  street = "main";
  pet: D42 = new D42();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T42 = { pet: A42 };
function honest42(): T42 {
  return { pet: new A42() };
}
function adopt42(t: T42): void {
  t.pet = new C42();
}
function legs42(home: S42): number {
  return home.pet.legs + 1;
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

class A43 {
  name = "a43";
}
class D43 extends A43 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C43 extends A43 {
  lives = "nine";
}
class S43 {
  street = "main";
  pet: D43 = new D43();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T43 = { pet: A43 };
function honest43(): T43 {
  return { pet: new A43() };
}
function adopt43(t: T43): void {
  t.pet = new C43();
}
function legs43(home: S43): number {
  return home.pet.legs + 1;
}
function via43(s: S43): T43 {
  const pair: [number, T43] = [1, s];
  return pair[1];
}

class A44 {
  name = "a44";
}
class D44 extends A44 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C44 extends A44 {
  lives = "nine";
}
class S44 {
  street = "main";
  pet: D44 = new D44();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T44 = { pet: A44 };
function honest44(): T44 {
  return { pet: new A44() };
}
function adopt44(t: T44): void {
  t.pet = new C44();
}
function legs44(home: S44): number {
  return home.pet.legs + 1;
}
function tag44(strings: TemplateStringsArray, t: T44): T44 {
  return t;
}
function via44(s: S44): T44 {
  return tag44`${s}`;
}

class A45 {
  name = "a45";
}
class D45 extends A45 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C45 extends A45 {
  lives = "nine";
}
class S45 {
  street = "main";
  pet: D45 = new D45();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T45 = { pet: A45 };
function honest45(): T45 {
  return { pet: new A45() };
}
function adopt45(t: T45): void {
  t.pet = new C45();
}
function legs45(home: S45): number {
  return home.pet.legs + 1;
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

class A46 {
  name = "a46";
}
class D46 extends A46 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C46 extends A46 {
  lives = "nine";
}
class S46 {
  street = "main";
  pet: D46 = new D46();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T46 = { pet: A46 };
function honest46(): T46 {
  return { pet: new A46() };
}
function adopt46(t: T46): void {
  t.pet = new C46();
}
function legs46(home: S46): number {
  return home.pet.legs + 1;
}
function via46(s: S46): T46 {
  const holder: { take?: (t: T46) => T46 } = { take: t => t };
  return holder.take?.(s) ?? honest46();
}

class A47 {
  name = "a47";
}
class D47 extends A47 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C47 extends A47 {
  lives = "nine";
}
class S47 {
  street = "main";
  pet: D47 = new D47();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T47 = { pet: A47 };
function honest47(): T47 {
  return { pet: new A47() };
}
function adopt47(t: T47): void {
  t.pet = new C47();
}
function legs47(home: S47): number {
  return home.pet.legs + 1;
}
function take47(t: T47): T47 {
  return t;
}
function via47(s: S47): T47 {
  return take47.call(undefined, s);
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  const home = new S36();
  adopt36(honest36());
  warm += legs36(home) + home.legs();
}
{
  const home = new S36();
  const t = await via36(home);
  attempt("??=: the same object", () => t === home);
  adopt36(t);
  attempt("??=: legs + 1", () => legs36(home));
  attempt("??=: its own method", () => home.legs());
  attempt("??=: bark", () => home.pet.bark());
  attempt("??=: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S37();
  adopt37(honest37());
  warm += legs37(home) + home.legs();
}
{
  const home = new S37();
  const t = await via37(home);
  attempt("||=: the same object", () => t === home);
  adopt37(t);
  attempt("||=: legs + 1", () => legs37(home));
  attempt("||=: its own method", () => home.legs());
  attempt("||=: bark", () => home.pet.bark());
  attempt("||=: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S38();
  adopt38(honest38());
  warm += legs38(home) + home.legs();
}
{
  const home = new S38();
  const t = await via38(home);
  attempt("the result of a getter: the same object", () => t === home);
  adopt38(t);
  attempt("the result of a getter: legs + 1", () => legs38(home));
  attempt("the result of a getter: its own method", () => home.legs());
  attempt("the result of a getter: bark", () => home.pet.bark());
  attempt("the result of a getter: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S39();
  adopt39(honest39());
  warm += legs39(home) + home.legs();
}
{
  const home = new S39();
  const t = await via39(home);
  attempt("the parameter of a setter: the same object", () => t === home);
  adopt39(t);
  attempt("the parameter of a setter: legs + 1", () => legs39(home));
  attempt("the parameter of a setter: its own method", () => home.legs());
  attempt("the parameter of a setter: bark", () => home.pet.bark());
  attempt("the parameter of a setter: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S40();
  adopt40(honest40());
  warm += legs40(home) + home.legs();
}
{
  const home = new S40();
  const t = await via40(home);
  attempt("the result of a function type: the same object", () => t === home);
  adopt40(t);
  attempt("the result of a function type: legs + 1", () => legs40(home));
  attempt("the result of a function type: its own method", () => home.legs());
  attempt("the result of a function type: bark", () => home.pet.bark());
  attempt("the result of a function type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S41();
  adopt41(honest41());
  warm += legs41(home) + home.legs();
}
{
  const home = new S41();
  const t = await via41(home);
  attempt("the parameter of a function type: the same object", () => t === home);
  adopt41(t);
  attempt("the parameter of a function type: legs + 1", () => legs41(home));
  attempt("the parameter of a function type: its own method", () => home.legs());
  attempt("the parameter of a function type: bark", () => home.pet.bark());
  attempt("the parameter of a function type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S42();
  adopt42(honest42());
  warm += legs42(home) + home.legs();
}
{
  const home = new S42();
  const t = await via42(home);
  attempt("a method that implements an interface: the same object", () => t === home);
  adopt42(t);
  attempt("a method that implements an interface: legs + 1", () => legs42(home));
  attempt("a method that implements an interface: its own method", () => home.legs());
  attempt("a method that implements an interface: bark", () => home.pet.bark());
  attempt("a method that implements an interface: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S43();
  adopt43(honest43());
  warm += legs43(home) + home.legs();
}
{
  const home = new S43();
  const t = await via43(home);
  attempt("a place of a tuple: the same object", () => t === home);
  adopt43(t);
  attempt("a place of a tuple: legs + 1", () => legs43(home));
  attempt("a place of a tuple: its own method", () => home.legs());
  attempt("a place of a tuple: bark", () => home.pet.bark());
  attempt("a place of a tuple: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S44();
  adopt44(honest44());
  warm += legs44(home) + home.legs();
}
{
  const home = new S44();
  const t = await via44(home);
  attempt("a tagged template: the same object", () => t === home);
  adopt44(t);
  attempt("a tagged template: legs + 1", () => legs44(home));
  attempt("a tagged template: its own method", () => home.legs());
  attempt("a tagged template: bark", () => home.pet.bark());
  attempt("a tagged template: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S45();
  adopt45(honest45());
  warm += legs45(home) + home.legs();
}
{
  const home = new S45();
  const t = await via45(home);
  attempt("an argument of super: the same object", () => t === home);
  adopt45(t);
  attempt("an argument of super: legs + 1", () => legs45(home));
  attempt("an argument of super: its own method", () => home.legs());
  attempt("an argument of super: bark", () => home.pet.bark());
  attempt("an argument of super: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S46();
  adopt46(honest46());
  warm += legs46(home) + home.legs();
}
{
  const home = new S46();
  const t = await via46(home);
  attempt("an optional call: the same object", () => t === home);
  adopt46(t);
  attempt("an optional call: legs + 1", () => legs46(home));
  attempt("an optional call: its own method", () => home.legs());
  attempt("an optional call: bark", () => home.pet.bark());
  attempt("an optional call: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S47();
  adopt47(honest47());
  warm += legs47(home) + home.legs();
}
{
  const home = new S47();
  const t = await via47(home);
  attempt("call: the same object", () => t === home);
  adopt47(t);
  attempt("call: legs + 1", () => legs47(home));
  attempt("call: its own method", () => home.legs());
  attempt("call: bark", () => home.pet.bark());
  attempt("call: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
console.log("honest uses", warm);

export {};
