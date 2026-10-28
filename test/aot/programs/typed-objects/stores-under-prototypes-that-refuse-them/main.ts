// Stores onto instances of typed classes whose prototypes refuse them or take them over: read-only properties, setters, getters alone, frozen, sealed and closed prototypes;
// by name, by key, by Object.assign, Reflect.set, spread and definition; from strict and from sloppy code; before and after the prototype changes. Two rows differ from plain Bun: a read through `as { free: number }` that an inherited getter answers with a text throws a TypeError.
import * as sloppy from "./sloppy.cjs";

const lines: string[] = [];
function show(value: unknown): string {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return String(value);
  return JSON.stringify(value) ?? "undefined";
}
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = show(work());
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}
const own = (object: object) => Reflect.ownKeys(object).map(String).join();
const key = (text: string) => text.split("").join("");
let log = "";

type Loose = { free: unknown; method: unknown; [key: string]: unknown };

function everyStore(title: string, make: () => object) {
  for (let round = 0; round < 2; round++) {
    const at = title + " " + round + " ";
    say(at + "any", () => { const c: any = make(); c.free = 4; return [own(c), c.free]; });
    say(at + "cast", () => { const c = make() as Loose; c.free = 4; return [own(c), c.free]; });
    say(at + "number", () => { const c = make() as { free: number }; c.free = 4.5; return [own(c), c.free]; });
    say(at + "keyed", () => { const c: any = make(); c[key("free")] = 4; return [own(c), c.free]; });
    say(at + "assign", () => { const c: any = make(); Object.assign(c, { free: 4 }); return [own(c), c.free]; });
    say(at + "assign two", () => { const c: any = make(); try { Object.assign(c, { before: 1, free: 4, after: 2 }); } catch (error) { return ["threw", own(c)]; } return [own(c), c.free]; });
    say(at + "assign parsed", () => { const c: any = make(); Object.assign(c, JSON.parse('{"free":4}')); return [own(c), c.free]; });
    say(at + "reflect", () => { const c: any = make(); return [Reflect.set(c, "free", 4), own(c), c.free]; });
    say(at + "spread", () => { const c: any = { ...make(), free: 4 }; return [own(c), c.free]; });
    say(at + "define", () => { const c: any = make(); Object.defineProperty(c, "free", { value: 4, writable: true, enumerable: true, configurable: true }); return [own(c), c.free]; });
    say(at + "add", () => { const c: any = make(); c.free += 1; return [own(c), c.free]; });
    say(at + "default", () => { const c: any = make(); c.free ??= 4; return [own(c), c.free]; });
    say(at + "pattern", () => { const c: any = make(); ({ free: c.free } = { free: 4 }); return [own(c), c.free]; });
    say(at + "method", () => { const c: any = make(); c.method = () => "own"; return [own(c), c.method()]; });
    say(at + "method cast", () => { const c = make() as Loose; c.method = 5; return [own(c), c.method]; });
    say(at + "method assign", () => { const c: any = make(); Object.assign(c, { method: 5 }); return [own(c), c.method]; });
    say(at + "sloppy", () => { const c = make(); return [sloppy.storeByName(c, 4), own(c)]; });
    say(at + "sloppy keyed", () => { const c = make(); return [sloppy.storeByKey(c, key("free"), 4), own(c)]; });
    say(at + "sloppy method", () => { const c = make(); return [sloppy.storeMethod(c, 4), own(c)]; });
    say(at + "sloppy assign", () => { const c = make(); return [sloppy.assign(c, { free: 4 }), own(c)]; });
    say(at + "sloppy add", () => { const c = make(); return [sloppy.add(c), own(c)]; });
  }
}

class ReadOnlyText { first = 1; method() { return "declared"; } }
everyStore("before a read-only text", () => new ReadOnlyText());
Object.defineProperty(ReadOnlyText.prototype, "free", { value: "read only", writable: false, configurable: true });
everyStore("a read-only text", () => new ReadOnlyText());
delete (ReadOnlyText.prototype as any).free;
everyStore("the read-only text deleted", () => new ReadOnlyText());

class ReadOnlyNumber { first = 1; method() { return "declared"; } }
Object.defineProperty(ReadOnlyNumber.prototype, "free", { value: 7 });
everyStore("a read-only number", () => new ReadOnlyNumber());

class ReadOnlyFunction { first = 1; method() { return "declared"; } }
Object.defineProperty(ReadOnlyFunction.prototype, "free", { value: () => 1 });
everyStore("a read-only function", () => new ReadOnlyFunction());

class ReadOnlyObject { first = 1; method() { return "declared"; } }
Object.defineProperty(ReadOnlyObject.prototype, "free", { value: { a: 1 }, enumerable: true });
everyStore("a read-only object", () => new ReadOnlyObject());

class WithSetter { first = 1; method() { return "declared"; } }
everyStore("before a setter", () => new WithSetter());
Object.defineProperty(WithSetter.prototype, "free", { set(value) { log += "set " + show(value) + ";"; }, get() { return "got"; }, configurable: true });
everyStore("a setter", () => new WithSetter());

class GetterAlone { first = 1; method() { return "declared"; } }
Object.defineProperty(GetterAlone.prototype, "free", { get() { return "got"; }, configurable: true });
everyStore("a getter alone", () => new GetterAlone());

class Frozen { first = 1; method() { return "declared"; } }
everyStore("before it is frozen", () => new Frozen());
Object.freeze(Frozen.prototype);
everyStore("frozen", () => new Frozen());

