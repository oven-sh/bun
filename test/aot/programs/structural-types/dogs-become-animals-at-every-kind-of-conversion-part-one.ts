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

class A0 {
  name = "a0";
}
class D0 extends A0 {
  legs = 4;
}
class C0 extends A0 {
  lives = "nine";
}
type S0 = D0[];
type T0 = A0[];
function honest0(): T0 {
  return [new A0()];
}
function add0(t: T0): void {
  t.push(new C0());
}
function total0(dogs: S0): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via0(s: S0): T0 {
  const t: T0 = s;
  return t;
}

class A1 {
  name = "a1";
}
class D1 extends A1 {
  legs = 4;
}
class C1 extends A1 {
  lives = "nine";
}
type S1 = D1[];
type T1 = A1[];
function honest1(): T1 {
  return [new A1()];
}
function add1(t: T1): void {
  t.push(new C1());
}
function total1(dogs: S1): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via1(s: S1): T1 {
  let t: T1 = honest1();
  t = s;
  return t;
}

class A2 {
  name = "a2";
}
class D2 extends A2 {
  legs = 4;
}
class C2 extends A2 {
  lives = "nine";
}
type S2 = D2[];
type T2 = A2[];
function honest2(): T2 {
  return [new A2()];
}
function add2(t: T2): void {
  t.push(new C2());
}
function total2(dogs: S2): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function take2(t: T2): T2 {
  return t;
}
function via2(s: S2): T2 {
  return take2(s);
}

class A3 {
  name = "a3";
}
class D3 extends A3 {
  legs = 4;
}
class C3 extends A3 {
  lives = "nine";
}
type S3 = D3[];
type T3 = A3[];
function honest3(): T3 {
  return [new A3()];
}
function add3(t: T3): void {
  t.push(new C3());
}
function total3(dogs: S3): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via3(s: S3): T3 {
  return s;
}

class A4 {
  name = "a4";
}
class D4 extends A4 {
  legs = 4;
}
class C4 extends A4 {
  lives = "nine";
}
type S4 = D4[];
type T4 = A4[];
function honest4(): T4 {
  return [new A4()];
}
function add4(t: T4): void {
  t.push(new C4());
}
function total4(dogs: S4): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
const via4 = (s: S4): T4 => s;

class A5 {
  name = "a5";
}
class D5 extends A5 {
  legs = 4;
}
class C5 extends A5 {
  lives = "nine";
}
type S5 = D5[];
type T5 = A5[];
function honest5(): T5 {
  return [new A5()];
}
function add5(t: T5): void {
  t.push(new C5());
}
function total5(dogs: S5): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via5(s: S5): T5 {
  const t: T5 = yes ? s : honest5();
  return t;
}

class A6 {
  name = "a6";
}
class D6 extends A6 {
  legs = 4;
}
class C6 extends A6 {
  lives = "nine";
}
type S6 = D6[];
type T6 = A6[];
function honest6(): T6 {
  return [new A6()];
}
function add6(t: T6): void {
  t.push(new C6());
}
function total6(dogs: S6): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via6(s: S6, none?: T6): T6 {
  return none ?? s;
}

class A7 {
  name = "a7";
}
class D7 extends A7 {
  legs = 4;
}
class C7 extends A7 {
  lives = "nine";
}
type S7 = D7[];
type T7 = A7[];
function honest7(): T7 {
  return [new A7()];
}
function add7(t: T7): void {
  t.push(new C7());
}
function total7(dogs: S7): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via7(s: S7, none?: T7): T7 {
  return none || s;
}

class A8 {
  name = "a8";
}
class D8 extends A8 {
  legs = 4;
}
class C8 extends A8 {
  lives = "nine";
}
type S8 = D8[];
type T8 = A8[];
function honest8(): T8 {
  return [new A8()];
}
function add8(t: T8): void {
  t.push(new C8());
}
function total8(dogs: S8): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via8(s: S8): T8 {
  const t: T8 | boolean = yes && s;
  return typeof t === "boolean" ? honest8() : t;
}

