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

class A24 {
  name = "a24";
}
class D24 extends A24 {
  legs = 4;
}
class C24 extends A24 {
  lives = "nine";
}
type S24 = D24[];
type T24 = A24[];
function honest24(): T24 {
  return [new A24()];
}
function add24(t: T24): void {
  t.push(new C24());
}
function total24(dogs: S24): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via24(s: S24): T24 {
  const map = new Map<string, T24>([["k", s]]);
  return map.get("k") ?? honest24();
}

class A25 {
  name = "a25";
}
class D25 extends A25 {
  legs = 4;
}
class C25 extends A25 {
  lives = "nine";
}
type S25 = D25[];
type T25 = A25[];
function honest25(): T25 {
  return [new A25()];
}
function add25(t: T25): void {
  t.push(new C25());
}
function total25(dogs: S25): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via25(s: S25): T25 {
  const set = new Set<T25>();
  set.add(s);
  for (const t of set) return t;
  return honest25();
}

class A26 {
  name = "a26";
}
class D26 extends A26 {
  legs = 4;
}
class C26 extends A26 {
  lives = "nine";
}
type S26 = D26[];
type T26 = A26[];
function honest26(): T26 {
  return [new A26()];
}
function add26(t: T26): void {
  t.push(new C26());
}
function total26(dogs: S26): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via26(s: S26): T26 {
  function* give(): Generator<T26> {
    yield s;
  }
  for (const t of give()) return t;
  return honest26();
}

class A27 {
  name = "a27";
}
class D27 extends A27 {
  legs = 4;
}
class C27 extends A27 {
  lives = "nine";
}
type S27 = D27[];
type T27 = A27[];
function honest27(): T27 {
  return [new A27()];
}
function add27(t: T27): void {
  t.push(new C27());
}
function total27(dogs: S27): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via27(s: S27): T27 {
  const seen: T27[] = [];
  function* take(): Generator<undefined, void, T27> {
    seen.push(yield);
  }
  const generator = take();
  generator.next(honest27());
  generator.next(s);
  return seen[0];
}

class A28 {
  name = "a28";
}
class D28 extends A28 {
  legs = 4;
}
class C28 extends A28 {
  lives = "nine";
}
type S28 = D28[];
type T28 = A28[];
function honest28(): T28 {
  return [new A28()];
}
function add28(t: T28): void {
  t.push(new C28());
}
function total28(dogs: S28): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
async function via28(s: S28): Promise<T28> {
  return s;
}

class A29 {
  name = "a29";
}
class D29 extends A29 {
  legs = 4;
}
class C29 extends A29 {
  lives = "nine";
}
type S29 = D29[];
type T29 = A29[];
function honest29(): T29 {
  return [new A29()];
}
function add29(t: T29): void {
  t.push(new C29());
}
function total29(dogs: S29): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via29(s: S29): Promise<T29> {
  return Promise.resolve<T29>(s);
}

class A30 {
  name = "a30";
}
class D30 extends A30 {
  legs = 4;
}
class C30 extends A30 {
  lives = "nine";
}
type S30 = D30[];
type T30 = A30[];
function honest30(): T30 {
  return [new A30()];
}
function add30(t: T30): void {
  t.push(new C30());
}
function total30(dogs: S30): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via30(s: S30): Promise<T30> {
  return Promise.resolve(0).then((): T30 => s);
}

class A31 {
  name = "a31";
}
class D31 extends A31 {
  legs = 4;
}
class C31 extends A31 {
  lives = "nine";
}
type S31 = D31[];
type T31 = A31[];
function honest31(): T31 {
  return [new A31()];
}
function add31(t: T31): void {
  t.push(new C31());
}
function total31(dogs: S31): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via31(s: S31): Promise<T31> {
  return new Promise<T31>(resolve => resolve(s));
}

class A32 {
  name = "a32";
}
class D32 extends A32 {
  legs = 4;
}
class C32 extends A32 {
  lives = "nine";
}
type S32 = D32[];
type T32 = A32[];
function honest32(): T32 {
  return [new A32()];
}
function add32(t: T32): void {
  t.push(new C32());
}
function total32(dogs: S32): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via32(s: S32): T32 {
  return [0].map((): T32 => s)[0];
}

