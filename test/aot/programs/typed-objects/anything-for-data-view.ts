// `DataView` names a class of the engine, and a place typed by it is tested for that class: it takes a DataView, undefined or null. Anything else throws a TypeError where it enters the place: a proxy or an heir of one, another class of the engine, a look-alike, a primitive.
// Places: a parameter, a variable, a field, a field of a class, a result, an element. undefined and null pass and meet JavaScript's own answer or error at the use.
// VALIDATED compiles
function claim<T>(v: unknown): T { return v as T }
function say(name: string, f: () => unknown): void {
  let said: string;
  try { said = String(f()) } catch (e) { said = "throws " + (e as Error).name }
  console.log(name + ": " + said);
}
class Holder { held: DataView; constructor(held: DataView) { this.held = held } }
function result(v: unknown): DataView { return claim<DataView>(v) }
function use0(v: DataView): unknown { return v.byteLength }
function use1(v: DataView): unknown { return v.getUint8(0) }
function use2(v: DataView): unknown { return (v.setUint8(0, 9), v.getUint8(0)) }
function use3(v: DataView): unknown { return v instanceof DataView }
const values: [string, () => unknown][] = [
  ["the real thing", () => new DataView(new ArrayBuffer(8))], ["a proxy of it", () => new Proxy(new DataView(new ArrayBuffer(8)), {})], ["an heir of it", () => Object.create(new DataView(new ArrayBuffer(8)))], ["another class of the engine", () => new Uint16Array([7, 8])],
  ["an array", () => [1, 2]], ["a look-alike", () => ({ byteLength: 5, getUint8() { return 6 } })], ["a function", () => () => 1], ["a number", () => 5], ["a string", () => "text"], ["null", () => null], ["undefined", () => undefined],
];
for (const [name, make] of values) {
  say("a parameter, " + name + ", v.byteLength", () => use0(claim<DataView>(make())));
  say("a variable, " + name + ", v.byteLength", () => { const v: DataView = claim<DataView>(make()); return v.byteLength });
  say("a field, " + name + ", v.byteLength", () => { const o: { v: DataView } = { v: claim<DataView>(make()) }; const v = o.v; return v.byteLength });
  say("a field of a class, " + name + ", v.byteLength", () => { const v = new Holder(claim<DataView>(make())).held; return v.byteLength });
  say("a result, " + name + ", v.byteLength", () => { const v = result(make()); return v.byteLength });
  say("an element, " + name + ", v.byteLength", () => { const all: DataView[] = [claim<DataView>(make())]; const v = all[0]; return v.byteLength });
  say("a parameter, " + name + ", v.getUint8(0)", () => use1(claim<DataView>(make())));
  say("a variable, " + name + ", v.getUint8(0)", () => { const v: DataView = claim<DataView>(make()); return v.getUint8(0) });
  say("a field, " + name + ", v.getUint8(0)", () => { const o: { v: DataView } = { v: claim<DataView>(make()) }; const v = o.v; return v.getUint8(0) });
  say("a field of a class, " + name + ", v.getUint8(0)", () => { const v = new Holder(claim<DataView>(make())).held; return v.getUint8(0) });
  say("a result, " + name + ", v.getUint8(0)", () => { const v = result(make()); return v.getUint8(0) });
  say("an element, " + name + ", v.getUint8(0)", () => { const all: DataView[] = [claim<DataView>(make())]; const v = all[0]; return v.getUint8(0) });
  say("a parameter, " + name + ", (v.setUint8(0, 9), v.getUint8(0))", () => use2(claim<DataView>(make())));
  say("a variable, " + name + ", (v.setUint8(0, 9), v.getUint8(0))", () => { const v: DataView = claim<DataView>(make()); return (v.setUint8(0, 9), v.getUint8(0)) });
  say("a field, " + name + ", (v.setUint8(0, 9), v.getUint8(0))", () => { const o: { v: DataView } = { v: claim<DataView>(make()) }; const v = o.v; return (v.setUint8(0, 9), v.getUint8(0)) });
  say("a field of a class, " + name + ", (v.setUint8(0, 9), v.getUint8(0))", () => { const v = new Holder(claim<DataView>(make())).held; return (v.setUint8(0, 9), v.getUint8(0)) });
  say("a result, " + name + ", (v.setUint8(0, 9), v.getUint8(0))", () => { const v = result(make()); return (v.setUint8(0, 9), v.getUint8(0)) });
  say("an element, " + name + ", (v.setUint8(0, 9), v.getUint8(0))", () => { const all: DataView[] = [claim<DataView>(make())]; const v = all[0]; return (v.setUint8(0, 9), v.getUint8(0)) });
  say("a parameter, " + name + ", v instanceof DataView", () => use3(claim<DataView>(make())));
  say("a variable, " + name + ", v instanceof DataView", () => { const v: DataView = claim<DataView>(make()); return v instanceof DataView });
  say("a field, " + name + ", v instanceof DataView", () => { const o: { v: DataView } = { v: claim<DataView>(make()) }; const v = o.v; return v instanceof DataView });
  say("a field of a class, " + name + ", v instanceof DataView", () => { const v = new Holder(claim<DataView>(make())).held; return v instanceof DataView });
  say("a result, " + name + ", v instanceof DataView", () => { const v = result(make()); return v instanceof DataView });
  say("an element, " + name + ", v instanceof DataView", () => { const all: DataView[] = [claim<DataView>(make())]; const v = all[0]; return v instanceof DataView });
}
