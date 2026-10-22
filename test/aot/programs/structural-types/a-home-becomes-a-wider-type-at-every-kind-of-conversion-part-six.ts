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

class A60 {
  name = "a60";
}
class D60 extends A60 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C60 extends A60 {
  lives = "nine";
}
class S60 {
  street = "main";
  pet: D60 = new D60();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T60 = { pet: A60 };
function honest60(): T60 {
  return { pet: new A60() };
}
function adopt60(t: T60): void {
  t.pet = new C60();
}
function legs60(home: S60): number {
  return home.pet.legs + 1;
}
function via60(s: S60): T60 {
  const source: { held: S60 } = { held: s };
  const holder: { held: T60 } = source;
  return holder.held;
}

class A61 {
  name = "a61";
}
class D61 extends A61 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C61 extends A61 {
  lives = "nine";
}
class S61 {
  street = "main";
  pet: D61 = new D61();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T61 = { pet: A61 };
function honest61(): T61 {
  return { pet: new A61() };
}
function adopt61(t: T61): void {
  t.pet = new C61();
}
function legs61(home: S61): number {
  return home.pet.legs + 1;
}
function via61(s: S61): T61 {
  const sources = new Map<string, S61>([["k", s]]);
  const map: Map<string, T61> = sources;
  return map.get("k") ?? honest61();
}

class A62 {
  name = "a62";
}
class D62 extends A62 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C62 extends A62 {
  lives = "nine";
}
class S62 {
  street = "main";
  pet: D62 = new D62();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T62 = { pet: A62 };
function honest62(): T62 {
  return { pet: new A62() };
}
function adopt62(t: T62): void {
  t.pet = new C62();
}
function legs62(home: S62): number {
  return home.pet.legs + 1;
}
class Source62 {
  constructor(public held: S62) {}
}
function via62(s: S62): T62 {
  const holder: { held: T62 } = new Source62(s);
  return holder.held;
}

class A63 {
  name = "a63";
}
class D63 extends A63 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C63 extends A63 {
  lives = "nine";
}
class S63 {
  street = "main";
  pet: D63 = new D63();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T63 = { pet: A63 };
function honest63(): T63 {
  return { pet: new A63() };
}
function adopt63(t: T63): void {
  t.pet = new C63();
}
function legs63(home: S63): number {
  return home.pet.legs + 1;
}
function via63(s: S63): T63 {
  class Keeper {
    static held: T63 = s;
  }
  return Keeper.held;
}

class A64 {
  name = "a64";
}
class D64 extends A64 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C64 extends A64 {
  lives = "nine";
}
class S64 {
  street = "main";
  pet: D64 = new D64();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T64 = { pet: A64 };
function honest64(): T64 {
  return { pet: new A64() };
}
function adopt64(t: T64): void {
  t.pet = new C64();
}
function legs64(home: S64): number {
  return home.pet.legs + 1;
}
class Box64<X> {
  constructor(public held: X) {}
}
function via64(s: S64): T64 {
  return new Box64<T64>(s).held;
}

class A65 {
  name = "a65";
}
class D65 extends A65 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C65 extends A65 {
  lives = "nine";
}
class S65 {
  street = "main";
  pet: D65 = new D65();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T65 = { pet: A65 };
function honest65(): T65 {
  return { pet: new A65() };
}
function adopt65(t: T65): void {
  t.pet = new C65();
}
function legs65(home: S65): number {
  return home.pet.legs + 1;
}
function via65(s: S65): T65 {
  return Array.of<T65>(s)[0];
}

class A66 {
  name = "a66";
}
class D66 extends A66 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C66 extends A66 {
  lives = "nine";
}
class S66 {
  street = "main";
  pet: D66 = new D66();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T66 = { pet: A66 };
function honest66(): T66 {
  return { pet: new A66() };
}
function adopt66(t: T66): void {
  t.pet = new C66();
}
function legs66(home: S66): number {
  return home.pet.legs + 1;
}
function via66(s: S66): T66 {
  const sources: S66[] = [s];
  return Array.from<T66>(sources)[0];
}

class A67 {
  name = "a67";
}
class D67 extends A67 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C67 extends A67 {
  lives = "nine";
}
class S67 {
  street = "main";
  pet: D67 = new D67();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T67 = { pet: A67 };
function honest67(): T67 {
  return { pet: new A67() };
}
function adopt67(t: T67): void {
  t.pet = new C67();
}
function legs67(home: S67): number {
  return home.pet.legs + 1;
}
function via67(s: S67): T67 {
  const list: T67[] = [honest67()];
  list.fill(s);
  return list[0];
}

class A68 {
  name = "a68";
}
class D68 extends A68 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C68 extends A68 {
  lives = "nine";
}
class S68 {
  street = "main";
  pet: D68 = new D68();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T68 = { pet: A68 };
function honest68(): T68 {
  return { pet: new A68() };
}
function adopt68(t: T68): void {
  t.pet = new C68();
}
function legs68(home: S68): number {
  return home.pet.legs + 1;
}
function via68(s: S68): T68 {
  const list: T68[] = [honest68()];
  list.splice(0, 1, s);
  return list[0];
}

class A69 {
  name = "a69";
}
class D69 extends A69 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C69 extends A69 {
  lives = "nine";
}
class S69 {
  street = "main";
  pet: D69 = new D69();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T69 = { pet: A69 };
function honest69(): T69 {
  return { pet: new A69() };
}
function adopt69(t: T69): void {
  t.pet = new C69();
}
function legs69(home: S69): number {
  return home.pet.legs + 1;
}
function via69(s: S69): T69 {
  const list: T69[] = [];
  return list.concat([s])[0];
}

class A70 {
  name = "a70";
}
class D70 extends A70 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C70 extends A70 {
  lives = "nine";
}
class S70 {
  street = "main";
  pet: D70 = new D70();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T70 = { pet: A70 };
function honest70(): T70 {
  return { pet: new A70() };
}
function adopt70(t: T70): void {
  t.pet = new C70();
}
function legs70(home: S70): number {
  return home.pet.legs + 1;
}
function via70(s: S70): T70 {
  let t: T70 = honest70();
  const put = (): void => {
    t = s;
  };
  put();
  return t;
}

class A71 {
  name = "a71";
}
class D71 extends A71 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C71 extends A71 {
  lives = "nine";
}
class S71 {
  street = "main";
  pet: D71 = new D71();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T71 = { pet: A71 };
function honest71(): T71 {
  return { pet: new A71() };
}
function adopt71(t: T71): void {
  t.pet = new C71();
}
function legs71(home: S71): number {
  return home.pet.legs + 1;
}
function via71(s: S71): T71 {
  const t: T71 & {} = s;
  return t;
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  const home = new S60();
  adopt60(honest60());
  warm += legs60(home) + home.legs();
}
{
  const home = new S60();
  const t = await via60(home);
  attempt("an object with a member of the narrower type: the same object", () => t === home);
  adopt60(t);
  attempt("an object with a member of the narrower type: legs + 1", () => legs60(home));
  attempt("an object with a member of the narrower type: its own method", () => home.legs());
  attempt("an object with a member of the narrower type: bark", () => home.pet.bark());
  attempt("an object with a member of the narrower type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S61();
  adopt61(honest61());
  warm += legs61(home) + home.legs();
}
{
  const home = new S61();
  const t = await via61(home);
  attempt("a map of the narrower type: the same object", () => t === home);
  adopt61(t);
  attempt("a map of the narrower type: legs + 1", () => legs61(home));
  attempt("a map of the narrower type: its own method", () => home.legs());
  attempt("a map of the narrower type: bark", () => home.pet.bark());
  attempt("a map of the narrower type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S62();
  adopt62(honest62());
  warm += legs62(home) + home.legs();
}
{
  const home = new S62();
  const t = await via62(home);
  attempt("an instance with a field of the narrower type: the same object", () => t === home);
  adopt62(t);
  attempt("an instance with a field of the narrower type: legs + 1", () => legs62(home));
  attempt("an instance with a field of the narrower type: its own method", () => home.legs());
  attempt("an instance with a field of the narrower type: bark", () => home.pet.bark());
  attempt("an instance with a field of the narrower type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S63();
  adopt63(honest63());
  warm += legs63(home) + home.legs();
}
{
  const home = new S63();
  const t = await via63(home);
  attempt("a static field: the same object", () => t === home);
  adopt63(t);
  attempt("a static field: legs + 1", () => legs63(home));
  attempt("a static field: its own method", () => home.legs());
  attempt("a static field: bark", () => home.pet.bark());
  attempt("a static field: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S64();
  adopt64(honest64());
  warm += legs64(home) + home.legs();
}
{
  const home = new S64();
  const t = await via64(home);
  attempt("a generic class: the same object", () => t === home);
  adopt64(t);
  attempt("a generic class: legs + 1", () => legs64(home));
  attempt("a generic class: its own method", () => home.legs());
  attempt("a generic class: bark", () => home.pet.bark());
  attempt("a generic class: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S65();
  adopt65(honest65());
  warm += legs65(home) + home.legs();
}
{
  const home = new S65();
  const t = await via65(home);
  attempt("Array.of: the same object", () => t === home);
  adopt65(t);
  attempt("Array.of: legs + 1", () => legs65(home));
  attempt("Array.of: its own method", () => home.legs());
  attempt("Array.of: bark", () => home.pet.bark());
  attempt("Array.of: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S66();
  adopt66(honest66());
  warm += legs66(home) + home.legs();
}
{
  const home = new S66();
  const t = await via66(home);
  attempt("Array.from: the same object", () => t === home);
  adopt66(t);
  attempt("Array.from: legs + 1", () => legs66(home));
  attempt("Array.from: its own method", () => home.legs());
  attempt("Array.from: bark", () => home.pet.bark());
  attempt("Array.from: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S67();
  adopt67(honest67());
  warm += legs67(home) + home.legs();
}
{
  const home = new S67();
  const t = await via67(home);
  attempt("fill: the same object", () => t === home);
  adopt67(t);
  attempt("fill: legs + 1", () => legs67(home));
  attempt("fill: its own method", () => home.legs());
  attempt("fill: bark", () => home.pet.bark());
  attempt("fill: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S68();
  adopt68(honest68());
  warm += legs68(home) + home.legs();
}
{
  const home = new S68();
  const t = await via68(home);
  attempt("splice: the same object", () => t === home);
  adopt68(t);
  attempt("splice: legs + 1", () => legs68(home));
  attempt("splice: its own method", () => home.legs());
  attempt("splice: bark", () => home.pet.bark());
  attempt("splice: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S69();
  adopt69(honest69());
  warm += legs69(home) + home.legs();
}
{
  const home = new S69();
  const t = await via69(home);
  attempt("concat: the same object", () => t === home);
  adopt69(t);
  attempt("concat: legs + 1", () => legs69(home));
  attempt("concat: its own method", () => home.legs());
  attempt("concat: bark", () => home.pet.bark());
  attempt("concat: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S70();
  adopt70(honest70());
  warm += legs70(home) + home.legs();
}
{
  const home = new S70();
  const t = await via70(home);
  attempt("a variable that a closure assigns: the same object", () => t === home);
  adopt70(t);
  attempt("a variable that a closure assigns: legs + 1", () => legs70(home));
  attempt("a variable that a closure assigns: its own method", () => home.legs());
  attempt("a variable that a closure assigns: bark", () => home.pet.bark());
  attempt("a variable that a closure assigns: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
for (let i = 0; i < 500; i++) {
  const home = new S71();
  adopt71(honest71());
  warm += legs71(home) + home.legs();
}
{
  const home = new S71();
  const t = await via71(home);
  attempt("an intersection with the empty object type: the same object", () => t === home);
  adopt71(t);
  attempt("an intersection with the empty object type: legs + 1", () => legs71(home));
  attempt("an intersection with the empty object type: its own method", () => home.legs());
  attempt("an intersection with the empty object type: bark", () => home.pet.bark());
  attempt("an intersection with the empty object type: the other fields", () => [home.street, home.number, home.pet.name, Object.keys(home)]);
}
console.log("honest uses", warm);

export {};