class A33 {
  name = "a33";
}
class D33 extends A33 {
  legs = 4;
}
class C33 extends A33 {
  lives = "nine";
}
type S33 = D33[];
type T33 = A33[];
function honest33(): T33 {
  return [new A33()];
}
function add33(t: T33): void {
  t.push(new C33());
}
function total33(dogs: S33): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function same33<X>(x: X): X {
  return x;
}
function via33(s: S33): T33 {
  return same33<T33>(s);
}

class A34 {
  name = "a34";
}
class D34 extends A34 {
  legs = 4;
}
class C34 extends A34 {
  lives = "nine";
}
type S34 = D34[];
type T34 = A34[];
function honest34(): T34 {
  return [new A34()];
}
function add34(t: T34): void {
  t.push(new C34());
}
function total34(dogs: S34): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function widen34<X extends T34>(x: X): T34 {
  return x;
}
function via34(s: S34): T34 {
  return widen34(s);
}

class A35 {
  name = "a35";
}
class D35 extends A35 {
  legs = 4;
}
class C35 extends A35 {
  lives = "nine";
}
type S35 = D35[];
type T35 = A35[];
function honest35(): T35 {
  return [new A35()];
}
function add35(t: T35): void {
  t.push(new C35());
}
function total35(dogs: S35): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function via35(s: S35): T35 {
  let t: T35 = honest35();
  for (t of [s]);
  return t;
}

class A36 {
  name = "a36";
}
class D36 extends A36 {
  legs = 4;
}
class C36 extends A36 {
  lives = "nine";
}
type S36 = D36[];
type T36 = A36[];
function honest36(): T36 {
  return [new A36()];
}
function add36(t: T36): void {
  t.push(new C36());
}
function total36(dogs: S36): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C37 extends A37 {
  lives = "nine";
}
type S37 = D37[];
type T37 = A37[];
function honest37(): T37 {
  return [new A37()];
}
function add37(t: T37): void {
  t.push(new C37());
}
function total37(dogs: S37): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C38 extends A38 {
  lives = "nine";
}
type S38 = D38[];
type T38 = A38[];
function honest38(): T38 {
  return [new A38()];
}
function add38(t: T38): void {
  t.push(new C38());
}
function total38(dogs: S38): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C39 extends A39 {
  lives = "nine";
}
type S39 = D39[];
type T39 = A39[];
function honest39(): T39 {
  return [new A39()];
}
function add39(t: T39): void {
  t.push(new C39());
}
function total39(dogs: S39): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C40 extends A40 {
  lives = "nine";
}
type S40 = D40[];
type T40 = A40[];
function honest40(): T40 {
  return [new A40()];
}
function add40(t: T40): void {
  t.push(new C40());
}
function total40(dogs: S40): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C41 extends A41 {
  lives = "nine";
}
type S41 = D41[];
type T41 = A41[];
function honest41(): T41 {
  return [new A41()];
}
function add41(t: T41): void {
  t.push(new C41());
}
function total41(dogs: S41): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C42 extends A42 {
  lives = "nine";
}
type S42 = D42[];
type T42 = A42[];
function honest42(): T42 {
  return [new A42()];
}
function add42(t: T42): void {
  t.push(new C42());
}
function total42(dogs: S42): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C43 extends A43 {
  lives = "nine";
}
type S43 = D43[];
type T43 = A43[];
function honest43(): T43 {
  return [new A43()];
}
function add43(t: T43): void {
  t.push(new C43());
}
function total43(dogs: S43): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C44 extends A44 {
  lives = "nine";
}
type S44 = D44[];
type T44 = A44[];
function honest44(): T44 {
  return [new A44()];
}
function add44(t: T44): void {
  t.push(new C44());
}
function total44(dogs: S44): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C45 extends A45 {
  lives = "nine";
}
type S45 = D45[];
type T45 = A45[];
function honest45(): T45 {
  return [new A45()];
}
function add45(t: T45): void {
  t.push(new C45());
}
function total45(dogs: S45): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C46 extends A46 {
  lives = "nine";
}
type S46 = D46[];
type T46 = A46[];
function honest46(): T46 {
  return [new A46()];
}
function add46(t: T46): void {
  t.push(new C46());
}
function total46(dogs: S46): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
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
}
class C47 extends A47 {
  lives = "nine";
}
type S47 = D47[];
type T47 = A47[];
function honest47(): T47 {
  return [new A47()];
}
function add47(t: T47): void {
  t.push(new C47());
}
function total47(dogs: S47): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}
function take47(t: T47): T47 {
  return t;
}
function via47(s: S47): T47 {
  return take47.call(undefined, s);
}

