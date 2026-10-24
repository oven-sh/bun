// NaNs with unusual bit patterns, read from the bytes of a buffer, are stored into every kind of typed variable and field.
const H = globalThis as unknown as { hidden: unknown; id: (...a: unknown[]) => unknown[] };
H.id = function (...a: unknown[]) { return a; };
const hide = (v: unknown): unknown => { H.hidden = v; return H.hidden; };
const one = (v: unknown): string => v === undefined ? "UNDEFINED" : v === null ? "NULL" : typeof v === "number" ? (v !== v ? "NaN" : "NUMBER " + v) : "A " + (typeof v).toUpperCase();
function say(name: string, f: () => unknown) { let r: unknown; try { r = f(); } catch (e) { r = "THREW " + (e as Error).name; } console.log(name + ": " + r); }

const f64 = new Float64Array(2), w = new Uint32Array(f64.buffer), f32 = new Float32Array(1), w32 = new Uint32Array(f32.buffer), view = new DataView(new ArrayBuffer(8));
class Q { a: number | undefined = undefined; b: number | null = null; c?: number; d: number = 0; e: number | undefined | null = 1; f: number | string = "s"; }
interface R { a: number | undefined; b: number | null; c?: number; d: number }
function opt(v: number | undefined): string { return v === undefined ? "UNDEFINED" : one(v); }
function nul(v: number | null): string { return v === null ? "NULL" : one(v); }
function both(v: number | undefined | null): string { return v == null ? "NIL" : one(v); }
function dflt(v: number = -1): string { return one(v); }
function retOpt(i: number): number | undefined { return i < 0 ? undefined : f64[i]; }
function retNull(i: number): number | null { return i < 0 ? null : f64[i]; }
function retPlain(i: number): number { return f64[i]; }
let topOpt: number | undefined = undefined, topNull: number | null = null, topPlain: number = 0;
function* gen(): Generator<number | undefined, number | undefined, number | undefined> { const sent = yield f64[0]; yield sent; return f64[0]; }

function everyPlace(read: () => number): string {
  const out: string[] = [];
  const x: number = read();
  out.push(one(x), opt(x), nul(x), both(x), dflt(x), one(hide(x)), one(H.id(x)[0]));
  const q = new Q(); q.a = x; q.b = x; q.c = x; q.d = x; q.e = x; q.f = x;
  out.push(opt(q.a), nul(q.b), opt(q.c), one(q.d), both(q.e), one(q.f), String("c" in q), Object.keys(q).join(""), JSON.stringify(q), Object.values(q).map(one).join("/"), Object.values({ ...q }).map(one).join("/"));
  const h = hide(q) as Q; out.push(opt(h.a), nul(h.b), opt(h.c), one(h.d), both(h.e));
  const r: R = { a: x, b: x, c: x, d: x }; out.push(opt(r.a), nul(r.b), opt(r.c), one(r.d), JSON.stringify(r), Object.keys(r).join(""));
  const { a = -1, c = -2 } = q; out.push(one(a), one(c));
  const { a: ra = -1, c: rc = -2 } = r; out.push(one(ra), one(rc));
  out.push(one(q.a ?? -3), one(q.b ?? -4), one(q.c ?? -5), String(q.a?.toFixed(1)), String(q.a !== undefined), String(q.b !== null), typeof q.a, typeof q.b, typeof q.c);
  topOpt = x; topNull = x; topPlain = x; out.push(opt(topOpt), nul(topNull), one(topPlain));
  const chosen: number | undefined = out.length > 0 ? x : undefined; out.push(opt(chosen), one(chosen ?? -6));
  let later: number | undefined; later = x; out.push(opt(later)); let nullable: number | null = null; nullable = x; out.push(nul(nullable));
  let captured: number | undefined = x; const see = () => opt(captured); out.push(see()); captured = undefined; out.push(see()); captured = x; out.push(see());
  const list: (number | undefined)[] = [x, undefined, x]; out.push(list.map(opt).join("/"), opt(list[0]), String(list.indexOf(undefined)), String(list.includes(undefined)), String(list.filter(v => v === undefined).length));
  const nulls: (number | null)[] = [x, null]; out.push(nulls.map(nul).join("/")); const plainList: number[] = [1.5]; plainList.push(x); plainList[0] = x; out.push(plainList.map(one).join("/"), [0, ...plainList].map(one).join("/"), (["s", ...plainList] as unknown[]).map(one).join("/"));
  const pair: [number | undefined, number | null] = [x, x]; out.push(opt(pair[0]), nul(pair[1]));
  const map = new Map<string, number | undefined>([["k", x]]); out.push(opt(map.get("k")), String(map.get("k") === undefined));
  return out.join(",");
}

