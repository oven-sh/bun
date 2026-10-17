// Object.defineProperty() in typed code whose descriptor is a literal on one branch and another value on the other branch: the descriptor has the type PropertyDescriptor, the target a written or a generic type.
const lines: string[] = [];
function show(object: object): string { return Reflect.ownKeys(object).map(key => { const d = Object.getOwnPropertyDescriptor(object, key)!; return String(key) + ":" + ("value" in d ? "v" + String(d.value) : (d.get ? "g" + String(d.get.call(object)) : "-") + (d.set ? "s" : "")) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(" "); }
function bind(target: object, from: Record<string, unknown>, key: string, as: string = key): void {
  let descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(from, key);
  if (!descriptor || descriptor.writable || descriptor.configurable) descriptor = { enumerable: true, get: (): unknown => from[key] };
  Object.defineProperty(target, as, descriptor);
}
function either<T extends object>(target: T, key: string, given?: PropertyDescriptor): T { let d: PropertyDescriptor; if (given) d = given; else d = { value: key + "!", writable: true }; Object.defineProperty(target, key, d); return target; }
function byFlag(target: { a: number }, key: string, flag: boolean): boolean { const d: PropertyDescriptor = flag ? { value: 1, enumerable: true } : { value: 2, configurable: true }; return Object.defineProperty(target, key, d) === target; }
function threeWays(target: object, which: number): object { let d: PropertyDescriptor; if (which === 0) d = { value: "zero" }; else if (which === 1) d = { get: (): string => "one", enumerable: true }; else d = { value: "two", writable: true, enumerable: true, configurable: true }; Object.defineProperty(target, "k" + which, d); return target; }
function seenAgain(target: object, flag: boolean): string { let d: PropertyDescriptor; if (flag) d = { value: "literal", enumerable: true }; else d = { value: "other" }; Object.defineProperty(target, "k", d); d.value = "changed later"; return show(target) + " " + String(d.value); }
function throwing(target: object, flag: boolean): string { let d: PropertyDescriptor; if (flag) d = { value: 1, get: (): number => 2 }; else d = { value: 3 }; try { Object.defineProperty(target, "t", d); return "defined"; } catch (error) { return (error as Error).constructor.name; } }
class Holder { kept = 1; }
const plain: Record<string, unknown> = { a: 1, b: "two" };
const fixed: Record<string, unknown> = Object.freeze({ f: "fixed" });
const out = {}; bind(out, plain, "a"); bind(out, plain, "b", "renamed"); bind(out, plain, "missing"); bind(out, fixed, "f");
lines.push(show(out)); plain.a = 7; lines.push(show(out));
lines.push(show(either(either({}, "x"), "y", { get: (): string => "got", configurable: true })));
const both = { a: 0 }; lines.push(byFlag(both, "p", true) + " " + byFlag(both, "q", false) + " " + show(both));
lines.push(show(threeWays(threeWays(threeWays({}, 0), 1), 2)));
lines.push(show(either(new Holder(), "added")) + " | " + show(threeWays(new Holder(), 1)));
lines.push(seenAgain({}, true) + " | " + seenAgain({}, false));
lines.push(throwing({}, true) + " " + throwing({}, false) + " " + throwing(Object.freeze({}), false));
let sum = 0; for (let i = 0; i < 3000; i++) { const made = either({ n: i }, "extra", i % 3 ? undefined : { value: i, enumerable: true }); sum += made.n + Object.keys(made).length; } lines.push(String(sum));
console.log(lines.join("\n"));