let warm = 0;
for (let i = 0; i < 500; i++) {
  add24(honest24());
  warm += total24([new D24(), new D24()]);
}
{
  const dogs = [new D24()];
  const t = await via24(dogs);
  attempt("the entries a map is made from: the same array", () => t === dogs);
  add24(t);
  attempt("the entries a map is made from: total legs", () => total24(dogs));
  attempt("the entries a map is made from: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add25(honest25());
  warm += total25([new D25(), new D25()]);
}
{
  const dogs = [new D25()];
  const t = await via25(dogs);
  attempt("a member of a set: the same array", () => t === dogs);
  add25(t);
  attempt("a member of a set: total legs", () => total25(dogs));
  attempt("a member of a set: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add26(honest26());
  warm += total26([new D26(), new D26()]);
}
{
  const dogs = [new D26()];
  const t = await via26(dogs);
  attempt("yield: the same array", () => t === dogs);
  add26(t);
  attempt("yield: total legs", () => total26(dogs));
  attempt("yield: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add27(honest27());
  warm += total27([new D27(), new D27()]);
}
{
  const dogs = [new D27()];
  const t = await via27(dogs);
  attempt("the value sent into a generator: the same array", () => t === dogs);
  add27(t);
  attempt("the value sent into a generator: total legs", () => total27(dogs));
  attempt("the value sent into a generator: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add28(honest28());
  warm += total28([new D28(), new D28()]);
}
{
  const dogs = [new D28()];
  const t = await via28(dogs);
  attempt("the result of an async function: the same array", () => t === dogs);
  add28(t);
  attempt("the result of an async function: total legs", () => total28(dogs));
  attempt("the result of an async function: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add29(honest29());
  warm += total29([new D29(), new D29()]);
}
{
  const dogs = [new D29()];
  const t = await via29(dogs);
  attempt("Promise.resolve: the same array", () => t === dogs);
  add29(t);
  attempt("Promise.resolve: total legs", () => total29(dogs));
  attempt("Promise.resolve: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add30(honest30());
  warm += total30([new D30(), new D30()]);
}
{
  const dogs = [new D30()];
  const t = await via30(dogs);
  attempt("the result of a reaction: the same array", () => t === dogs);
  add30(t);
  attempt("the result of a reaction: total legs", () => total30(dogs));
  attempt("the result of a reaction: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add31(honest31());
  warm += total31([new D31(), new D31()]);
}
{
  const dogs = [new D31()];
  const t = await via31(dogs);
  attempt("the resolver of a promise: the same array", () => t === dogs);
  add31(t);
  attempt("the resolver of a promise: total legs", () => total31(dogs));
  attempt("the resolver of a promise: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add32(honest32());
  warm += total32([new D32(), new D32()]);
}
{
  const dogs = [new D32()];
  const t = await via32(dogs);
  attempt("the result of a callback: the same array", () => t === dogs);
  add32(t);
  attempt("the result of a callback: total legs", () => total32(dogs));
  attempt("the result of a callback: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add33(honest33());
  warm += total33([new D33(), new D33()]);
}
{
  const dogs = [new D33()];
  const t = await via33(dogs);
  attempt("an explicit type argument: the same array", () => t === dogs);
  add33(t);
  attempt("an explicit type argument: total legs", () => total33(dogs));
  attempt("an explicit type argument: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add34(honest34());
  warm += total34([new D34(), new D34()]);
}
{
  const dogs = [new D34()];
  const t = await via34(dogs);
  attempt("a constrained type parameter: the same array", () => t === dogs);
  add34(t);
  attempt("a constrained type parameter: total legs", () => total34(dogs));
  attempt("a constrained type parameter: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add35(honest35());
  warm += total35([new D35(), new D35()]);
}
{
  const dogs = [new D35()];
  const t = await via35(dogs);
  attempt("the target of a for-of: the same array", () => t === dogs);
  add35(t);
  attempt("the target of a for-of: total legs", () => total35(dogs));
  attempt("the target of a for-of: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add36(honest36());
  warm += total36([new D36(), new D36()]);
}
{
  const dogs = [new D36()];
  const t = await via36(dogs);
  attempt("??=: the same array", () => t === dogs);
  add36(t);
  attempt("??=: total legs", () => total36(dogs));
  attempt("??=: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add37(honest37());
  warm += total37([new D37(), new D37()]);
}
{
  const dogs = [new D37()];
  const t = await via37(dogs);
  attempt("||=: the same array", () => t === dogs);
  add37(t);
  attempt("||=: total legs", () => total37(dogs));
  attempt("||=: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add38(honest38());
  warm += total38([new D38(), new D38()]);
}
{
  const dogs = [new D38()];
  const t = await via38(dogs);
  attempt("the result of a getter: the same array", () => t === dogs);
  add38(t);
  attempt("the result of a getter: total legs", () => total38(dogs));
  attempt("the result of a getter: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add39(honest39());
  warm += total39([new D39(), new D39()]);
}
{
  const dogs = [new D39()];
  const t = await via39(dogs);
  attempt("the parameter of a setter: the same array", () => t === dogs);
  add39(t);
  attempt("the parameter of a setter: total legs", () => total39(dogs));
  attempt("the parameter of a setter: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add40(honest40());
  warm += total40([new D40(), new D40()]);
}
{
  const dogs = [new D40()];
  const t = await via40(dogs);
  attempt("the result of a function type: the same array", () => t === dogs);
  add40(t);
  attempt("the result of a function type: total legs", () => total40(dogs));
  attempt("the result of a function type: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add41(honest41());
  warm += total41([new D41(), new D41()]);
}
{
  const dogs = [new D41()];
  const t = await via41(dogs);
  attempt("the parameter of a function type: the same array", () => t === dogs);
  add41(t);
  attempt("the parameter of a function type: total legs", () => total41(dogs));
  attempt("the parameter of a function type: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add42(honest42());
  warm += total42([new D42(), new D42()]);
}
{
  const dogs = [new D42()];
  const t = await via42(dogs);
  attempt("a method that implements an interface: the same array", () => t === dogs);
  add42(t);
  attempt("a method that implements an interface: total legs", () => total42(dogs));
  attempt("a method that implements an interface: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add43(honest43());
  warm += total43([new D43(), new D43()]);
}
{
  const dogs = [new D43()];
  const t = await via43(dogs);
  attempt("a place of a tuple: the same array", () => t === dogs);
  add43(t);
  attempt("a place of a tuple: total legs", () => total43(dogs));
  attempt("a place of a tuple: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add44(honest44());
  warm += total44([new D44(), new D44()]);
}
{
  const dogs = [new D44()];
  const t = await via44(dogs);
  attempt("a tagged template: the same array", () => t === dogs);
  add44(t);
  attempt("a tagged template: total legs", () => total44(dogs));
  attempt("a tagged template: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add45(honest45());
  warm += total45([new D45(), new D45()]);
}
{
  const dogs = [new D45()];
  const t = await via45(dogs);
  attempt("an argument of super: the same array", () => t === dogs);
  add45(t);
  attempt("an argument of super: total legs", () => total45(dogs));
  attempt("an argument of super: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add46(honest46());
  warm += total46([new D46(), new D46()]);
}
{
  const dogs = [new D46()];
  const t = await via46(dogs);
  attempt("an optional call: the same array", () => t === dogs);
  add46(t);
  attempt("an optional call: total legs", () => total46(dogs));
  attempt("an optional call: legs", () => dogs.map(dog => dog.legs));
}
for (let i = 0; i < 500; i++) {
  add47(honest47());
  warm += total47([new D47(), new D47()]);
}
{
  const dogs = [new D47()];
  const t = await via47(dogs);
  attempt("call: the same array", () => t === dogs);
  add47(t);
  attempt("call: total legs", () => total47(dogs));
  attempt("call: legs", () => dogs.map(dog => dog.legs));
}
console.log("honest uses", warm);

export {};
