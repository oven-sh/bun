const out: unknown[] = [];

interface Pair { x: number; y: number }
function readsTyped(p: Pair) { return p.x + p.y; }
function readsUntyped(p: any) { return p.x + p.y; }
function writesTyped(p: Pair, v: number) { p.x = v; return p; }
function writesUntyped(p: any, v: number) { p.x = v; return p; }
function makesPair(i: number): Pair { return { x: i, y: i + 1 }; }
out.push(readsTyped(makesPair(1)), readsUntyped(makesPair(1)), writesTyped(makesPair(1), 5).x, writesUntyped(makesPair(1), 6).x);

interface Sound { a: number; b: number }
function readsSound(p: Sound) { return p.a + p.b; }
function writesSound(p: Sound, v: number) { p.a = v; return p; }
function makesSound(i: number): Sound { return { a: i, b: i + 1 }; }
out.push(readsSound(makesSound(1)), writesSound(makesSound(1), 5).a, readsSound({ b: 2, a: 1 }));

class Vector {
  x: number;
  y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
  add(o: Vector) { return new Vector(this.x + o.x, this.y + o.y); }
  get length2() { return this.x * this.x + this.y * this.y; }
}
class Loose {
  [key: string]: unknown;
  constructor(x: number) { this.x = x; }
}
function addsVectors(i: number) { return new Vector(i, 1).add(new Vector(2, i)).length2; }
function makesLoose(i: number) { return new Loose(i).x; }
out.push(addsVectors(1), makesLoose(3));

const parsed = JSON.parse('{"y":2,"x":1}') as Pair;
const reordered = { y: 4, x: 3 } as Pair;
const extra = { x: 5, y: 6, z: 7 } as Pair;
const wrongKinds = { x: "a", y: "b" } as unknown as Pair;
const missing = { x: 1 } as unknown as Pair;
const withGetter = { get x() { return 8; }, y: 9 } as Pair;
const inherited = Object.create({ x: 10, y: 11 }) as Pair;
const proxy = new Proxy({ x: 12, y: 13 }, {}) as Pair;
for (const p of [parsed, reordered, extra, wrongKinds, missing, withGetter, inherited, proxy]) out.push(readsTyped(p));
out.push(writesTyped(parsed, 20).x, writesTyped(extra, 21).x, writesTyped(inherited, 22).x, Object.keys(inherited).join());
out.push(String(writesTyped(wrongKinds, 23).x) + wrongKinds.y);
const frozen = Object.freeze({ x: 1, y: 2 }) as Pair;
try { "use strict"; writesTyped(frozen, 24); out.push("written"); } catch (e) { out.push((e as Error).constructor.name); }
out.push(frozen.x);

type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
function area(s: Shape) { return s.kind === "circle" ? 3 * s.r * s.r : s.side * s.side; }
out.push(area({ kind: "circle", r: 2 }), area({ kind: "square", side: 3 }), area(JSON.parse('{"kind":"square","side":4}')));

class Scaled {
  v: number;
  constructor(v: number) { this.v = v; }
  twice() { return new Scaled(this.v * 2); }
}
class Leaked {
  v: number;
  constructor(v: number) { this.v = v; }
  twiceLeaked() { return new Leaked(this.v * 2); }
}
function scalesInLoop(n: number) { let s = 0; const one = new Scaled(1); for (let i = 0; i < n; i++) s += one.twice().v; return s; }
function scalesLeakedInLoop(n: number) { let s = 0; const one = new Leaked(1); for (let i = 0; i < n; i++) s += one.twiceLeaked().v; return s; }
const leaked: unknown[] = [new Leaked(3)];
out.push(scalesInLoop(3), scalesLeakedInLoop(3), (leaked[0] as any).twiceLeaked().v);
(leaked[0] as any).constructor.prototype.twiceLeaked = function () { return new Leaked(100); };
out.push(scalesLeakedInLoop(3));

interface Optional { a: number; b?: number }
function coalescesOptional(p: Optional) { return p.a + (p.b ?? 7); }
function testsOptional(p: Optional) { if (p.b !== undefined) return p.a * p.b; return p.a; }
function makesOptional(i: number): Optional { return i & 1 ? { a: i, b: i + 1 } : { a: i }; }
out.push(coalescesOptional(makesOptional(1)), coalescesOptional(makesOptional(2)), testsOptional(makesOptional(3)), testsOptional(makesOptional(4)));
out.push(coalescesOptional({ a: 1, b: undefined }), testsOptional({ a: 2, b: 0 }), coalescesOptional({ a: 1, b: 2.5 }));
interface ParsedOptional { a: number; b?: number }
function coalescesParsed(p: ParsedOptional) { return p.a + (p.b ?? 7); }
out.push(coalescesParsed(JSON.parse('{"a":1,"b":2.5}')), coalescesParsed(JSON.parse('{"a":1}')), coalescesParsed(JSON.parse('{"a":1,"b":null}')), coalescesParsed(JSON.parse('{"a":1,"b":"x"}')));

