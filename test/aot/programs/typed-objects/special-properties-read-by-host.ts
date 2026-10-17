interface Row { id: number; name: string }
interface MayPrint { id: number; toString?: () => string; valueOf?: () => unknown; toJSON?: () => unknown }
class Plain { constructor(public v: number) {} }
class Printed { constructor(public v: number) {} toString() { return "Printed " + this.v; } }
class PrintedHeir extends Printed { w = 1; }
class Valued { constructor(public v: number) {} valueOf() { return this.v * 2; } }
class Both { constructor(public v: number) {} toString() { return "s" + this.v; } valueOf() { return this.v; } }
class Primitive { constructor(public v: number) {} [Symbol.toPrimitive](hint: string) { return hint + this.v; } }
class Tagged { constructor(public v: number) {} get [Symbol.toStringTag]() { return "Tagged" + this.v; } }
class OwnPrinter { toString: () => string; constructor(public v: number) { this.toString = () => "own " + this.v; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make()); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const tag = (v: unknown) => Object.prototype.toString.call(v);
const every = (v: unknown): unknown[] => { const x = hide(v); const out: unknown[] = []; for (const f of [() => String(x), () => `${x}`, () => x + "", () => +x, () => x * 1, () => x == "1", () => x < 5, () => tag(x), () => [x].join(), () => [x, x].sort().length, () => JSON.stringify([x]), () => JSON.stringify([new Date(0), x])]) { try { out.push(f()); } catch (e) { out.push((e as Error).name); } } return out.map(o => typeof o === "number" && o !== o ? "NaN" : o); };
const row = (id: number): Row => ({ id, name: "n" + id });
show("a record", () => every(row(1)));
show("a record, again, and another", () => [every(row(1)), every(row(2))]);
show("instances", () => [new Plain(1), new Printed(2), new PrintedHeir(3), new Valued(4), new Both(5), new Primitive(6), new Tagged(7), new OwnPrinter(8)].map(every));
show("instances, again", () => [new Plain(1), new Printed(2), new PrintedHeir(3), new Valued(4), new Both(5), new Primitive(6), new Tagged(7), new OwnPrinter(8)].map(every));
show("an optional toString: absent, there, absent", () => { const a: MayPrint = { id: 1 }, b: MayPrint = { id: 2 }, c: MayPrint = { id: 3 }; b.toString = () => "field " + b.id; return [every(a), every(b), every(c), every(b), every(a)]; });
show("an optional valueOf: absent, there, absent", () => { const a: MayPrint = { id: 1 }, b: MayPrint = { id: 2 }; b.valueOf = () => 42; return [every(a), every(b), every(a)]; });
show("an optional toJSON: absent, there, absent", () => { const a: MayPrint = { id: 1 }, b: MayPrint = { id: 2 }; b.toJSON = () => "field"; return [every(a), every(b), every(a)]; });
show("an optional toString set, then deleted", () => { const a: MayPrint = { id: 1 }; const out = [every(a)]; a.toString = () => "set"; out.push(every(a)); delete a.toString; out.push(every(a)); return out; });
show("an optional toString that is undefined", () => { const a: MayPrint = { id: 1 }, b: MayPrint = { id: 2 }; a.toString = undefined; return [every(a), every(b)]; });
for (const name of ["toString", "valueOf", "toJSON"]) show("an extra " + name + ": without, with, without", () => { const a = row(1), b = row(2), c = row(3); const first = every(a); hide(b)[name] = () => "extra " + name; return [first, every(b), every(c), every(a), every(b)]; });
show("an extra Symbol.toPrimitive", () => { const a = row(1), b = row(2); const first = every(a); hide(b)[Symbol.toPrimitive] = () => "primitive"; return [first, every(b), every(a)]; });
show("an extra Symbol.toStringTag", () => { const a = row(1), b = row(2); const first = every(a); hide(b)[Symbol.toStringTag] = "Mine"; return [first, every(b), every(a)]; });
show("an extra that is deleted again", () => { const a = row(1); const out = [every(a)]; hide(a).toString = () => "extra"; out.push(every(a)); delete hide(a).toString; out.push(every(a)); return out; });
show("a prototype that gets each late and loses it", () => { const proto = JSON.parse("{}"); const a = row(1), b = row(2); Object.setPrototypeOf(a, proto); Object.setPrototypeOf(b, proto); const out = [every(a), every(b)]; proto.toString = function (this: Row) { return "late " + this.id; }; out.push(every(a), every(b)); proto.valueOf = () => 7; out.push(every(a)); proto[Symbol.toPrimitive] = () => "p"; out.push(every(b)); proto[Symbol.toStringTag] = "T"; out.push(every(a)); proto.toJSON = () => "j"; out.push(every(b)); delete proto.toString; delete proto.valueOf; delete proto[Symbol.toPrimitive]; delete proto[Symbol.toStringTag]; delete proto.toJSON; out.push(every(a), every(b)); return out; });
show("a prototype whose method is replaced", () => { const proto = JSON.parse("{}"); proto.toString = () => "first"; const a = row(1); Object.setPrototypeOf(a, proto); const out = [every(a), every(a)]; proto.toString = () => "second"; out.push(every(a)); return out; });
show("a prototype's prototype gets one late", () => { const top = JSON.parse("{}"), proto = Object.create(top); const a = row(1); Object.setPrototypeOf(a, proto); const out = [every(a)]; top.toString = () => "top"; out.push(every(a)); proto.toString = () => "nearer"; out.push(every(a)); return out; });
show("the prototype is changed", () => { const one = JSON.parse("{}"), two = JSON.parse("{}"); one.toString = () => "one"; two.toString = () => "two"; const a = row(1); const out = [every(a)]; Object.setPrototypeOf(a, one); out.push(every(a)); Object.setPrototypeOf(a, two); out.push(every(a)); Object.setPrototypeOf(a, Object.prototype); out.push(every(a)); return out; });
show("a null prototype", () => { const a = row(1); Object.setPrototypeOf(a, null); return [every(a), every(row(2))]; });
show("a typed object as the prototype of a plain one", () => { const proto: MayPrint = { id: 1 }; const child = Object.create(proto); const out = [every(child)]; proto.toString = () => "from a typed prototype"; out.push(every(child)); delete proto.toString; out.push(every(child)); return out; });
show("a typed object as the prototype of a typed one", () => { const proto: MayPrint = { id: 1 }; const a = row(1); Object.setPrototypeOf(a, proto); const out = [every(a)]; proto.toString = () => "typed above typed"; out.push(every(a)); delete proto.toString; out.push(every(a)); return out; });
show("an accessor on the prototype", () => { let n = 0; const proto = Object.defineProperty(JSON.parse("{}"), "toString", { get() { const k = ++n; return () => "got " + k; } }); const a = row(1); Object.setPrototypeOf(a, proto); return [String(a), String(a), `${hide(a)}`]; });
show("frozen, sealed, closed", () => [Object.freeze(row(1)), Object.seal(row(2)), Object.preventExtensions(row(3))].map(every));
show("many of one shape", () => { const out: string[] = []; for (let i = 0; i < 30; i++) out.push(String(row(i)) + tag(row(i)) + String(new Printed(i))); return out.join(); });
