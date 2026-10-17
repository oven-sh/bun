// Built-in and user-defined methods called as template tags, after attempts to replace them.
const log: string[] = []
function note<T>(what: string, value: T): T { log.push(what); return value }
function flush(): string { return log.splice(0).join() }
function pushTo(a: unknown[]): unknown { return a.push`${note("arg", 7)}` }
try { const fake = { get push() { log.push("get push"); return (s: unknown, x: number) => 100 + x } } as unknown as unknown[]; console.log(pushTo(fake)); console.log("an object as an array: no error") } catch (e) { console.log("an object as an array:", e instanceof TypeError ? "TypeError" : "other " + e, "[" + flush() + "]") }
abstract class Shape { abstract area(s: TemplateStringsArray, scale: number): string }
class Square extends Shape { area(s: TemplateStringsArray, scale: number): string { return "square" + scale } }
class Circle extends Shape { area(s: TemplateStringsArray, scale: number): string { return "circle" + scale } }
function retarget(s: Shape): number { (s as any).area = () => "own"; return 2 }
const shapes: Shape[] = [new Square(), new Circle(), new Square()]
for (const s of shapes) {
  try { console.log(s.area`${retarget(s)}`); console.log("own property named like a method: no error") } catch (e) { console.log("own property named like a method:", e instanceof TypeError ? "TypeError" : "other " + e, s.area`${3}`) }
}