interface Limits { low: number; high: number; name: string }
const limits: Limits = { low: 1, high: 9, name: "limits" };
function readsConstantLimits(x: number) { return x < limits.low ? "below " + limits.name : x > limits.high ? "above " + limits.name : "within"; }
const givenLimits: Limits = { low: 3, high: 30, name: "given" };
function readsGivenLimits() { return givenLimits.low + givenLimits.high; }
function widens(l: Limits) { l.high *= 2; return l.high; }
out.push(readsConstantLimits(0), readsConstantLimits(5), readsConstantLimits(10), readsGivenLimits(), widens(givenLimits), readsGivenLimits());

interface Route { endpoint: string; weight: number }
const routes: Route[] = [{ endpoint: "/first", weight: 1 }, { endpoint: "/second", weight: 2 }];
function isFirst(r: Route) { return r.endpoint === "/first"; }
function weighsFirst(all: Route[]) { let w = 0; for (const r of all) if (isFirst(r)) w += r.weight; return w; }
function namesRoute(r: Route) { switch (r.endpoint) { case "/first": return "first"; case "/second": return "second"; default: return "neither"; } }
out.push(isFirst(routes[0]), isFirst(routes[1]), weighsFirst(routes), namesRoute(routes[0]), namesRoute(routes[1]), namesRoute({ endpoint: "/third", weight: 3 }));

interface Part { name: string; size: number }
interface Order { count: number; part: Part; rank: number }
const keptCounts: (() => number)[] = [];
function halves(n: number) { return n / 2; }
function describesOrder(unused: unknown, { count, part: { name } }: Order) { keptCounts.push(() => count * 3); return halves(count) + ":" + (count + 0.5) + name; }
function ordersOne(count: number, part: Part) { return describesOrder(null, { count, part, rank: 1 }); }
out.push(ordersOne(JSON.parse("1"), { name: "bolt", size: 2 }), keptCounts.map(one => one()).join("|"));
function describesLooseOrder(unused: unknown, { count, part: { name } }: Order) { keptCounts.push(() => count * 3); return halves(count) + ":" + (count + 0.5) + name; }
function ordersLoosely(count: any, part: any) { return describesLooseOrder(null, { count, part, rank: 1 }); }
function keepsOrder(count: number, part: Part): Order { return { count, part, rank: 1 }; }
out.push(ordersLoosely(JSON.parse("2"), JSON.parse('{"name":"nut","size":1}')), keepsOrder(4, { name: "pin", size: 1 }).count);
function describesAsserted(unused: unknown, { count, rank }: any) { keptCounts.push(() => count / 2 + rank / 4); return halves(count) + ":" + (count + 0.5); }
function ordersAsserted(count: number, part: Part) { return describesAsserted(null, { count, part, rank: 1 } as Order); }
function describesGeneric<T extends { count: number; rank: number }>(unused: unknown, { count, rank }: T) { keptCounts.push(() => count / 2 + rank / 4); return halves(count) + ":" + (count + 0.5); }
function ordersGeneric(count: number, part: Part) { return describesGeneric<Order>(null, { count, part, rank: 1 }); }
function describesUnknown(unused: unknown, order: unknown) { const { count, rank } = order as any; keptCounts.push(() => count / 2 + rank / 4); return halves(count) + ":" + (count + 0.5); }
function passesOrder(order: Order) { return describesUnknown(null, order); }
function ordersThrough(count: number, part: Part) { return passesOrder({ count, part, rank: 1 }); }
for (const orders of [ordersAsserted, ordersGeneric, ordersThrough]) out.push(orders(JSON.parse("1"), { name: "bolt", size: 2 }));
out.push(keptCounts.map(one => one()).join("|"));

