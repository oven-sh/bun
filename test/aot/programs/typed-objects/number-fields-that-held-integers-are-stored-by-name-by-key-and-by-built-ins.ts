// Fields declared `number` that have held integers alone get fractions, 2 ** 40, -0, NaN, 1e300, a text and null: by a constant key through `any`, by a computed key, Object.assign, Reflect.set, defineProperty, a walk over the keys, `++` past the largest int32, and a product.
class C { n: number = 0; m: number = 1; constructor(public k: number) {} }
const c = new C(3);
c.n = 5; console.log(c.n + c.m + c.k);
const any: any = c;
any["n"] = 1.5; console.log(c.n, c.n * 2);
Object.assign(c, { m: 2 ** 40 }); console.log(c.m, c.m + 1);
Reflect.set(c, "k", -0); console.log(Object.is(c.k, -0), 1 / c.k);
const key = ["n", "m"][Date.now() > 0 ? 0 : 1]; any[key] = NaN; console.log(c.n, c.n === c.n);
Object.defineProperty(c, "m", { value: 0.25, writable: true, enumerable: true, configurable: true }); console.log(c.m * 4);
for (const k of Object.keys(c)) any[k] = 1e300; console.log(c.n, c.m, c.k);
const d = new C(2147483647); d.k++; console.log(d.k); d.k += 0.5; console.log(d.k);
const e = Object.assign(new C(1), JSON.parse('{"n":1.25,"m":"str","k":null}')); console.log(e.n, e.m, e.k, typeof e.m);
function bump(o: C) { o.n = o.n * 1000000; return o.n; } const f = new C(0); f.n = 2000000; console.log(bump(f), bump(f));
