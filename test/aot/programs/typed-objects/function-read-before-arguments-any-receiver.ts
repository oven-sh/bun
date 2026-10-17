// In a method call the function is read before the arguments are evaluated, for every kind of receiver, including undefined, null and non-callable values.
const log: string[] = []
function note<T>(what: string, value: T): T { log.push(what); return value }
function flush(): string { return log.splice(0).join() }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
// `undefined` and `null`: the read throws, and the arguments are not evaluated.
let missingArray: number[] | undefined, missingText: string | null = null
class Box { v = 1; get(x: number): number { return this.v + x } }
let missingBox: Box | undefined
function unset(): void { missingArray = undefined; missingText = null; missingBox = undefined }
unset()
console.log(attempt(() => missingArray!.push(note("a", 1))), attempt(() => missingText!.charAt(note("b", 1))), attempt(() => missingBox!.get(note("c", 1))), "[" + flush() + "]")
// A value that is not callable: the arguments are evaluated, then the call throws.
const notCallable: { f: any } = { f: 1 }
console.log(attempt(() => notCallable.f(note("d", 1))), flush())
// A getter runs before the arguments.
const withGetter = { get f() { log.push("get"); return (x: number) => x * 2 } }
console.log(withGetter.f(note("arg", 4)), flush())
class Getting { get f(): (x: number) => number { log.push("get"); return x => x * 3 } }
console.log(new Getting().f(note("arg", 4)), flush())
// A value that is cast to an array, a map or a function but is not one: type-rules/wrong-casts-and-method-shadowing.
function pushTo(a: number[]): unknown { return a.push(note("arg", 7)) }
function getFrom(m: Map<string, string>): unknown { return m.get(((m as any).get = () => "new", "k")) }
console.log(pushTo([1, 2]), flush(), getFrom(new Map([["k", "real"]]) ) === "real" || "patched")
// Several classes with one common type.
abstract class Shape { abstract area(scale: number): string }
class Square extends Shape { area(scale: number): string { return "square" + scale } }
class Circle extends Shape { area(scale: number): string { return "circle" + scale } }
function retarget(s: Shape): number { (s as any).extra = () => "own"; return 2 }
const shapes: Shape[] = [new Square(), new Circle(), new Square()]
console.log(shapes.map(s => s.area(retarget(s)) + "/" + s.area(3)).join())
// In `try`, where every step is watched.
function guardedCall(b: Box | undefined): string { try { return "ok" + b!.get(note("e", 5)) } catch (e) { return (e as Error).constructor.name + flush() } }
console.log(guardedCall(new Box()), flush(), guardedCall(undefined))
// Parentheses keep `this`, and end an optional chain.
const counter = { n: 0, bump() { return ++this.n } }
const maybe: { c?: typeof counter } = {}
console.log((counter.bump)(), (counter["bump"])(), attempt(() => (0, counter.bump)()), attempt(() => (maybe.c?.bump)!()), (maybe.c?.bump)?.(), ((maybe.c = counter), (maybe.c?.bump)()), counter.n)
// Nested calls, and a receiver that an argument replaces.
let holder = new Box()
function swap(): number { holder = Object.assign(new Box(), { v: 100 }); return 1 }
console.log(holder.get(swap()), holder.get(holder.get(holder.get(1))))
let total = 0
for (let i = 0; i < 20000; i++) total += holder.get(holder.v) + "abc".charCodeAt(holder.v % 3) + [i].indexOf(holder.v)
console.log(total)