interface Tally { count: number; label: string }
const tallied: unknown[] = [];
function talliesLoosely(count: any, label: any): Tally { tallied.push(label); if (tallied.length > 100) tallied.length = 0; if (tallied.length > 50) tallied.shift(); return { count, label }; }
function readsTally(count: any, label: any) { const tally = talliesLoosely(count, label); return halves(tally.count) + ":" + tally.label; }
function destructuresTally(count: any, label: any) { const { count: n, label: text } = talliesLoosely(count, label); return text + "/" + (n + 0.5); }
function talliesToKeep(count: any, label: any): Tally { tallied.push(label); if (tallied.length > 100) tallied.length = 0; if (tallied.length > 50) tallied.shift(); return { count, label }; }
function keepsTally(count: any, label: any) { const tally = talliesToKeep(count, label); tallied.push(tally); return halves(tally.count) + ":" + tally.label; }
function readsKeptTally(count: any, label: any) { const tally = talliesToKeep(count, label); return halves(tally.count) + ":" + tally.label; }
out.push(readsTally(JSON.parse("1"), "a"), destructuresTally(JSON.parse("2"), "b"), keepsTally(JSON.parse("3"), "c"), readsKeptTally(JSON.parse("5"), "d"));
function talliesInTry(count: any, label: any): Tally { try { tallied.push(label); if (tallied.length > 100) tallied.length = 0; return { count, label }; } catch { return { count: -1, label: "caught" }; } }
function readsTallyFromTry(count: any, label: any) { const tally = talliesInTry(count, label); return halves(tally.count) + ":" + tally.label; }
function destructuresTallyFromTry(count: any, label: any) { const { count: n, label: text } = talliesInTry(count, label); return text + "/" + (n + 0.5); }
function talliesBeforeReturning(count: any, label: any): Tally { let tally: Tally; try { tallied.push(label); tally = { count, label }; } catch (e) { tallied.push("noticed"); throw e; } if (tallied.length > 100) tallied.length = 0; return tally; }
function readsTallyMadeInTry(count: any, label: any) { const tally = talliesBeforeReturning(count, label); return halves(tally.count) + ":" + tally.label; }
function destructuresTallyMadeInTry(count: any, label: any) { const { count: n, label: text } = talliesBeforeReturning(count, label); return text + "/" + (n + 0.5); }
out.push(readsTallyFromTry(JSON.parse("7"), "e"), destructuresTallyFromTry(JSON.parse("8"), "f"), readsTallyMadeInTry(JSON.parse("9"), "g"), destructuresTallyMadeInTry(JSON.parse("10"), "h"));

console.log(out.join());

if (process.env.BREAK_TYPES) {
  const attempts: [string, () => unknown][] = [
    ["a number", () => writesSound(makesSound(1), JSON.parse("5")).a],
    ["a string", () => writesSound(makesSound(1), JSON.parse('"text"')).a],
    ["a boolean, where nothing is known of the object", () => { const o: any = makesSound(1); o.b = true; return o.b; }],
    ["a number, where nothing is known of the object", () => { const o: any = makesSound(1); o.b = 7; return o.b; }],
    ["a string given to a constructor", () => new Vector(JSON.parse('"text"'), 1).x],
    ["null given to a constructor", () => new Vector(JSON.parse("null"), 1).x],
    ["undefined given to a constructor", () => new Vector(JSON.parse("[]")[0], 1).x],
    ["undefined", () => writesSound(makesSound(1), JSON.parse("[]")[0]).a],
    ["numbers given to a constructor", () => new Vector(JSON.parse("2.5"), 1).x],
    ["a string in an object that is never made", () => ordersLoosely(JSON.parse('"text"'), { name: "a", size: 1 })],
    ["null in an object that is never made", () => ordersLoosely(JSON.parse("null"), { name: "a", size: 1 })],
    ["a number for the object in an object that is never made", () => ordersLoosely(3, JSON.parse("7"))],
    ["a string in an object that is returned in registers", () => readsTally(JSON.parse('"text"'), "a")],
    ["null in an object that is returned in registers", () => destructuresTally(JSON.parse("null"), "a")],
    ["a number for the string in an object that is returned in registers", () => readsTally(1, JSON.parse("7"))],
    ["a string in an object that is returned", () => readsKeptTally(JSON.parse('"text"'), "a")],
    ["a string in an object that is returned in registers from a try block", () => readsTallyFromTry(JSON.parse('"text"'), "a")],
    ["an object that the constructor of the class did not make", () => { (leaked[0] as any).constructor.prototype.twiceLeaked = function () { return { v: 100 }; }; return scalesLeakedInLoop(3); }],
    ["a string in an object that is made in a try block and returned after it", () => { try { readsTallyMadeInTry(JSON.parse('"text"'), "a"); } catch (e) { return tallied.includes("noticed") + ", " + e; } }],
  ];
  for (const [what, attempt] of attempts) {
    try { console.log(what + ": " + attempt()); } catch (e) { console.log(what + ": " + e); }
  }
}
