// `x[key]` at a place where the key is expected to be a number, because elsewhere it is one, and where names arrive: x an object of a type of the program. The last line counts: once a name is known, the read of a field does not leave compiled code.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Inner { v: number }
interface Kinds { whole: number; fraction: number; flag: boolean; text: string; textOrNull: string | null; both: number | string; anything: unknown; inner: Inner; list: number[]; call: () => number; big: bigint; maybeNumber?: number; maybeText?: string; maybeFlag?: boolean }
class Point { constructor(public x: number, public y: number, public label?: string) {} get sum() { return this.x + this.y; } norm() { return this.x * this.x + this.y * this.y; } }
class Point3 extends Point { z = 3; }
function hide(value: unknown): any { return value; }
let count = 0;
const say = (v: unknown): unknown => v === undefined ? "undefined" : typeof v === "number" ? (v !== v ? "NaN" : Object.is(v, -0) ? "-0" : !isFinite(v) ? String(v) : v) : typeof v === "bigint" ? "bigint " + v : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : v;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => say(v)); } catch (e) { out = "throws " + (e as Error).name; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
function at(value: any, key: any) { return value[key]; }
function sum(list: number[]) { let t = 0; for (let i = 0; i < list.length; i++) t += at(list, i); return t; }
function read(value: any, keys: any) { const out: unknown[] = []; for (let i = 0; i < keys.length; i++) out.push(at(value, keys[i])); return out; }
const thrice = (value: any, keys: any) => [read(value, keys), read(value, keys), read(value, keys)][2];
const given = (text: string): any => JSON.parse(text);
const make = (): Kinds => ({ whole: 1, fraction: 1.5, flag: true, text: "t", textOrNull: null, both: "b", anything: 1, inner: { v: 1 }, list: [1], call: () => 1, big: 1n });
const all = given('["whole","fraction","flag","text","textOrNull","both","anything","inner","list","call","big","maybeNumber","maybeText","maybeFlag"]');
const plain = (...list: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of list) o[k] = v; return o; };
show("numbers are what is expected", () => sum([1, 2, 3]));
show("every kind of field", () => thrice(make(), all));
show("they are the same things", () => { const x = make(); return [at(x, all[7]) === x.inner, at(x, all[8]) === x.list, at(x, all[9]) === x.call]; });
show("numbers at the edges", () => { const x = make(); return [0, -1, 1073741823, 1073741824, -1073741825, 2147483648, -2147483649, 1.5, -0, NaN, Infinity, 1e21, 5e-324].map(v => { x.whole = v; x.fraction = v; x.both = v; x.anything = v; return read(x, given('["whole","fraction","both","anything"]')); }); });
show("optional fields: absent, set, undefined, deleted, set again", () => { const x = make(), keys = given('["maybeNumber","maybeText","maybeFlag"]'); const out = [thrice(x, keys)]; x.maybeNumber = 1; x.maybeText = "m"; x.maybeFlag = false; out.push(thrice(x, keys)); x.maybeNumber = undefined; out.push(thrice(x, keys)); delete x.maybeNumber; delete x.maybeText; out.push(thrice(x, keys)); x.maybeText = "again"; out.push(thrice(x, keys)); return out; });
show("an absent field whose name a given prototype has, and loses", () => { const x = make(), proto = plain(["maybeText", "inherited"]), keys = given('["maybeText","whole"]'); const before = thrice(x, keys); Object.setPrototypeOf(hide(x), proto); const during = thrice(x, keys); delete proto.maybeText; return [before, during, thrice(x, keys)]; });
show("names of no field: nothing, what is inherited, extras", () => { const x = make(), keys = given('["nothing","toString","constructor","hasOwnProperty","extra","__proto__"]'); const before = thrice(x, keys).map(v => typeof v); hide(x).extra = 5; const during = thrice(x, keys).map(v => typeof v); delete hide(x).extra; return [before, during, thrice(x, keys).map(v => typeof v)]; });
show("instances: fields, an accessor, a method, heirs", () => { const keys = given('["x","y","label","sum","norm","z"]'); return [thrice(new Point(1, 2), keys), thrice(new Point(1, 2, "l"), keys), thrice(new Point3(3, 4), keys)]; });
show("symbols, indices, numbers as text", () => { const x = make(), s = Symbol("s"), keys = given('[0,"0",1,-1,1.5,"1.5","-1"]'); hide(x)[s] = "by symbol"; hide(x)[0] = "zero"; keys.push(s, s, Symbol.iterator); return thrice(x, keys); });
show("typed and plain and lists and strings in turn", () => { const keys = given('["whole","length",0]'); return [make(), plain(["whole", 2]), [7, 8], "ab", make(), new Point(1, 2), plain(), make()].map(x => read(x, keys)); });
show("frozen, sealed", () => [Object.freeze(make()), Object.seal(make())].map(x => thrice(x, given('["whole","text","maybeText"]'))));
show("the object changes between two reads", () => { const x = make(), keys = given('["whole","text"]'); const out = [read(x, keys)]; x.whole = 2; x.text = "u"; out.push(read(x, keys)); hide(x).extra = 1; out.push(read(x, keys)); Object.setPrototypeOf(hide(x), null); out.push(read(x, keys)); Object.freeze(x); out.push(read(x, keys)); return out; });
show("null and undefined", () => [null, undefined].map(x => { try { return at(x, all[0]); } catch (e) { return (e as Error).name; } }));
show("many objects, garbage between", () => { let n = 0, kept: unknown; const keys = given('["whole","text","inner"]'); for (let i = 0; i < 3000; i++) { const x = make(); x.whole = i; x.text = "t" + (i & 7); kept = { i }; const got = read(x, keys); n += (got[0] as number) + (got[1] as string).length + (got[2] as Inner).v; } return [n, kept !== undefined]; });
const counted = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const one = make(), other = new Point(1, 2), some = given('["whole","fraction","flag","text","textOrNull","both","anything","inner","list","call","big"]'), two = given('["x","y"]');
read(one, some); read(other, two); read(one, some); read(other, two);
const before = counted("operationAOTGetByVal");
let total = 0;
for (let i = 0; i < 1000; i++) total += read(one, some).length + read(other, two).length;
console.log(total, counted("operationAOTGetByVal") - before);