class A9 {
  name = "a9";
}
class D9 extends A9 {
  legs = 4;
}
class C9 extends A9 {
  lives = "nine";
}
type S9 = D9[];
type T9 = A9[];
function honest9(): T9 {
  return [new A9()];
}
function add9(t: T9): void {
  t.push(new C9());
}
function total9(dogs: S9): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via9(s: S9): T9 {
  return (touch(), s);
}

class A10 {
  name = "a10";
}
class D10 extends A10 {
  legs = 4;
}
class C10 extends A10 {
  lives = "nine";
}
type S10 = D10[];
type T10 = A10[];
function honest10(): T10 {
  return [new A10()];
}
function add10(t: T10): void {
  t.push(new C10());
}
function total10(dogs: S10): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via10(s: S10): T10 {
  return s satisfies T10;
}

class A11 {
  name = "a11";
}
class D11 extends A11 {
  legs = 4;
}
class C11 extends A11 {
  lives = "nine";
}
type S11 = D11[];
type T11 = A11[];
function honest11(): T11 {
  return [new A11()];
}
function add11(t: T11): void {
  t.push(new C11());
}
function total11(dogs: S11): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via11(s: S11): T11 {
  const list: T11[] = [honest11(), s];
  return list[1];
}

class A12 {
  name = "a12";
}
class D12 extends A12 {
  legs = 4;
}
class C12 extends A12 {
  lives = "nine";
}
type S12 = D12[];
type T12 = A12[];
function honest12(): T12 {
  return [new A12()];
}
function add12(t: T12): void {
  t.push(new C12());
}
function total12(dogs: S12): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C13 extends A13 {
  lives = "nine";
}
type S13 = D13[];
type T13 = A13[];
function honest13(): T13 {
  return [new A13()];
}
function add13(t: T13): void {
  t.push(new C13());
}
function total13(dogs: S13): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C14 extends A14 {
  lives = "nine";
}
type S14 = D14[];
type T14 = A14[];
function honest14(): T14 {
  return [new A14()];
}
function add14(t: T14): void {
  t.push(new C14());
}
function total14(dogs: S14): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C15 extends A15 {
  lives = "nine";
}
type S15 = D15[];
type T15 = A15[];
function honest15(): T15 {
  return [new A15()];
}
function add15(t: T15): void {
  t.push(new C15());
}
function total15(dogs: S15): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C16 extends A16 {
  lives = "nine";
}
type S16 = D16[];
type T16 = A16[];
function honest16(): T16 {
  return [new A16()];
}
function add16(t: T16): void {
  t.push(new C16());
}
function total16(dogs: S16): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C17 extends A17 {
  lives = "nine";
}
type S17 = D17[];
type T17 = A17[];
function honest17(): T17 {
  return [new A17()];
}
function add17(t: T17): void {
  t.push(new C17());
}
function total17(dogs: S17): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C18 extends A18 {
  lives = "nine";
}
type S18 = D18[];
type T18 = A18[];
function honest18(): T18 {
  return [new A18()];
}
function add18(t: T18): void {
  t.push(new C18());
}
function total18(dogs: S18): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C19 extends A19 {
  lives = "nine";
}
type S19 = D19[];
type T19 = A19[];
function honest19(): T19 {
  return [new A19()];
}
function add19(t: T19): void {
  t.push(new C19());
}
function total19(dogs: S19): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C20 extends A20 {
  lives = "nine";
}
type S20 = D20[];
type T20 = A20[];
function honest20(): T20 {
  return [new A20()];
}
function add20(t: T20): void {
  t.push(new C20());
}
function total20(dogs: S20): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C21 extends A21 {
  lives = "nine";
}
type S21 = D21[];
type T21 = A21[];
function honest21(): T21 {
  return [new A21()];
}
function add21(t: T21): void {
  t.push(new C21());
}
function total21(dogs: S21): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C22 extends A22 {
  lives = "nine";
}
type S22 = D22[];
type T22 = A22[];
function honest22(): T22 {
  return [new A22()];
}
function add22(t: T22): void {
  t.push(new C22());
}
function total22(dogs: S22): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C23 extends A23 {
  lives = "nine";
}
type S23 = D23[];
type T23 = A23[];
function honest23(): T23 {
  return [new A23()];
}
function add23(t: T23): void {
  t.push(new C23());
}
function total23(dogs: S23): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via23(s: S23): T23 {
  const map = new Map<string, T23>();
  map.set("k", s);
  return map.get("k") ?? honest23();
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  add0(honest0());
  warm += total0([new D0(), new D0()]);
}
{
  const dogs = [new D0()];
  const t = await via0(dogs);
  attempt("a declaration: the same array", () => t === dogs);
  add0(t);
  attempt("a declaration: total legs", () => total0(dogs));
  attempt("a declaration: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add1(honest1());
  warm += total1([new D1(), new D1()]);
}
{
  const dogs = [new D1()];
  const t = await via1(dogs);
  attempt("an assignment: the same array", () => t === dogs);
  add1(t);
  attempt("an assignment: total legs", () => total1(dogs));
  attempt("an assignment: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add2(honest2());
  warm += total2([new D2(), new D2()]);
}
{
  const dogs = [new D2()];
  const t = await via2(dogs);
  attempt("an argument: the same array", () => t === dogs);
  add2(t);
  attempt("an argument: total legs", () => total2(dogs));
  attempt("an argument: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add3(honest3());
  warm += total3([new D3(), new D3()]);
}
{
  const dogs = [new D3()];
  const t = await via3(dogs);
  attempt("a return statement: the same array", () => t === dogs);
  add3(t);
  attempt("a return statement: total legs", () => total3(dogs));
  attempt("a return statement: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add4(honest4());
  warm += total4([new D4(), new D4()]);
}
{
  const dogs = [new D4()];
  const t = await via4(dogs);
  attempt("the body of an arrow function: the same array", () => t === dogs);
  add4(t);
  attempt("the body of an arrow function: total legs", () => total4(dogs));
  attempt("the body of an arrow function: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add5(honest5());
  warm += total5([new D5(), new D5()]);
}
{
  const dogs = [new D5()];
  const t = await via5(dogs);
  attempt("an arm of a conditional expression: the same array", () => t === dogs);
  add5(t);
  attempt("an arm of a conditional expression: total legs", () => total5(dogs));
  attempt("an arm of a conditional expression: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add6(honest6());
  warm += total6([new D6(), new D6()]);
}
{
  const dogs = [new D6()];
  const t = await via6(dogs);
  attempt("the right side of ??: the same array", () => t === dogs);
  add6(t);
  attempt("the right side of ??: total legs", () => total6(dogs));
  attempt("the right side of ??: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add7(honest7());
  warm += total7([new D7(), new D7()]);
}
{
  const dogs = [new D7()];
  const t = await via7(dogs);
  attempt("the right side of ||: the same array", () => t === dogs);
  add7(t);
  attempt("the right side of ||: total legs", () => total7(dogs));
  attempt("the right side of ||: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add8(honest8());
  warm += total8([new D8(), new D8()]);
}
{
  const dogs = [new D8()];
  const t = await via8(dogs);
  attempt("the right side of &&: the same array", () => t === dogs);
  add8(t);
  attempt("the right side of &&: total legs", () => total8(dogs));
  attempt("the right side of &&: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add9(honest9());
  warm += total9([new D9(), new D9()]);
}
{
  const dogs = [new D9()];
  const t = await via9(dogs);
  attempt("the last operand of a comma: the same array", () => t === dogs);
  add9(t);
  attempt("the last operand of a comma: total legs", () => total9(dogs));
  attempt("the last operand of a comma: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add10(honest10());
  warm += total10([new D10(), new D10()]);
}
{
  const dogs = [new D10()];
  const t = await via10(dogs);
  attempt("satisfies: the same array", () => t === dogs);
  add10(t);
  attempt("satisfies: total legs", () => total10(dogs));
  attempt("satisfies: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add11(honest11());
  warm += total11([new D11(), new D11()]);
}
{
  const dogs = [new D11()];
  const t = await via11(dogs);
  attempt("an element of an array literal: the same array", () => t === dogs);
  add11(t);
  attempt("an element of an array literal: total legs", () => total11(dogs));
  attempt("an element of an array literal: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add12(honest12());
  warm += total12([new D12(), new D12()]);
}
{
  const dogs = [new D12()];
  const t = await via12(dogs);
  attempt("a member of an object literal: the same array", () => t === dogs);
  add12(t);
  attempt("a member of an object literal: total legs", () => total12(dogs));
  attempt("a member of an object literal: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add13(honest13());
  warm += total13([new D13(), new D13()]);
}
{
  const dogs = [new D13()];
  const t = await via13(dogs);
  attempt("a shorthand member: the same array", () => t === dogs);
  add13(t);
  attempt("a shorthand member: total legs", () => total13(dogs));
  attempt("a shorthand member: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add14(honest14());
  warm += total14([new D14(), new D14()]);
}
{
  const dogs = [new D14()];
  const t = await via14(dogs);
  attempt("the initializer of a field: the same array", () => t === dogs);
  add14(t);
  attempt("the initializer of a field: total legs", () => total14(dogs));
  attempt("the initializer of a field: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add15(honest15());
  warm += total15([new D15(), new D15()]);
}
{
  const dogs = [new D15()];
  const t = await via15(dogs);
  attempt("a parameter property: the same array", () => t === dogs);
  add15(t);
  attempt("a parameter property: total legs", () => total15(dogs));
  attempt("a parameter property: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add16(honest16());
  warm += total16([new D16(), new D16()]);
}
{
  const dogs = [new D16()];
  const t = await via16(dogs);
  attempt("the default of a parameter: the same array", () => t === dogs);
  add16(t);
  attempt("the default of a parameter: total legs", () => total16(dogs));
  attempt("the default of a parameter: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add17(honest17());
  warm += total17([new D17(), new D17()]);
}
{
  const dogs = [new D17()];
  const t = await via17(dogs);
  attempt("the default in a pattern: the same array", () => t === dogs);
  add17(t);
  attempt("the default in a pattern: total legs", () => total17(dogs));
  attempt("the default in a pattern: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add18(honest18());
  warm += total18([new D18(), new D18()]);
}
{
  const dogs = [new D18()];
  const t = await via18(dogs);
  attempt("a spread argument: the same array", () => t === dogs);
  add18(t);
  attempt("a spread argument: total legs", () => total18(dogs));
  attempt("a spread argument: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add19(honest19());
  warm += total19([new D19(), new D19()]);
}
{
  const dogs = [new D19()];
  const t = await via19(dogs);
  attempt("a rest parameter: the same array", () => t === dogs);
  add19(t);
  attempt("a rest parameter: total legs", () => total19(dogs));
  attempt("a rest parameter: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add20(honest20());
  warm += total20([new D20(), new D20()]);
}
{
  const dogs = [new D20()];
  const t = await via20(dogs);
  attempt("a spread into an array literal: the same array", () => t === dogs);
  add20(t);
  attempt("a spread into an array literal: total legs", () => total20(dogs));
  attempt("a spread into an array literal: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add21(honest21());
  warm += total21([new D21(), new D21()]);
}
{
  const dogs = [new D21()];
  const t = await via21(dogs);
  attempt("a spread into an object literal: the same array", () => t === dogs);
  add21(t);
  attempt("a spread into an object literal: total legs", () => total21(dogs));
  attempt("a spread into an object literal: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add22(honest22());
  warm += total22([new D22(), new D22()]);
}
{
  const dogs = [new D22()];
  const t = await via22(dogs);
  attempt("push: the same array", () => t === dogs);
  add22(t);
  attempt("push: total legs", () => total22(dogs));
  attempt("push: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add23(honest23());
  warm += total23([new D23(), new D23()]);
}
{
  const dogs = [new D23()];
  const t = await via23(dogs);
  attempt("the value of a map entry: the same array", () => t === dogs);
  add23(t);
  attempt("the value of a map entry: total legs", () => total23(dogs));
  attempt("the value of a map entry: legs", () => dogs.map(dog => dog.legs));
}
console.log("honest uses", warm);

export {};
