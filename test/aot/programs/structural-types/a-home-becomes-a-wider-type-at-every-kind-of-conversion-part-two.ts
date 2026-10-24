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

class A12 {
  name = "a12";
}
class D12 extends A12 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C12 extends A12 {
  lives = "nine";
}
class S12 {
  street = "main";
  pet: D12 = new D12();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T12 = { pet: A12 };
function honest12(): T12 {
  return { pet: new A12() };
}
function adopt12(t: T12): void {
  t.pet = new C12();
}
function legs12(home: S12): number {
  return home.pet.legs + 1;
}
function via12(s: S12): T12 {
  const holder: { held: T12 } = { held: s };
  return holder.held;
}

class A13 {
  name = "a13";
}
class D13 extends A13 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C13 extends A13 {
  lives = "nine";
}
class S13 {
  street = "main";
  pet: D13 = new D13();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T13 = { pet: A13 };
function honest13(): T13 {
  return { pet: new A13() };
}
function adopt13(t: T13): void {
  t.pet = new C13();
}
function legs13(home: S13): number {
  return home.pet.legs + 1;
}
function via13(s: S13): T13 {
  const held = s;
  const holder: { held: T13 } = { held };
  return holder.held;
}

class A14 {
  name = "a14";
}
class D14 extends A14 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C14 extends A14 {
  lives = "nine";
}
class S14 {
  street = "main";
  pet: D14 = new D14();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T14 = { pet: A14 };
function honest14(): T14 {
  return { pet: new A14() };
}
function adopt14(t: T14): void {
  t.pet = new C14();
}
function legs14(home: S14): number {
  return home.pet.legs + 1;
}
function via14(s: S14): T14 {
  class Keeper {
    held: T14 = s;
  }
  return new Keeper().held;
}

class A15 {
  name = "a15";
}
class D15 extends A15 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C15 extends A15 {
  lives = "nine";
}
class S15 {
  street = "main";
  pet: D15 = new D15();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T15 = { pet: A15 };
function honest15(): T15 {
  return { pet: new A15() };
}
function adopt15(t: T15): void {
  t.pet = new C15();
}
function legs15(home: S15): number {
  return home.pet.legs + 1;
}
class Keeper15 {
  constructor(public held: T15) {}
}
function via15(s: S15): T15 {
  return new Keeper15(s).held;
}

class A16 {
  name = "a16";
}
class D16 extends A16 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C16 extends A16 {
  lives = "nine";
}
class S16 {
  street = "main";
  pet: D16 = new D16();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T16 = { pet: A16 };
function honest16(): T16 {
  return { pet: new A16() };
}
function adopt16(t: T16): void {
  t.pet = new C16();
}
function legs16(home: S16): number {
  return home.pet.legs + 1;
}
function via16(s: S16): T16 {
  const take = (t: T16 = s): T16 => t;
  return take();
}

class A17 {
  name = "a17";
}
class D17 extends A17 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C17 extends A17 {
  lives = "nine";
}
class S17 {
  street = "main";
  pet: D17 = new D17();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T17 = { pet: A17 };
function honest17(): T17 {
  return { pet: new A17() };
}
function adopt17(t: T17): void {
  t.pet = new C17();
}
function legs17(home: S17): number {
  return home.pet.legs + 1;
}
function via17(s: S17): T17 {
  const { held = s }: { held?: T17 } = {};
  return held;
}

class A18 {
  name = "a18";
}
class D18 extends A18 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C18 extends A18 {
  lives = "nine";
}
class S18 {
  street = "main";
  pet: D18 = new D18();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T18 = { pet: A18 };
function honest18(): T18 {
  return { pet: new A18() };
}
function adopt18(t: T18): void {
  t.pet = new C18();
}
function legs18(home: S18): number {
  return home.pet.legs + 1;
}
function take18(t: T18): T18 {
  return t;
}
function via18(s: S18): T18 {
  const list: [S18] = [s];
  return take18(...list);
}

class A19 {
  name = "a19";
}
class D19 extends A19 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C19 extends A19 {
  lives = "nine";
}
class S19 {
  street = "main";
  pet: D19 = new D19();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T19 = { pet: A19 };
function honest19(): T19 {
  return { pet: new A19() };
}
function adopt19(t: T19): void {
  t.pet = new C19();
}
function legs19(home: S19): number {
  return home.pet.legs + 1;
}
function last19(...list: T19[]): T19 {
  return list[list.length - 1];
}
function via19(s: S19): T19 {
  return last19(honest19(), s);
}

class A20 {
  name = "a20";
}
class D20 extends A20 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C20 extends A20 {
  lives = "nine";
}
class S20 {
  street = "main";
  pet: D20 = new D20();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T20 = { pet: A20 };
function honest20(): T20 {
  return { pet: new A20() };
}
function adopt20(t: T20): void {
  t.pet = new C20();
}
function legs20(home: S20): number {
  return home.pet.legs + 1;
}
function via20(s: S20): T20 {
  const sources: S20[] = [s];
  const list: T20[] = [...sources];
  return list[0];
}

class A21 {
  name = "a21";
}
class D21 extends A21 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C21 extends A21 {
  lives = "nine";
}
class S21 {
  street = "main";
  pet: D21 = new D21();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T21 = { pet: A21 };
function honest21(): T21 {
  return { pet: new A21() };
}
function adopt21(t: T21): void {
  t.pet = new C21();
}
function legs21(home: S21): number {
  return home.pet.legs + 1;
}
function via21(s: S21): T21 {
  const source = { held: s };
  const holder: { held: T21 } = { ...source };
  return holder.held;
}

class A22 {
  name = "a22";
}
class D22 extends A22 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C22 extends A22 {
  lives = "nine";
}
class S22 {
  street = "main";
  pet: D22 = new D22();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T22 = { pet: A22 };
function honest22(): T22 {
  return { pet: new A22() };
}
function adopt22(t: T22): void {
  t.pet = new C22();
}
function legs22(home: S22): number {
  return home.pet.legs + 1;
}
function via22(s: S22): T22 {
  const list: T22[] = [];
  list.push(s);
  return list[0];
}

class A23 {
  name = "a23";
}
class D23 extends A23 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C23 extends A23 {
  lives = "nine";
}
class S23 {
  street = "main";
  pet: D23 = new D23();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T23 = { pet: A23 };
function honest23(): T23 {
  return { pet: new A23() };
}
function adopt23(t: T23): void {
  t.pet = new C23();
}
function legs23(home: S23): number {
  return home.pet.legs + 1;
}
function via23(s: S23): T23 {
  const map = new Map<string, T23>();
  map.set("k", s);
  return map.get("k") ?? honest23();
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  const home = new S12();
  adopt12(honest12());
  warm += legs12(home) + home.legs();
}
{
  const home = new S12();
  const t = await via12(home);
  attempt("a member of an object literal: the same object", () => t === home);
  adopt12(t);
  attempt("a member of an object literal: legs + 1", () => legs12(home));
  attempt("a member of an object literal: its own method", () => home.legs());
  attempt("a member of an object literal: bark", () => home.pet.bark());
  attempt("a member of an object literal: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S13();
  adopt13(honest13());
  warm += legs13(home) + home.legs();
}
{
  const home = new S13();
  const t = await via13(home);
  attempt("a shorthand member: the same object", () => t === home);
  adopt13(t);
  attempt("a shorthand member: legs + 1", () => legs13(home));
  attempt("a shorthand member: its own method", () => home.legs());
  attempt("a shorthand member: bark", () => home.pet.bark());
  attempt("a shorthand member: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S14();
  adopt14(honest14());
  warm += legs14(home) + home.legs();
}
{
  const home = new S14();
  const t = await via14(home);
  attempt("the initializer of a field: the same object", () => t === home);
  adopt14(t);
  attempt("the initializer of a field: legs + 1", () => legs14(home));
  attempt("the initializer of a field: its own method", () => home.legs());
  attempt("the initializer of a field: bark", () => home.pet.bark());
  attempt("the initializer of a field: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S15();
  adopt15(honest15());
  warm += legs15(home) + home.legs();
}
{
  const home = new S15();
  const t = await via15(home);
  attempt("a parameter property: the same object", () => t === home);
  adopt15(t);
  attempt("a parameter property: legs + 1", () => legs15(home));
  attempt("a parameter property: its own method", () => home.legs());
  attempt("a parameter property: bark", () => home.pet.bark());
  attempt("a parameter property: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S16();
  adopt16(honest16());
  warm += legs16(home) + home.legs();
}
{
  const home = new S16();
  const t = await via16(home);
  attempt("the default of a parameter: the same object", () => t === home);
  adopt16(t);
  attempt("the default of a parameter: legs + 1", () => legs16(home));
  attempt("the default of a parameter: its own method", () => home.legs());
  attempt("the default of a parameter: bark", () => home.pet.bark());
  attempt("the default of a parameter: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S17();
  adopt17(honest17());
  warm += legs17(home) + home.legs();
}
{
  const home = new S17();
  const t = await via17(home);
  attempt("the default in a pattern: the same object", () => t === home);
  adopt17(t);
  attempt("the default in a pattern: legs + 1", () => legs17(home));
  attempt("the default in a pattern: its own method", () => home.legs());
  attempt("the default in a pattern: bark", () => home.pet.bark());
  attempt("the default in a pattern: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S18();
  adopt18(honest18());
  warm += legs18(home) + home.legs();
}
{
  const home = new S18();
  const t = await via18(home);
  attempt("a spread argument: the same object", () => t === home);
  adopt18(t);
  attempt("a spread argument: legs + 1", () => legs18(home));
  attempt("a spread argument: its own method", () => home.legs());
  attempt("a spread argument: bark", () => home.pet.bark());
  attempt("a spread argument: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S19();
  adopt19(honest19());
  warm += legs19(home) + home.legs();
}
{
  const home = new S19();
  const t = await via19(home);
  attempt("a rest parameter: the same object", () => t === home);
  adopt19(t);
  attempt("a rest parameter: legs + 1", () => legs19(home));
  attempt("a rest parameter: its own method", () => home.legs());
  attempt("a rest parameter: bark", () => home.pet.bark());
  attempt("a rest parameter: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S20();
  adopt20(honest20());
  warm += legs20(home) + home.legs();
}
{
  const home = new S20();
  const t = await via20(home);
  attempt("a spread into an array literal: the same object", () => t === home);
  adopt20(t);
  attempt("a spread into an array literal: legs + 1", () => legs20(home));
  attempt("a spread into an array literal: its own method", () => home.legs());
  attempt("a spread into an array literal: bark", () => home.pet.bark());
  attempt("a spread into an array literal: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S21();
  adopt21(honest21());
  warm += legs21(home) + home.legs();
}
{
  const home = new S21();
  const t = await via21(home);
  attempt("a spread into an object literal: the same object", () => t === home);
  adopt21(t);
  attempt("a spread into an object literal: legs + 1", () => legs21(home));
  attempt("a spread into an object literal: its own method", () => home.legs());
  attempt("a spread into an object literal: bark", () => home.pet.bark());
  attempt("a spread into an object literal: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S22();
  adopt22(honest22());
  warm += legs22(home) + home.legs();
}
{
  const home = new S22();
  const t = await via22(home);
  attempt("push: the same object", () => t === home);
  adopt22(t);
  attempt("push: legs + 1", () => legs22(home));
  attempt("push: its own method", () => home.legs());
  attempt("push: bark", () => home.pet.bark());
  attempt("push: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S23();
  adopt23(honest23());
  warm += legs23(home) + home.legs();
}
{
  const home = new S23();
  const t = await via23(home);
  attempt("the value of a map entry: the same object", () => t === home);
  adopt23(t);
  attempt("the value of a map entry: legs + 1", () => legs23(home));
  attempt("the value of a map entry: its own method", () => home.legs());
  attempt("the value of a map entry: bark", () => home.pet.bark());
  attempt("the value of a map entry: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
console.log("honest uses", warm);

export {};