function afterArithmetic(read: () => number): string {
  const x: number = read();
  const made: (number | undefined)[] = [x + 1, x - 0, x * 2, x / 2, -x, +x, Math.abs(x), -Math.abs(x), Math.min(x, 1), Math.max(x, 1), Math.fround(x), Math.sqrt(x), Math.trunc(x), Math.floor(x), Math.ceil(x), Math.round(x), Math.sign(x), x ** 1, x % 2, Number(x), Math.hypot(x), Math.cbrt(x), x + x, 0 * x, Math.min(x), Math.max(x, x)];
  const q = new Q(); let out = "";
  for (let i = 0; i < made.length; i++) { q.a = made[i]; out += opt(made[i]) === "NaN" && opt(q.a) === "NaN" ? "." : " [" + i + " " + opt(made[i]) + " " + opt(q.a) + "]"; }
  q.a = Math.abs(x); q.b = -x; q.c = x + 1; q.e = Math.abs(x) * 1;
  return out + " " + opt(q.a) + nul(q.b) + opt(q.c) + both(q.e) + opt(Math.abs(x)) + nul(-x) + dflt(Math.abs(x)) + dflt(-x);
}

const payloads: [number, number][] = [[0x7FFA0000, 0], [0x7FFB0000, 0], [0x7FFC0000, 0], [0x7FFA0000, 1], [0x7FFD0000, 0], [0x7FFE0000, 0], [0x7FFFFFFF, 0xFFFFFFFF], [0xFFFA0000, 0], [0xFFFB0000, 0], [0xFFFC0000, 0], [0x7FF80000, 0], [0x7FF80000, 1], [0x7FF90000, 0], [0x7FF00000, 1], [0x7FF20000, 0], [0x7FF30000, 0], [0x7FF40000, 0], [0xFFF20000, 0], [0xFFF80000, 0], [0xFFFE0000, 0], [0xFFFE0000, 2], [0xFFFE0000, 7], [0xFFFE0000, 10], [0xFFFE0001, 0x23456780], [0xFFFF0000, 0x12345678], [0xFFFFFFFF, 0xFFFFFFFF]];
for (const [high, low] of payloads) {
  w[0] = low; w[1] = high; f64[1] = 1.5; view.setUint32(0, high); view.setUint32(4, low);
  const name = high.toString(16) + ":" + low.toString(16);
  say(name + " an element", () => everyPlace(() => f64[0]));
  say(name + " by a view", () => everyPlace(() => view.getFloat64(0)));
  say(name + " returned", () => everyPlace(() => retPlain(0)));
  say(name + " arithmetic", () => afterArithmetic(() => f64[0]));
  say(name + " straight into the place", () => { const q = new Q(); q.a = f64[0]; q.b = f64[0]; q.c = f64[0]; q.e = view.getFloat64(0); topOpt = f64[0]; topNull = view.getFloat64(0); return [opt(q.a), nul(q.b), opt(q.c), both(q.e), opt(topOpt), nul(topNull), opt(f64[0]), nul(f64[0]), dflt(f64[0]), opt(view.getFloat64(0)), dflt(view.getFloat64(0)), opt(retOpt(0)), nul(retNull(0)), opt(retOpt(-1)), nul(retNull(-1))].join(); });
  say(name + " what may be none by its type", () => [opt(f64.at(0)), opt(f64.at(5)), opt(f64.at(-2)), one(f64.at(0) ?? -1), opt(f64.find(v => v !== v)), opt(f64.findLast(v => v !== v)), opt(f64.find(v => v === 99)), opt(Array.from(f64).pop()), opt(Array.from(f64).shift()), opt(Array.from(f64).at(0)), opt([...f64][0]), opt(Array.from(f64).find(v => v !== v))].join());
  say(name + " a generator", () => { const g = gen(); const a = g.next(), b = g.next(f64[0]), c = g.next(); return [opt(a.value), opt(b.value), opt(c.value), String(c.done)].join(); });
  say(name + " thrown", () => { try { throw f64[0]; } catch (e) { return one(e); } });
  say(name + " as text and key", () => [String(f64[0]), `${f64[0]}`, f64[0] + "", JSON.stringify([f64[0]]), JSON.stringify({ v: f64[0] }), Object.keys({ [f64[0]]: 1 })[0], String(new Set<number>([f64[0], NaN]).size), String(new Map<number, string>([[f64[0], "m"]]).get(NaN)), String(f64[0] === f64[0]), String(Object.is(f64[0], NaN)), String(Number.isNaN(f64[0])), String(isNaN(f64[0])), String(f64[0] | 0), String(f64[0] ? 1 : 0), String(!f64[0])].join());
}
for (const bits of [0x7FD00000, 0x7FD80000, 0x7FE00000, 0x7FE80000, 0x7FFFFFFF, 0xFFD00000, 0xFFD80000, 0xFFE00000, 0x7FC00000, 0x7F900000, 0x7F980000, 0x7FA00000, 0xFFF00000, 0xFFFFFFFF]) {
  w32[0] = bits; view.setUint32(0, bits);
  say("32 bits " + bits.toString(16) + " an element", () => everyPlace(() => f32[0]));
  say("32 bits " + bits.toString(16) + " by a view", () => everyPlace(() => view.getFloat32(0)));
  say("32 bits " + bits.toString(16) + " arithmetic", () => afterArithmetic(() => f32[0]));
  say("32 bits " + bits.toString(16) + " straight", () => { const q = new Q(); q.a = f32[0]; q.b = f32[0]; q.c = view.getFloat32(0); return [opt(q.a), nul(q.b), opt(q.c), opt(f32[0]), dflt(f32[0]), opt(f32.at(0))].join(); });
}
const f16 = new Float16Array(1), w16 = new Uint16Array(f16.buffer);
for (const bits of [0x7E80, 0x7EC0, 0x7F00, 0x7F40, 0x7FFF, 0xFE80, 0xFEC0, 0xFF00, 0x7E00, 0x7C80, 0x7CC0, 0x7D00, 0xFF80, 0xFFFF]) {
  w16[0] = bits; view.setUint16(0, bits);
  say("16 bits " + bits.toString(16) + " an element", () => everyPlace(() => f16[0]));
  say("16 bits " + bits.toString(16) + " by a view", () => everyPlace(() => view.getFloat16(0)));
  say("16 bits " + bits.toString(16) + " arithmetic", () => afterArithmetic(() => f16[0]));
  say("16 bits " + bits.toString(16) + " straight", () => { const q = new Q(); q.a = f16[0]; q.b = f16[0]; q.c = view.getFloat16(0); q.e = Math.f16round(f16[0]); return [opt(q.a), nul(q.b), opt(q.c), both(q.e), opt(f16[0]), dflt(f16[0]), opt(f16.at(0)), opt(Math.f16round(f64[0])), opt([...f16][0]), opt(f16.find(v => v !== v))].join(); });
}
console.log("done");