class FrozenWithMore { first = 1; method() { return "declared"; } }
(FrozenWithMore.prototype as any).free = "was writable";
Object.freeze(FrozenWithMore.prototype);
everyStore("frozen with a property more", () => new FrozenWithMore());

class Sealed { first = 1; method() { return "declared"; } }
(Sealed.prototype as any).free = "was writable";
Object.seal(Sealed.prototype);
everyStore("sealed", () => new Sealed());

class Closed { first = 1; method() { return "declared"; } }
Object.preventExtensions(Closed.prototype);
everyStore("closed", () => new Closed());

class Above { zero = 0; method() { return "declared"; } }
class Below extends Above { first = 1; }
everyStore("before the class above has it", () => new Below());
Object.defineProperty(Above.prototype, "free", { value: "read only above", writable: false, configurable: true });
everyStore("the class above has it", () => new Below());
Object.freeze(Above.prototype);
everyStore("the class above is frozen", () => new Below());

class MethodMadeReadOnly { first = 1; method() { return "declared"; } }
say("redefine the method", () => { Object.defineProperty(MethodMadeReadOnly.prototype, "method", { writable: false }); return Object.getOwnPropertyDescriptor(MethodMadeReadOnly.prototype, "method")!.writable; });
everyStore("the method made read-only", () => new MethodMadeReadOnly());

class Declares { first = 1; free: unknown = "declared"; method() { return "declared"; } }
Object.defineProperty(Declares.prototype, "free", { value: "read only", writable: false, configurable: true });
everyStore("the class declares the name", () => new Declares());

class StoresInConstructor {
  declare free: unknown;
  first = 1;
  constructor() { this.free = "stored"; }
  method() { return "declared"; }
}
say("a constructor's store before", () => own(new StoresInConstructor()));
say("define under a constructor's store", () => { Object.defineProperty(StoresInConstructor.prototype, "free", { value: "read only", writable: false, configurable: true }); return 1; });
say("a constructor's store", () => own(new StoresInConstructor()));

class Bare { first = 1; }
everyStore("before a class without methods has it", () => new Bare());
Object.defineProperty(Bare.prototype, "free", { value: "read only", writable: false, configurable: true });
Object.defineProperty(Bare.prototype, "method", { value: () => "read only" });
everyStore("a class without methods has it", () => new Bare());

class BareText { first = 1; }
Object.defineProperty(BareText.prototype, "free", { value: "read only" });
everyStore("without methods: a text", () => new BareText());
class BareNumber { first = 1; }
Object.defineProperty(BareNumber.prototype, "free", { value: 7 });
everyStore("without methods: a number", () => new BareNumber());
class BareFunction { first = 1; }
Object.defineProperty(BareFunction.prototype, "free", { value: () => 1 });
everyStore("without methods: a function", () => new BareFunction());
class BareObject { first = 1; }
Object.defineProperty(BareObject.prototype, "free", { value: { a: 1 } });
everyStore("without methods: an object", () => new BareObject());
class BareNull { first = 1; }
Object.defineProperty(BareNull.prototype, "free", { value: null });
everyStore("without methods: null", () => new BareNull());
class BareUndefined { first = 1; }
Object.defineProperty(BareUndefined.prototype, "free", {});
everyStore("without methods: undefined", () => new BareUndefined());
class BareAgain { first = 1; }
Object.defineProperty(BareAgain.prototype, "free", { value: "read only", configurable: true });
Object.defineProperty(BareAgain.prototype, "free", { writable: true });
everyStore("without methods: writable again", () => new BareAgain());
class BareFrozen { first = 1; }
(BareFrozen.prototype as any).free = "was writable";
Object.freeze(BareFrozen.prototype);
everyStore("without methods: frozen", () => new BareFrozen());

const mark = Symbol("mark");
class BySymbol { first = 1; }
Object.defineProperty(BySymbol.prototype, mark, { value: "read only" });
Object.defineProperty(BySymbol.prototype, "0", { value: "read only" });
for (let round = 0; round < 2; round++) {
  say("symbol " + round, () => { const c: any = new BySymbol(); c[mark] = 4; return [own(c), c[mark]]; });
  say("symbol assign " + round, () => { const c: any = new BySymbol(); Object.assign(c, { [mark]: 4 }); return [own(c), c[mark]]; });
  say("index " + round, () => { const c: any = new BySymbol(); c[0] = 4; return [own(c), c[0]]; });
  say("index assign " + round, () => { const c: any = new BySymbol(); Object.assign(c, { 0: 4 }); return [own(c), c[0]]; });
  say("sloppy symbol " + round, () => { const c = new BySymbol(); return [sloppy.storeByKey(c, mark, 4), own(c)]; });
  say("sloppy index " + round, () => { const c = new BySymbol(); return [sloppy.storeByKey(c, 0, 4), own(c)]; });
}

interface Point { x: number; y: number; }
const parent = Object.defineProperty({}, "free", { value: "read only" });
for (let round = 0; round < 2; round++) {
  say("record under a parent " + round, () => { const p: Point = { x: 1, y: 2 }; Object.setPrototypeOf(p, parent); (p as any).free = 4; return [own(p), (p as any).free]; });
  say("record under a parent, assign " + round, () => { const p: Point = { x: 1, y: 2 }; Object.setPrototypeOf(p, parent); Object.assign(p, { free: 4 }); return [own(p), (p as any).free]; });
  say("created under a parent " + round, () => { const p = Object.create(parent); p.free = 4; return [own(p), p.free]; });
}
say("the log", () => log);
console.log(lines.join("\n"));
