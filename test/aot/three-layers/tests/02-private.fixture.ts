import { check } from "../src/show";
import { Shape } from "fake-shapes";
import { Temperature } from "fake-typed";
import { Fever, Square } from "../src/models";
const F = "02";
class Local extends Fever { #own = 1; static has(v: object) { return #own in v; } bump() { return ++this.#own; } }
check(F, "brand checks", () => { const l = new Local(40), t = new Temperature(40), f = new Fever(39); return [Temperature.is(l), Temperature.is(t), Temperature.is({}), Local.has(l), Local.has(t), Local.has(f), Temperature.same(l, t), Temperature.same(l, f), Shape.isShape(new Square("s", 1)), Shape.isShape(l)]; });
check(F, "private through accessors", () => { const l = new Local(100); const f = l.fahrenheit; l.fahrenheit = 32; return [f, l.fahrenheit, +l, l.isHigh(), l.bump(), l.bump(), `${l.valueOf()}`]; });
check(F, "a private of the wrong object throws", () => Temperature.same(new Temperature(1), Object.create(Temperature.prototype)));
check(F, "a getter on a bare prototype throws", () => (Object.create(Shape.prototype) as Shape).id);
check(F, "own keys hide privates", () => [Reflect.ownKeys(new Local(1)), Reflect.ownKeys(new Square("s", 2)), JSON.stringify(new Local(5))]);
check(F, "static private count moves", () => { const before = Temperature.made; new Local(1); new Fever(2); return Temperature.made - before; });
check(F, "a proxy has no privates", () => { const p = new Proxy(new Temperature(3), {}); return [Temperature.is(p), (() => { try { return p.fahrenheit; } catch (e) { return (e as Error).name; } })()]; });
