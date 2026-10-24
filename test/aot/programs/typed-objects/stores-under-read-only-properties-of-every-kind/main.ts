// Stores onto instances of typed classes under a read-only property of every kind of value, on the class's own prototype and on the one above; a method made read-only; a frozen and a sealed prototype above;
// by name, by key, by Object.assign, Reflect.set, spread and definition; from strict and from sloppy code.
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
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
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

const everyKind: [string, unknown][] = [["text", "read only"], ["number", 7], ["function", () => 1], ["object", { a: 1 }], ["null", null], ["undefined", undefined], ["true", true]];
class KindsAbove { zero = 0; method() { return "declared"; } }
class Kinds extends KindsAbove { first = 1; other() { return "other"; } }
for (const [kind, value] of everyKind) {
  Object.defineProperty(Kinds.prototype, "free", { value, writable: false, configurable: true });
  everyStore("read-only " + kind, () => new Kinds());
  delete (Kinds.prototype as any).free;
  Object.defineProperty(KindsAbove.prototype, "free", { value, writable: false, configurable: true });
  everyStore("read-only above " + kind, () => new Kinds());
  delete (KindsAbove.prototype as any).free;
}
everyStore("every kind deleted", () => new Kinds());
say("writable again", () => { Object.defineProperty(KindsAbove.prototype, "free", { value: 1, writable: false, configurable: true }); Object.defineProperty(KindsAbove.prototype, "free", { writable: true }); return 1; });
everyStore("writable again", () => new Kinds());
say("the method above made read-only", () => { Object.defineProperty(KindsAbove.prototype, "method", { writable: false }); return 1; });
everyStore("the method above made read-only", () => new Kinds());

class FrozenAbove { zero = 0; method() { return "declared"; } }
class FrozenBelow extends FrozenAbove { first = 1; }
everyStore("before the class above is frozen", () => new FrozenBelow());
say("freeze the class above", () => Object.isFrozen(Object.freeze(FrozenAbove.prototype)));
everyStore("only the class above is frozen", () => new FrozenBelow());
say("what the frozen prototype shows", () => [own(FrozenAbove.prototype), Object.getOwnPropertySymbols(FrozenAbove.prototype).length, Object.isSealed(FrozenAbove.prototype), JSON.stringify(Object.getOwnPropertyDescriptors(FrozenAbove.prototype))]);
everyStore("a plain heir of the frozen prototype", () => Object.create(FrozenAbove.prototype));

class SealedAbove { zero = 0; method() { return "declared"; } }
class SealedBelow extends SealedAbove { first = 1; }
say("seal the class above", () => [Object.isSealed(Object.seal(SealedAbove.prototype)), Object.isFrozen(SealedAbove.prototype)]);
everyStore("the class above is sealed", () => new SealedBelow());

say("the log", () => log);
console.log(lines.join("\n"));
