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

class A48 {
  name = "a48";
}
class D48 extends A48 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C48 extends A48 {
  lives = "nine";
}
class S48 {
  street = "main";
  pet: D48 = new D48();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T48 = { pet: A48 };
function honest48(): T48 {
  return { pet: new A48() };
}
function adopt48(t: T48): void {
  t.pet = new C48();
}
function legs48(home: S48): number {
  return home.pet.legs + 1;
}
function take48(t: T48): T48 {
  return t;
}
function via48(s: S48): T48 {
  return take48.apply(undefined, [s]);
}

class A49 {
  name = "a49";
}
class D49 extends A49 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C49 extends A49 {
  lives = "nine";
}
class S49 {
  street = "main";
  pet: D49 = new D49();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T49 = { pet: A49 };
function honest49(): T49 {
  return { pet: new A49() };
}
function adopt49(t: T49): void {
  t.pet = new C49();
}
function legs49(home: S49): number {
  return home.pet.legs + 1;
}
function take49(t: T49): T49 {
  return t;
}
function via49(s: S49): T49 {
  return take49.bind(undefined, s)();
}

class A50 {
  name = "a50";
}
class D50 extends A50 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C50 extends A50 {
  lives = "nine";
}
class S50 {
  street = "main";
  pet: D50 = new D50();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T50 = { pet: A50 };
function honest50(): T50 {
  return { pet: new A50() };
}
function adopt50(t: T50): void {
  t.pet = new C50();
}
function legs50(home: S50): number {
  return home.pet.legs + 1;
}
function take50(t: T50): T50 {
  return t;
}
function via50(s: S50): T50 {
  return Reflect.apply(take50, undefined, [s]);
}

class A51 {
  name = "a51";
}
class D51 extends A51 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C51 extends A51 {
  lives = "nine";
}
class S51 {
  street = "main";
  pet: D51 = new D51();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T51 = { pet: A51 };
function honest51(): T51 {
  return { pet: new A51() };
}
function adopt51(t: T51): void {
  t.pet = new C51();
}
function legs51(home: S51): number {
  return home.pet.legs + 1;
}
function self51(this: T51): T51 {
  return this;
}
function via51(s: S51): T51 {
  return self51.call(s);
}

class A52 {
  name = "a52";
}
class D52 extends A52 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C52 extends A52 {
  lives = "nine";
}
class S52 {
  street = "main";
  pet: D52 = new D52();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T52 = { pet: A52 };
function honest52(): T52 {
  return { pet: new A52() };
}
function adopt52(t: T52): void {
  t.pet = new C52();
}
function legs52(home: S52): number {
  return home.pet.legs + 1;
}
function via52(s: S52): T52 {
  const holder: { held: T52 } = { held: honest52() };
  holder.held = s;
  return holder.held;
}

class A53 {
  name = "a53";
}
class D53 extends A53 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C53 extends A53 {
  lives = "nine";
}
class S53 {
  street = "main";
  pet: D53 = new D53();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T53 = { pet: A53 };
function honest53(): T53 {
  return { pet: new A53() };
}
function adopt53(t: T53): void {
  t.pet = new C53();
}
function legs53(home: S53): number {
  return home.pet.legs + 1;
}
function via53(s: S53): T53 {
  const list: T53[] = [honest53()];
  list[0] = s;
  return list[0];
}

class A54 {
  name = "a54";
}
class D54 extends A54 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C54 extends A54 {
  lives = "nine";
}
class S54 {
  street = "main";
  pet: D54 = new D54();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T54 = { pet: A54 };
function honest54(): T54 {
  return { pet: new A54() };
}
function adopt54(t: T54): void {
  t.pet = new C54();
}
function legs54(home: S54): number {
  return home.pet.legs + 1;
}
function via54(s: S54): T54 {
  const holder: { held: T54 } = { held: honest54() };
  [holder.held] = [s];
  return holder.held;
}

class A55 {
  name = "a55";
}
class D55 extends A55 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C55 extends A55 {
  lives = "nine";
}
class S55 {
  street = "main";
  pet: D55 = new D55();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T55 = { pet: A55 };
function honest55(): T55 {
  return { pet: new A55() };
}
function adopt55(t: T55): void {
  t.pet = new C55();
}
function legs55(home: S55): number {
  return home.pet.legs + 1;
}
function via55(s: S55): T55 {
  const holder: { held: T55 } = { held: honest55() };
  ({ from: holder.held } = { from: s });
  return holder.held;
}

class A56 {
  name = "a56";
}
class D56 extends A56 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C56 extends A56 {
  lives = "nine";
}
class S56 {
  street = "main";
  pet: D56 = new D56();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T56 = { pet: A56 };
function honest56(): T56 {
  return { pet: new A56() };
}
function adopt56(t: T56): void {
  t.pet = new C56();
}
function legs56(home: S56): number {
  return home.pet.legs + 1;
}
function via56(s: S56): T56 {
  const holder: { held: T56 } = { held: honest56() };
  Object.assign(holder, { held: s });
  return holder.held;
}

class A57 {
  name = "a57";
}
class D57 extends A57 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C57 extends A57 {
  lives = "nine";
}
class S57 {
  street = "main";
  pet: D57 = new D57();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T57 = { pet: A57 };
function honest57(): T57 {
  return { pet: new A57() };
}
function adopt57(t: T57): void {
  t.pet = new C57();
}
function legs57(home: S57): number {
  return home.pet.legs + 1;
}
function via57(s: S57): T57 {
  const either: T57 | number = s;
  return typeof either === "number" ? honest57() : either;
}

class A58 {
  name = "a58";
}
class D58 extends A58 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C58 extends A58 {
  lives = "nine";
}
class S58 {
  street = "main";
  pet: D58 = new D58();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T58 = { pet: A58 };
function honest58(): T58 {
  return { pet: new A58() };
}
function adopt58(t: T58): void {
  t.pet = new C58();
}
function legs58(home: S58): number {
  return home.pet.legs + 1;
}
function via58(s: S58): T58 {
  const record: Record<string, T58> = { k: s };
  return record.k;
}

class A59 {
  name = "a59";
}
class D59 extends A59 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C59 extends A59 {
  lives = "nine";
}
class S59 {
  street = "main";
  pet: D59 = new D59();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T59 = { pet: A59 };
function honest59(): T59 {
  return { pet: new A59() };
}
function adopt59(t: T59): void {
  t.pet = new C59();
}
function legs59(home: S59): number {
  return home.pet.legs + 1;
}
function via59(s: S59): T59 {
  const sources: S59[] = [s];
  const list: T59[] = sources;
  return list[0];
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  const home = new S48();
  adopt48(honest48());
  warm += legs48(home) + home.legs();
}
{
  const home = new S48();
  const t = await via48(home);
  attempt("apply: the same object", () => t === home);
  adopt48(t);
  attempt("apply: legs + 1", () => legs48(home));
  attempt("apply: its own method", () => home.legs());
  attempt("apply: bark", () => home.pet.bark());
  attempt("apply: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S49();
  adopt49(honest49());
  warm += legs49(home) + home.legs();
}
{
  const home = new S49();
  const t = await via49(home);
  attempt("bind: the same object", () => t === home);
  adopt49(t);
  attempt("bind: legs + 1", () => legs49(home));
  attempt("bind: its own method", () => home.legs());
  attempt("bind: bark", () => home.pet.bark());
  attempt("bind: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S50();
  adopt50(honest50());
  warm += legs50(home) + home.legs();
}
{
  const home = new S50();
  const t = await via50(home);
  attempt("Reflect.apply: the same object", () => t === home);
  adopt50(t);
  attempt("Reflect.apply: legs + 1", () => legs50(home));
  attempt("Reflect.apply: its own method", () => home.legs());
  attempt("Reflect.apply: bark", () => home.pet.bark());
  attempt("Reflect.apply: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S51();
  adopt51(honest51());
  warm += legs51(home) + home.legs();
}
{
  const home = new S51();
  const t = await via51(home);
  attempt("this of a call: the same object", () => t === home);
  adopt51(t);
  attempt("this of a call: legs + 1", () => legs51(home));
  attempt("this of a call: its own method", () => home.legs());
  attempt("this of a call: bark", () => home.pet.bark());
  attempt("this of a call: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S52();
  adopt52(honest52());
  warm += legs52(home) + home.legs();
}
{
  const home = new S52();
  const t = await via52(home);
  attempt("a store to a member: the same object", () => t === home);
  adopt52(t);
  attempt("a store to a member: legs + 1", () => legs52(home));
  attempt("a store to a member: its own method", () => home.legs());
  attempt("a store to a member: bark", () => home.pet.bark());
  attempt("a store to a member: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S53();
  adopt53(honest53());
  warm += legs53(home) + home.legs();
}
{
  const home = new S53();
  const t = await via53(home);
  attempt("a store to an element: the same object", () => t === home);
  adopt53(t);
  attempt("a store to an element: legs + 1", () => legs53(home));
  attempt("a store to an element: its own method", () => home.legs());
  attempt("a store to an element: bark", () => home.pet.bark());
  attempt("a store to an element: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S54();
  adopt54(honest54());
  warm += legs54(home) + home.legs();
}
{
  const home = new S54();
  const t = await via54(home);
  attempt("an array pattern that is assigned to: the same object", () => t === home);
  adopt54(t);
  attempt("an array pattern that is assigned to: legs + 1", () => legs54(home));
  attempt("an array pattern that is assigned to: its own method", () => home.legs());
  attempt("an array pattern that is assigned to: bark", () => home.pet.bark());
  attempt("an array pattern that is assigned to: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S55();
  adopt55(honest55());
  warm += legs55(home) + home.legs();
}
{
  const home = new S55();
  const t = await via55(home);
  attempt("an object pattern that is assigned to: the same object", () => t === home);
  adopt55(t);
  attempt("an object pattern that is assigned to: legs + 1", () => legs55(home));
  attempt("an object pattern that is assigned to: its own method", () => home.legs());
  attempt("an object pattern that is assigned to: bark", () => home.pet.bark());
  attempt("an object pattern that is assigned to: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S56();
  adopt56(honest56());
  warm += legs56(home) + home.legs();
}
{
  const home = new S56();
  const t = await via56(home);
  attempt("Object.assign: the same object", () => t === home);
  adopt56(t);
  attempt("Object.assign: legs + 1", () => legs56(home));
  attempt("Object.assign: its own method", () => home.legs());
  attempt("Object.assign: bark", () => home.pet.bark());
  attempt("Object.assign: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S57();
  adopt57(honest57());
  warm += legs57(home) + home.legs();
}
{
  const home = new S57();
  const t = await via57(home);
  attempt("a union that is narrowed again: the same object", () => t === home);
  adopt57(t);
  attempt("a union that is narrowed again: legs + 1", () => legs57(home));
  attempt("a union that is narrowed again: its own method", () => home.legs());
  attempt("a union that is narrowed again: bark", () => home.pet.bark());
  attempt("a union that is narrowed again: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S58();
  adopt58(honest58());
  warm += legs58(home) + home.legs();
}
{
  const home = new S58();
  const t = await via58(home);
  attempt("an entry of a record: the same object", () => t === home);
  adopt58(t);
  attempt("an entry of a record: legs + 1", () => legs58(home));
  attempt("an entry of a record: its own method", () => home.legs());
  attempt("an entry of a record: bark", () => home.pet.bark());
  attempt("an entry of a record: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S59();
  adopt59(honest59());
  warm += legs59(home) + home.legs();
}
{
  const home = new S59();
  const t = await via59(home);
  attempt("an array of the narrower type: the same object", () => t === home);
  adopt59(t);
  attempt("an array of the narrower type: legs + 1", () => legs59(home));
  attempt("an array of the narrower type: its own method", () => home.legs());
  attempt("an array of the narrower type: bark", () => home.pet.bark());
  attempt("an array of the narrower type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
console.log("honest uses", warm);

export {};
