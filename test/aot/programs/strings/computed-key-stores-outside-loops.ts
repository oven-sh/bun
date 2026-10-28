// `a[k] = v` outside loops on receivers of unknown type: in bounds, at and beyond the end, negative and non-numeric keys.
declare const console: { log(...args: unknown[]): void }
function put(a: any, k: any, v: any): string { try { a[k] = v; return "ok" } catch (e) { return (e as Error).constructor.name } }
function putStrictly(a: any, k: any, v: any): string { "use strict"; try { a[k] = v; return "ok" } catch (e) { return (e as Error).constructor.name } }
function putArray(a: any[], k: number, v: any): string { try { (a as any)[k] = v; return "ok" } catch (e) { return (e as Error).constructor.name } }
function show(a: any): string {
  if (a === null || a === undefined) return String(a)
  if (ArrayBuffer.isView(a)) return a.constructor.name + "[" + Array.prototype.join.call(a, ",") + "]"
  if (Array.isArray(a)) return "[" + Object.keys(a).map(k => k + "=" + String((a as any)[k])).join(",") + "]#" + a.length
  if (typeof a === "object") return "{" + Object.keys(a).map(k => k + ":" + String(a[k])).join(",") + "}"
  return typeof a + ":" + String(a)
}
const sym = Symbol("s")
const keys: any[] = [0, 1, 2, 3, 7, -1, 1.5, "1", "01", "length", "x", sym, NaN, 4294967294, 4294967295, 2 ** 31, true, null, undefined]
const makers: [string, () => any][] = [
  ["integers", () => [1, 2, 3]], ["doubles", () => [1.5, 2.5, 3.5]], ["values", () => ["a", {}, null]], ["empty", () => []], ["holes", () => [1, , 3]],
  ["frozen", () => Object.freeze([1, 2, 3])], ["sealed", () => Object.seal([1, 2, 3])], ["not extensible", () => Object.preventExtensions([1, 2, 3])],
  ["Int8Array", () => new Int8Array(3)], ["Uint8Array", () => new Uint8Array(3)], ["Uint8ClampedArray", () => new Uint8ClampedArray(3)], ["Int16Array", () => new Int16Array(3)], ["Uint32Array", () => new Uint32Array(3)], ["Float32Array", () => new Float32Array(3)], ["Float64Array", () => new Float64Array(3)],
  ["an object", () => ({ a: 1 })], ["a string", () => "abc"], ["a number", () => 5], ["null", () => null], ["undefined", () => undefined], ["arguments", () => (function (..._: number[]) { return arguments })(1, 2, 3)],
  ["a subclass", () => new (class extends Array<number> {})(3).fill(9)], ["a proxy", () => new Proxy({ a: 1 }, { set(t, k, v) { (t as any)[k] = String(v) + "!"; return true } })],
]
const values: any[] = [42, 1.25, -300, "s", undefined, { toString() { return "o" }, valueOf() { return 7 } }]
let rows = 0
for (const [name, make] of makers) for (const k of keys) {
  let line = ""
  for (const v of values) { const a = make(), b = make(), c = make(); line += " " + put(a, k, v) + show(a) + putStrictly(b, k, v) + (show(b) === show(a) ? "=" : show(b)); if (Array.isArray(c) && typeof k === "number") line += putArray(c, k, v) + (show(c) === show(a) ? "=" : show(c)) }
  rows++
  console.log(name + " " + String(typeof k === "symbol" ? "sym" : JSON.stringify(k) ?? String(k)) + " ->" + line)
}
console.log(rows + " rows")
