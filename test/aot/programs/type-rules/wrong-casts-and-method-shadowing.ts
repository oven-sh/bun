// Casts to the wrong type, and an own property with the name of a method.
const log: string[] = []
function note<T>(what: string, value: T): T { log.push(what); return value }
function flush(): string { return log.splice(0).join() }
try { const notCallable = { f: 1 as unknown as (x: number) => number }; console.log(notCallable.f(note("d", 1))); console.log("a number as a function: no error") } catch (e) { console.log("a number as a function:", e instanceof TypeError ? "TypeError" : "other " + e, "[" + flush() + "]") }
function pushTo(a: number[]): unknown { return a.push(note("arg", 7)) }
function getFrom(m: Map<string, string>): unknown { return m.get(((m as any).get = () => "new", "k")) }
try { const fakeArray = { get push() { log.push("get push"); return (x: number) => 100 + x } } as unknown as number[]; console.log(pushTo(fakeArray)); console.log("an object as an array: no error") } catch (e) { console.log("an object as an array:", e instanceof TypeError ? "TypeError" : "other " + e, "[" + flush() + "]") }
try { const fakeMap = { get: (k: string) => "old " + k } as unknown as Map<string, string>; console.log(getFrom(fakeMap)); console.log("an object as a Map: no error") } catch (e) { console.log("an object as a Map:", e instanceof TypeError ? "TypeError" : "other " + e) }
// The receiver is tested in front of a resolved built-in method, so an own property shadows the method, as in ECMAScript.
// A receiver that comes out of an `any[]` is untyped: by name.
const real = new Map([["k", "real"]])
const untyped: any[] = []; untyped.push(real)
console.log(getFrom(real), real.get("k"), untyped[0].get("k"))
abstract class Shape { abstract area(scale: number): string }
class Square extends Shape { area(scale: number): string { return "square" + scale } }
class Circle extends Shape { area(scale: number): string { return "circle" + scale } }
function retarget(s: Shape): number { (s as any).area = () => "own"; return 2 }
const shapes: Shape[] = [new Square(), new Circle(), new Square()]
for (const s of shapes) {
  try { console.log(s.area(retarget(s))); console.log("own property named like a method: no error") } catch (e) { console.log("own property named like a method:", e instanceof TypeError ? "TypeError" : "other " + e, s.area(3)) }
}
