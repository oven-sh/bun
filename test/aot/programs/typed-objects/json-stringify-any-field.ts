interface A { i: number; d: number; s: string; t: boolean; n: null; o?: string; p?: number; child?: A | null; list?: A[] }
interface B { kind: "b"; x: number; y: number }
interface C { kind: "c"; label: string }
interface Odd { "quo\"te": number; "back\\slash": number; "tab\there": number; plain: number }
interface Wide { "ключ": number; plain: string }
interface Big { f00: number; f01: number; f02: number; f03: number; f04: number; f05: number; f06: number; f07: number; f08: number; f09: number; f10: string; f11: string; f12: string; f13: string; f14: string; f15: string; f16: boolean; f17: boolean; f18: null; f19: number; f20?: number; f21?: string; f22?: number; f23?: string }
class Point { #hidden = 5; constructor(public x: number, public y: number) {} get sum() { return this.x + this.y + this.#hidden; } norm() { return 0; } static made = 1; }
class Point3 extends Point { z = 3; }
class Jsonable { v = 1; toJSON() { return { from: "toJSON", v: this.v }; } }
class OwnToJSON { toJSON: unknown; v = 2; constructor(f: unknown) { this.toJSON = f; } }
let count = 0;
function show(name: string, make: () => unknown, ...rest: [unknown?, unknown?]) {
  let out: string;
  try { out = String(JSON.stringify(make(), rest[0] as any, rest[1] as any)); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const a = (i: number): A => ({ i, d: i + 0.5, s: "s" + i, t: (i & 1) === 1, n: null });
show("every kind of field", () => a(1));
show("negative, zero, large, not an int32", () => [{ ...a(0), i: -1 }, { ...a(0), i: 0 }, { ...a(0), i: 2147483647 }, { ...a(0), i: 2147483648 }, { ...a(0), i: -2147483648 }, { ...a(0), i: 1e21 }] as A[]);
show("-0, NaN, Infinity in a number field", () => [{ ...a(0), d: -0 }, { ...a(0), d: NaN }, { ...a(0), d: Infinity }, { ...a(0), i: -0 }, { ...a(0), i: NaN }] as A[]);
show("optional fields absent, one, both, in either order", () => { const w = a(1), x = a(2), y = a(3), z = a(4); x.o = "o"; y.o = "o"; y.p = 1; z.p = 1; z.o = "o"; return [w, x, y, z]; });
show("optional field set to undefined", () => { const x = a(1); x.o = undefined; x.p = 2; return x; });
show("optional field deleted", () => { const x = a(1); x.o = "o"; x.p = 2; delete x.o; return x; });
show("nested", () => { const x = a(1); x.child = a(2); x.child.child = a(3); x.child.child.child = null; return x; });
show("a list of one shape", () => { const x = a(0); x.list = [a(1), a(2), a(3), a(4)]; return x; });
show("shapes in turn", () => [{ kind: "b", x: 1, y: 2 } as B, { kind: "c", label: "l" } as C, { kind: "b", x: 3, y: 4 } as B, { kind: "c", label: "m" } as C, a(1), { kind: "b", x: 5, y: 6 } as B]);
show("one shape, orders in turn", () => { const out: A[] = []; for (let i = 0; i < 6; i++) { const x = a(i); if (i & 1) { x.o = "o"; x.p = i; } else { x.p = i; x.o = "o"; } out.push(x); } return out; });
show("typed and plain in turn", () => [a(1), JSON.parse('{"i":1,"z":2}'), a(2), {}, a(3), [], a(4)]);
show("strings that need escaping", () => [{ ...a(0), s: 'q"uote' }, { ...a(0), s: "back\\slash" }, { ...a(0), s: "new\nline" }, { ...a(0), s: "\u0001" }, { ...a(0), s: "\u007f" }, { ...a(0), s: "é" }] as A[]);
show("16-bit strings, lone surrogates", () => [{ ...a(0), s: "значение" }, { ...a(0), s: "\ud800" }, { ...a(0), s: "😀" }] as A[]);
show("a long string, a rope, an empty string", () => [{ ...a(0), s: "x".repeat(200) }, { ...a(0), s: "left".repeat(10) + String(count) + "right".repeat(10) }, { ...a(0), s: "" }] as A[]);
show("field names that need escaping", () => ({ 'quo"te': 1, "back\\slash": 2, "tab\there": 3, plain: 4 }) as Odd);
show("a 16-bit field name", () => ({ "ключ": 1, plain: "p" }) as Wide);
show("many fields", () => ({ f00: 0, f01: 1, f02: 2, f03: 3, f04: 4, f05: 5, f06: 6, f07: 7, f08: 8, f09: 9, f10: "a", f11: "b", f12: "c", f13: "d", f14: "e", f15: "f", f16: true, f17: false, f18: null, f19: 19.5 }) as Big);
show("many fields, the optional ones in another order", () => { const b: Big = { f00: 0, f01: 1, f02: 2, f03: 3, f04: 4, f05: 5, f06: 6, f07: 7, f08: 8, f09: 9, f10: "a", f11: "b", f12: "c", f13: "d", f14: "e", f15: "f", f16: true, f17: false, f18: null, f19: 19.5 }; b.f23 = "z"; b.f20 = 20; b.f22 = 22; b.f21 = "y"; return b; });
show("a class instance: private field, accessor, method, static", () => new Point(1, 2));
show("instances of a class and its heir in turn", () => [new Point(1, 2), new Point3(3, 4), new Point(5, 6), new Point3(7, 8)]);
show("a class with toJSON among others", () => [new Point(1, 2), new Jsonable(), new Point(3, 4)]);
show("an own field toJSON: callable, not callable", () => [new OwnToJSON(() => "called"), new OwnToJSON(5), new OwnToJSON(undefined)]);
show("a field that holds a function, a symbol", () => [{ v: 1, f: () => 1 }, { v: 2, f: Symbol("s") }] as { v: number; f: unknown }[]);
show("a field that holds a bigint", () => ({ v: 1, f: 1n }) as { v: number; f: unknown });
show("frozen, sealed, not extensible", () => [Object.freeze(a(1)), Object.seal(a(2)), Object.preventExtensions(a(3))]);
show("the same object twice", () => { const x = a(1); return [x, x, { x }]; });
show("a cycle", () => { const x = a(1); x.child = x; return x; });
show("indent 2", () => { const x = a(1); x.list = [a(2)]; return x; }, undefined, 2);
show("replacer list", () => a(1), ["s", "i"]);
show("replacer function", () => a(1), (k: string, v: unknown) => (k === "d" ? undefined : v));
show("longer than the first buffer", () => { const x = a(0); x.list = []; for (let i = 0; i < 300; i++) x.list.push(a(i)); const text = JSON.stringify(x); return text.length + " " + text.slice(8180, 8210) + " " + text.slice(-40); });
show("longer than the first buffer, 16-bit at the end", () => { const x = a(0); x.list = []; for (let i = 0; i < 300; i++) x.list.push(a(i)); x.list[299]!.s = "конец"; const text = JSON.stringify(x); return text.length + " " + text.slice(-60); });
show("exactly at the buffer's edge", () => { const out: number[] = []; for (let n = 8150; n < 8200; n++) { const x = a(1); x.s = "y".repeat(n - 50); out.push(JSON.stringify([x, a(2)]).length); } return out.join(); });
