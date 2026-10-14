export function counter(n) { let s = 0; for (let i = 0; i < n; i++) { s = s + (i & 1); } return s; }
export function down(list) { let out = ""; for (var i = list.length - 1; i >= 0; i--) out += list[i]; return out; }
export function incremented(n) { let i = n; i++; return i; }
export function mixes(flag) { let a = 0; if (flag) a = "x"; a++; return a; }
export function storedByClosure() { let c = 0; const set = v => { c = v; }; set("s"); return typeof c + c; }
export function hoisted() { const before = typeof v; var v = 1; return before + v; }
export function hoistedInLoop() { var out = []; for (var k = 0; k < 2; k++) { var t; out.push(String(t)); t = k; } return out.join(); }
export function blankInLoop() { const out = []; for (let k = 0; k < 2; k++) { let t; out.push(String(t)); t = k; } return out.join(); }
export function blankNeverRead(f) { let t; if (f) t = 1; else t = 2; return t + 1; }
export function pastExact() { let i = 9007199254740990; i++; i++; i++; return i; }
export function negativeZero() { let z = 0; z = z * -1; return 1 / z; }
export function fraction() { let x = 1; x = x / 2; return x; }
export function concatenated(a) { let s = ""; s += a; s += 1; return s; }
export function addedTo(a) { let s = 0; s += a; return s; }
export function lowBit(a) { const b = a & 1; return b; }
export function unsigned(a) { const u = a >>> 0; return u; }
export function negated(a) { const m = -a; return typeof m + String(m); }
export function flipped(a) { const m = ~a; return typeof m + String(m); }
export function plus(a) { const m = +a; return m; }
export function either(f) { const v = f ? 1 : 2.5; return v; }
export function orUndefined(f) { let v = f ? 1 : undefined; return v ?? "none"; }
export function fallsBack(a) { const v = a ?? 0; return v; }
export function lengths() { const list = [1, 2, 3]; let n = list.length; const s = "abc"; n += s.length; return n; }
export function lengthStored() { const list = [1]; list.length = 5; const n = list.length; return n; }
export function lengthOfUnknown(a) { const n = a.length; return n; }
function only(a, b) { return typeof a + typeof b; }
export function callsOnly() { return only(1, "x") + only(2); }
function defaulted(a = 5) { return a + 1; }
export function callsDefaulted() { return [defaulted(), defaulted(undefined), defaulted(2)].join(); }
function reassigned(a) { a = a + 1; return a; }
export function callsReassigned() { return reassigned(1) + reassigned(2.5); }
function escapes(a) { return typeof a; }
export function callsEscapes() { const f = escapes; return escapes(1) + f("s"); }
function recursive(n) { return n <= 0 ? 0 : n + recursive(n - 1); }
export function callsRecursive() { return recursive(4); }
export function compound() { let x = 1; x <<= 33; x **= 2; x %= 7; x -= 0.5; return x; }
export function stringIncremented() { let s = "5"; s++; return typeof s + s; }
export function booleanAdded() { let t = true; t += 1; return typeof t + t; }
export function fromProperty(o) { let n = 0; n = o.count; n++; return n; }
export function deadZone() { try { f(); let q = 1; function f() { return q; } return q; } catch (e) { return e.constructor.name; } }
export function outOfPattern() { let a = 0; [a] = ["s"]; return a; }
export function keyOfLoop(o) { let k = 0; for (k in o) { } return k; }
export function valueOfLoop(l) { let k = 0; for (k of l) { } return k; }
export function largest(a) { const m = Math.max(a, 1); return m; }
export function asString(a) { const s = String(a); return s.length; }
export function asNumber(a) { const n = Number(a); return n; }
export function asBoolean(a) { const b = Boolean(a); return b; }
export function shadowedString(a) { const String = x => 5; const s = String(a); return typeof s; }
export function shadowedMath(a) { const Math = { max: () => "most" }; const m = Math.max(a, 1); return m; }
export function addedToMath() { Math.named = () => "name"; const m = Math.named(); return m; }
export function made() { function C() { return [1, 2]; } const o = new C(); return o.length; }
export function madeFunction() { function C() { return () => 7; } const o = new C(); return typeof o + o(); }
export function logicalStores() { let a = 0; a ||= "x"; let b = null; b ??= 3; let c = 1; c &&= "y"; return [a, b, c].join(); }
export function postfix() { let i = 0; const old = i++; return old + "," + i; }
export function postfixOfString() { let i = "7"; const old = i++; return typeof old + old + i; }
export function postfixOfBigint() { let i = 7n; const old = i--; return typeof old + old + i; }
export function lastOfComma() { let x = (1, "s"); return x; }
export function captured() { let n = 0; const inc = () => n++; inc(); inc(); return n; }
export function capturedByTurn() { const fs = []; for (let i = 0; i < 3; i++) fs.push(() => i); return fs.map(f => f()).join(); }
export function notANumber() { let x = 0; x = NaN; x = x + 1; return x; }
export function infinite() { let x = 0; x = Infinity; return x - 1; }
export function shadowedNaN(NaN) { let x = NaN; return x; }
export function shadowedUndefined(undefined) { let x = undefined; return x; }
export function nameOfKind(a) { const t = typeof a; return t.length; }
export function removed(f) { const o = { x: 1 }; if (f) Object.freeze(o); const d = delete o.x; return d; }
export function template(a) { const t = `${a}!`; return t; }
export function bigints() { let b = 1n; b++; b = b * 2n; return typeof b + b; }
export function bigintAndNumber() { let b = 1n; try { b = b + 1; return "no error"; } catch (e) { return e.constructor.name + typeof b; } }
export function symbolAdded() { let s = 0; try { s = s + Symbol.iterator; return "no error"; } catch (e) { return e.constructor.name + s; } }
export function objectToNumber() { const o = { valueOf() { return 2n; } }; const m = o * 2n; return typeof m + m; }
export function objectToString() { const o = { toString() { return "o"; } }; let s = 1; s = s + o; return typeof s + s; }
export function compared(a, b) { const less = a < b; return less; }
export function twoVariables() { let a = 0, b = a; a = "s"; b = a; return typeof b; }
export function eachOther(n) { let a = 0, b = 1; for (let i = 0; i < n; i++) { const t = a; a = b; b = t + b; } return a; }
export function eachOtherMixed(n) { let a = 0, b = "1"; for (let i = 0; i < n; i++) { const t = a; a = b; b = t + b; } return typeof a + a; }
export function switched(k) { let r; switch (k) { case 1: r = 10; break; case 2: r = 20; break; } return r; }
export function tried() { let r = 0; try { r = 1; throw 0; } catch { r = r + 1; } finally { r = r * 10; } return r; }
export function* yielded() { let got = 0; got = yield got; return got; }
export async function awaited(p) { let got = 0; got = await p; return got; }
export function blankString(f) { let t; if (f) t = "a"; else t = "b"; return t + "!"; }
export function blankBigint(f) { let t; if (f) t = 1n; else t = 2n; return t + 1n; }
export function blankSymbol(f) { let t; if (f) t = Symbol.iterator; else t = Symbol.hasInstance; return t.description; }
export function blankStringCaptured(f) { let t; const get = () => t; if (f) t = "a"; else t = "b"; return get() + "!"; }
export function blankStringRead() { let t; const before = typeof t; t = "a"; return before + t; }
export function hoistedString() { const before = typeof v; var v = "s"; return before + v; }
export function hoistedStringNeverRead(f) { if (f) { var v = "s"; return v + "!"; } return "none"; }
export function blankStringInLoop() { const out = []; for (let k = 0; k < 2; k++) { let t; if (k) t = "x"; else t = "y"; out.push(t); } return out.join(); }
export function deadZoneOfString(f) { try { const get = () => q; get(); const q = f ? "s" : "t"; return q; } catch (e) { return e.constructor.name; } }
class Counter { #count = 0; #name = "c"; #blank; #big = 1n; #mixed = 0;
  up() { return ++this.#count; } down() { return this.#count--; } add(n) { this.#count += n; return this.#count; }
  name() { this.#name += "!"; return this.#name; } blank() { const before = this.#blank; this.#blank = 1; return typeof before + this.#blank; }
  big() { this.#big++; return this.#big; } mix(v) { this.#mixed = v; this.#mixed++; return this.#mixed; }
  static peek(other) { return other.#count; } }
export function privateFields() { const c = new Counter(); return [c.up(), c.up(), c.down(), c.add(2.5), c.name(), c.blank(), c.blank(), c.big(), c.mix(1), c.mix("4"), c.mix(4n), Counter.peek(c)].map(it => typeof it + String(it)).join(); }
export function privateFieldOfAnother() { try { return Counter.peek({}); } catch (e) { return e.constructor.name; } }
let top = 0;
export function bumpsTop() { top++; return top; }
export let exported = 0;
export function storesExported(v) { exported = v; return exported; }
var early = typeof late + typeof lateFunction;
var late = 1;
function lateFunction() { }
export function readsEarly() { return early + late; }
