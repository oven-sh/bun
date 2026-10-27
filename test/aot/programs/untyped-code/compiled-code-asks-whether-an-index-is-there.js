// `index in object`: the elements of a list, of an object with names and of a typed array answer in compiled code, whether the index is there or not, and so does an object that has no elements. The run time is asked where something else may answer.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTInByValAndCache") + count("operationAOTInByValGeneric");
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
function attempt(label, work) { let said; try { said = JSON.stringify(work()); } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + said); }
function measure(label, object, keys, bound) {
  let text = "";
  for (const key of keys) text += " " + (key in object ? "i" : "-") + (Object.hasOwn(object, key) ? "o" : "-");
  let found = 0;
  for (let i = 0; i < 40; i++) if (keys[i % keys.length] in object) found++;
  const before = asked();
  for (let i = 0; i < 2000; i++) if (keys[i % keys.length] in object) found++;
  console.log(label + ":" + text + " " + found + " | " + (asked() - before <= bound));
}
const near = [0, 1, 2, 3, 4, 5, 7, 100, 2147483647];
const holes = [1, , 3, , 5];
const fractions = [0.5, 1.5, , 3.5];
const mixed = ["a", 1, , null, undefined];
measure("a list of small numbers", [1, 2, 3, 4], near, 0);
measure("a list with holes", holes, near, 0);
measure("a list of fractions", fractions, near, 0);
measure("a list of anything", mixed, near, 0);
measure("an empty list that had elements", (() => { const list = [1, 2]; list.length = 0; return list; })(), near, 0);
measure("names and indexes", { name: 1, 0: "a", 1: "b", 3: "d" }, near, 0);
measure("an array-like", { length: 2, 0: 0.5, 1: undefined }, near, 0);
measure("elements that were stored", (() => { const o = { count: 1 }; o[0] = 1; o[2] = 2; o[5] = null; return o; })(), near, 0);
measure("bytes", new Uint8Array(4), near, 0);
measure("no bytes", new Uint8Array(0), near, 0);
measure("fractions in a typed array", new Float64Array(3), near, 0);
measure("big numbers in a typed array", new BigInt64Array(5), near, 0);
measure("a part of a buffer", new Int16Array(new ArrayBuffer(16), 4, 3), near, 0);
measure("negative indexes of bytes", new Uint8Array(4), [-1, -2147483648, 0, 3], 0);
measure("names alone", { name: 1, other: 2 }, near, 0);
measure("names that came late", (() => { const o = { name: 1 }; o.late = 2; o["later" + o.late] = 3; return o; })(), near, 0);
measure("nothing", {}, near, 0);
measure("filled by index", (() => { const o = {}; o[0] = 1; o[2] = 2; return o; })(), near, 0);
measure("a map", new Map, near, 0);
measure("a date", new Date(0), near, 0);
measure("no prototype", Object.create(null), near, 0);
measure("below an object without elements", Object.create(Object.create(null)), near, 0);

