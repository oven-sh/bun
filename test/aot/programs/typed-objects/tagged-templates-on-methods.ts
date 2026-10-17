// Methods called as template tags, including methods that the program replaces.
const log: string[] = []
function note<T>(what: string, value: T): T { log.push(what); return value }
function flush(): string { return log.splice(0).join() }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Runner { n = 1; go(s: TemplateStringsArray, x: number): string { return "orig" + s.length + x + this.n } }
// `go` is visibly replaced (patchClass), so it is called by name and an object may have its own. A method that only untyped code replaces, and a value that is cast to an array but is not one: type-rules/same-errors-in-tagged-template.
function patchOwn(r: Runner): number { (r as any).go = () => "own"; return 5 }
function patchClass(): number { Runner.prototype.go = function () { return "class" }; return 6 }
const r1 = new Runner(), r2 = new Runner()
console.log(r1.go`a${patchOwn(r1)}b`, r1.go`a${0}b`, r2.go`${note("x", 3)}`, flush())
function inTry(r: Runner | undefined): string { try { return r!.go`${note("y", 4)}` } catch (e) { return (e as Error).constructor.name + "[" + flush() + "]" } }
console.log(inTry(new Runner()), flush(), inTry(undefined))
const list: unknown[] = []
function pushTo(a: unknown[]): unknown { return a.push`${note("arg", 7)}` }
console.log(pushTo(list), list.length, flush())
let text: string | undefined = "ab"
function joined(): unknown { return (text!.concat as any)`${note("t", 1)}` }
console.log(joined(), flush(), (text = undefined, attempt(joined)), "[" + flush() + "]")
console.log(("xy".concat as any)`${note("u", 2)}`, flush(), (Math.max as any)`${note("m", 2)}`, flush())
abstract class Shape { abstract area(s: TemplateStringsArray, scale: number): string }
class Square extends Shape { area(s: TemplateStringsArray, scale: number): string { return "square" + scale } }
class Circle extends Shape { area(s: TemplateStringsArray, scale: number): string { return "circle" + scale } }
function retarget(s: Shape): number { (s as any).extra = () => "own"; return 2 }
const shapes: Shape[] = [new Square(), new Circle(), new Square()]
console.log(shapes.map(s => s.area`${retarget(s)}` + "/" + s.area`${3}`).join())
console.log(r2.go`${patchClass()}`, r2.go`${0}`, new Runner().go`${0}`, r1.go`${0}`)
let total = 0
const hot = new Square()
for (let i = 0; i < 20000; i++) total += hot.area`${i % 7}`.length
console.log(total)
