interface T { n: number; i: number; s: string; b: boolean; o?: number; u: number | string; nul: string | null; und?: string; big: bigint; lit: "x" | "y"; inner: { v: number } }
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
class Box { readonly fixed = 1; count = 0; label = "l"; #hidden = 1; set viaSetter(v: number) { this.count = v * 2; } get viaSetter() { return this.count; } peek() { return this.#hidden; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => (v === undefined ? "undefined" : typeof v === "bigint" ? "bigint " + v : typeof v === "number" && (v !== v || Object.is(v, -0) || !isFinite(v)) ? "number " + (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "symbol" ? "symbol" : v)); } catch (e) { out = "THROWN " + (e as Error).name; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const make = (): T => ({ n: 1.5, i: 1, s: "s", b: true, u: 1, nul: null, big: 1n, lit: "x", inner: { v: 1 } });
const ways: Record<string, (x: any, k: any, v: any) => unknown> = {
  key: (x, k, v) => { x[k] = v; return true; },
  reflect: (x, k, v) => Reflect.set(x, k, v),
  assign: (x, k, v) => { const p = JSON.parse("{}"); p[k] = v; Object.assign(x, p); return true; },
  define: (x, k, v) => { Object.defineProperty(x, k, { value: v }); return true; },
};
function each(k: string, values: unknown[]) {
  const out: unknown[] = [];
  for (const [name, way] of Object.entries(ways)) for (const v of values) {
    const x = make(); let said: unknown;
    try { said = way(x, k, v); } catch (e) { said = (e as Error).name; }
    out.push([name, said, hide(x)[k], Object.keys(x).join()]);
  }
  return out;
}
show("a double field takes numbers", () => each("n", [2.5, 3, -0, NaN, Infinity, 2147483648, -2147483649]));
show("an integer-looking field takes numbers", () => each("i", [2, 2.5, -0, NaN, 4294967296]));
show("a string field takes strings", () => each("s", ["t", "", "a" + "b", "x".repeat(300)]));
show("a boolean field", () => each("b", [false, true]));
show("a union field changes kind", () => each("u", [2, "two", 2.5, "", 3]));
show("null and a string", () => each("nul", ["set", null, "again"]));
show("a bigint field", () => each("big", [2n, 0n, 123456789012345678901234567890n]));
show("a literal union", () => each("lit", ["y", "x"]));
show("an optional field that is absent", () => each("o", [1, undefined, 2.5]));
show("an optional field: undefined, then a value, then deleted, then a value", () => Object.values(ways).map(way => { const x = make(); const out: unknown[] = []; try { for (const v of [undefined, "a", "b"]) { way(x, "und", v); out.push(x.und, Object.keys(x).join()); } delete x.und; way(x, "und", "c"); out.push(x.und, Object.keys(x).join()); } catch (e) { out.push((e as Error).name); } return out; }));
show("typed code sees what untyped code stored", () => { const x = make(); hide(x)["n"] = 9.5; Reflect.set(x, "s", "seen"); Object.assign(x, JSON.parse('{"i":7,"b":false}')); return [x.n + 1, x.s.length, x.i * 2, !x.b]; });
show("many stores at one site", () => { const x = make(); const k = ["n", "i", "s", "u"]; for (let i = 0; i < 200; i++) hide(x)[k[i & 3]] = (i & 3) === 2 ? "s" + i : i + 0.5; return x; });
show("a name that is no field", () => each("extra", [1, "a", undefined]));
show("frozen, sealed, closed", () => [Object.freeze, Object.seal, Object.preventExtensions].map(f => Object.entries(ways).map(([name, way]) => { const x = f(make()) as T; let said: unknown; try { said = way(x, "n", 7.5); } catch (e) { said = (e as Error).name; } return [name, said, x.n]; })));
show("with extras", () => Object.entries(ways).map(([name, way]) => { const x = make(); hide(x).zz = 1; way(x, "n", 7.5); way(x, "zz", 2); return [name, x.n, hide(x).zz, Object.keys(x).join()]; }));
show("another prototype with a setter of a field's name", () => Object.entries(ways).map(([name, way]) => { const log: unknown[] = []; const proto = Object.defineProperty(JSON.parse("{}"), "o", { set(v) { log.push(v); }, configurable: true }); const x = Object.setPrototypeOf(hide(make()), proto); let said: unknown; try { said = way(x, "o", 5); way(x, "n", 6.5); } catch (e) { said = (e as Error).name; } return [name, said, log, x.n, Object.keys(x).join()]; }));
show("a receiver that is another object", () => { const x = make(), other = JSON.parse("{}"); return [Reflect.set(x, "n", 8.5, other), x.n, other]; });
show("an instance: a field, a setter, a method's name", () => Object.entries(ways).filter(([name]) => name !== "define").map(([name, way]) => { const x = new Box(); const out: unknown[] = [name]; for (const [k, v] of [["count", 5], ["label", "m"], ["viaSetter", 4]] as [string, unknown][]) { try { out.push(way(x, k, v)); } catch (e) { out.push((e as Error).name); } } out.push(x.count, x.label, x.peek()); return out; }));
show("a discriminant keeps its value", () => Object.entries(ways).map(([name, way]) => { const x: Shape = { kind: "circle", r: 1 }; let said: unknown; try { said = way(x, "kind", "circle"); way(x, "r", 2.5); } catch (e) { said = (e as Error).name; } return [name, said, x]; }));
show("symbols and indices as keys", () => Object.entries(ways).filter(([name]) => name !== "define").map(([name, way]) => { const x = make(); const out: unknown[] = [name]; for (const k of [Symbol.for("s"), 0, "0", "1.5"]) { try { out.push(way(x, k, 1)); } catch (e) { out.push((e as Error).name); } } out.push(Object.keys(x).join(), Object.getOwnPropertySymbols(x).length); return out; }));