// Here something else may answer, or the key is a name. Nothing is pinned.
const far = [-1, -2147483648, 0, 1, 2, 3, 4, 5, 8, 1000, 2147483647, 4294967294, 4294967295, 0.5, -0, 1.0, NaN, "1", "01", "-1", "1.0", "length", "name"];
const answers = object => far.map(key => (key in object ? "i" : "-") + (Object.hasOwn(object, key) ? "o" : "-")).join(" ");
const above = { kind: "above", 1: "above", 8: "above" };
class Holder { constructor(n) { this.n = n; this[0] = n; } 1() { return "method"; } }
class Listed extends Array { }
class Bytes extends Uint8Array { }
for (let round = 0; round < 3; round++) {
  attempt("a list", () => answers([1, 2, 3]));
  attempt("a list with holes", () => answers([1, , 3, , 5]));
  attempt("a list of fractions with a hole", () => answers([0.5, , 2.5]));
  attempt("a list with a name", () => { const list = [1, 2]; list.name = 1; list[-1] = "negative"; return answers(list); });
  attempt("a sparse list", () => { const list = [1]; list[1000] = 2; list[100000] = 3; return answers(list); });
  attempt("a list below another object", () => { const list = [1, , 3]; Object.setPrototypeOf(list, above); return answers(list); });
  attempt("a list below a list with elements", () => { const list = [1]; Object.setPrototypeOf(list, [9, 9, 9, 9]); return answers(list); });
  attempt("a list of a class", () => { const list = new Listed; list.push(1, 2); return answers(list); });
  attempt("a frozen list", () => answers(Object.freeze([1, , 3])));
  attempt("a list with an accessor", () => { const list = [1, 2, 3]; Object.defineProperty(list, 1, { get() { return 1; } }); Object.defineProperty(list, 4, { get() { return 1; } }); return answers(list); });
  attempt("a list that was shortened and deleted from", () => { const list = [1, 2, 3, 4, 5]; delete list[1]; list.length = 3; return answers(list); });
  attempt("names and indexes", () => answers({ name: round, 0: "a", 2: "c" }));
  attempt("names alone", () => answers({ name: round }));
  attempt("nothing", () => answers({}));
  attempt("indexes alone", () => answers({ 0: "a", 2: "c" }));
  attempt("filled by index", () => { const o = {}; o[0] = 1; o[2] = 2; return answers(o); });
  attempt("an element that is far", () => answers({ name: round, 0: "a", 1000: "far", 4294967294: "largest", 4294967295: "a name" }));
  attempt("an object below another with elements", () => answers({ __proto__: above, name: round, 0: "a" }));
  attempt("the prototype comes later", () => { const o = { name: round, 0: "a" }; const before = answers(o); Object.setPrototypeOf(o, above); return [before, answers(o)]; });
  attempt("no prototype", () => answers({ __proto__: null, name: round, 0: "a" }));
  attempt("an element deleted", () => { const o = { name: round, 0: "a", 1: "b", 2: "c" }; delete o[1]; return answers(o); });
  attempt("an accessor under an index", () => { const o = { name: round, 0: "a" }; Object.defineProperty(o, 2, { get() { return 1; } }); return answers(o); });
  attempt("an element that holds undefined", () => answers({ name: round, 0: undefined, 1: null, 2: 0 }));
  attempt("an instance of a class", () => answers(new Holder(round)));
  attempt("below an object with elements that come late", () => { const over = { name: round, 0: "over" }; const below = Object.create(over); const before = answers(below); over[1] = "late"; return [before, answers(below)]; });
  attempt("frozen, sealed, not extensible", () => [Object.freeze, Object.seal, Object.preventExtensions].map(fix => answers(fix({ name: round, 0: "a", 2: "c" }))));
  attempt("bytes", () => answers(new Uint8Array(3)));
  attempt("bytes of a class", () => answers(new Bytes(3)));
  attempt("bytes with a name", () => { const bytes = new Uint8Array(2); bytes.name = 1; return answers(bytes); });
  attempt("bytes below another object", () => { const bytes = new Uint8Array(2); Object.setPrototypeOf(bytes, above); return answers(bytes); });
  attempt("below bytes", () => answers(Object.create(new Uint8Array(3))));
  attempt("bytes whose buffer has gone", () => { const bytes = new Uint8Array(4); const before = answers(bytes); structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); return [before, answers(bytes)]; });
  attempt("bytes that follow a buffer", () => { const buffer = new ArrayBuffer(2, { maxByteLength: 8 }); const bytes = new Uint8Array(buffer); const before = answers(bytes); buffer.resize(5); const between = answers(bytes); buffer.resize(1); return [before, between, answers(bytes)]; });
  attempt("a view that is no list", () => answers(new DataView(new ArrayBuffer(4))));
  attempt("a text as an object", () => answers(new String("abc")));
  attempt("arguments", () => (function () { return answers(arguments); })(1, 2, 3));
  attempt("a function, a map, a date", () => [answers(function () { }), answers(new Map), answers(new Date(0))]);
  attempt("a proxy", () => { const seen = []; const proxy = new Proxy([1, , 3], { has(target, key) { seen.push(typeof key + " " + String(key)); return Reflect.has(target, key); } }); return [answers(proxy), seen.join()]; });
  attempt("a proxy without a trap", () => [answers(new Proxy([1, , 3], {})), answers(new Proxy({ name: 1, 0: "a" }, {})), answers(new Proxy(new Uint8Array(2), {}))]);
  attempt("what is no object", () => [1, "abc", null, undefined, true, 1n, Symbol.iterator].map(value => { try { return 0 in value; } catch (error) { return error.constructor.name; } }));
  attempt("what is no object, its own", () => [1, "abc", true, 1n].map(value => [Object.hasOwn(value, 0), Object.hasOwn(value, 3)]));
  attempt("one site meets them all", () => { const has = (o, k) => k in o; return [[1], { name: 1, 0: 1 }, new Uint8Array(1), {}, new Map, new Proxy([1], {}), new String("a")].map(o => [has(o, 0), has(o, 1), has(o, -1)]); });
}
let found = 0;
const record = { name: 1, 0: "a", 1: "b" }, bytes = new Uint8Array(4), list = [1, , 3];
for (let i = 0; i < 30000; i++) { if (i % 10000 === 0) collect(); if ((i & 3) in record) found++; if ((i & 7) in bytes) found += 2; if ((i & 3) in list) found += 4; if (Object.hasOwn(record, i & 3)) found += 8; }
console.log(found);
