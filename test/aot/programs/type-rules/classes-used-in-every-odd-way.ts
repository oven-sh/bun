// Classes called without `new`, constructors that return other objects, subclasses of built-ins, methods taken off, brands.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y } sum(): number { return this.x + this.y } static origin(): Point { return new Point(0, 0) } }
class Returns { v = 1; constructor(other?: object) { if (other) return other as Returns } }
class List extends Array<number> { total(): number { let s = 0; for (const x of this) s += x; return s } }
class Fault extends Error { code = 7; constructor(m: string) { super(m); this.name = "Fault" } }
class Table extends Map<string, number> { sum(): number { let s = 0; for (const v of this.values()) s += v; return s } }
row("a class called without new", () => hide(Point)(1, 2));
row("a constructor that returns another object", () => { const o = { v: 9 }; const r = new Returns(o); return r.v + " " + ((r as unknown) === o) + " " + (r instanceof Returns) });
row("Reflect.construct with another new.target", () => { class Other { } const p = Reflect.construct(Point, [1, 2], Other); return hide(p).x + " " + (p instanceof Point) + " " + (p instanceof Other) });
row("a method taken off and called on plain data", () => Point.prototype.sum.call(hide({ x: 3, y: 4 })));
row("a method taken off and called on nothing", () => hide(Point.prototype.sum)());
row("extends Array", () => { const l = new List(); l.push(1, 2, 3); return l.total() + " " + l.length + " " + (l.map(x => x) instanceof List) + " " + Array.isArray(l) });
row("extends Error", () => { const f = new Fault("m"); return f.name + " " + f.message + " " + f.code + " " + (f instanceof Error) + " " + String(f) + " " + typeof f.stack });
row("extends Map", () => { const t = new Table([["a", 1], ["b", 2]]); return t.sum() + " " + t.size + " " + (t instanceof Map) });
row("Symbol.hasInstance", () => { class Even { static [Symbol.hasInstance](n: unknown): boolean { return typeof n === "number" && n % 2 === 0 } } return (hide(2) instanceof Even) + " " + (hide(3) instanceof Even) });
row("an extra property on an instance", () => { const p = new Point(1, 2); hide(p).z = 3; return Object.keys(p).join() + " " + JSON.stringify(p) });
row("a field deleted from an instance", () => { const p = new Point(1, 2); const was = delete hide(p).x; return was + " " + Object.keys(p).join() + " " + p.sum() });
row("private names and brands", () => { class Safe { #v = 1; static has(o: unknown): boolean { return typeof o === "object" && o !== null && #v in o } get(): number { return this.#v } } return Safe.has(new Safe()) + " " + Safe.has({}) + " " + (() => { try { return Safe.prototype.get.call(hide({})) } catch (e) { return (e as Error).name } })() });
row("the class as a value", () => { const C: any = hide(Point); return typeof C + " " + C.name + " " + C.length + " " + Object.getOwnPropertyNames(C.prototype).join() + " " + new C(1, 2).sum() + " " + C.origin().sum() });
row("toString of a class and of a function", () => { function f(a: number): number { return a } return String(f).replace(/\s+/g, " ").slice(0, 12) + " " + String(Point).slice(0, 11) });
