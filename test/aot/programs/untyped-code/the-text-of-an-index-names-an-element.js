// A trap of a proxy is handed an index as its text and asks its target under that text. Compiled code reads the index out of a short text and goes to the element. The run time is asked where the text is no such index or the storage is of another kind.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTGetByValGeneric") + count("operationAOTInByValGeneric") + count("operationAOTGetByValAndCache") + count("operationAOTInByValAndCache") + count("operationAOTGetByVal") + count("operationAOTFinishHasThroughProxy");
function attempt(label, work) { let said; try { said = JSON.stringify(work(), (key, held) => held === undefined ? "undefined" : Object.is(held, -0) ? "-0" : held); } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + said); }
function measure(label, work, bound) {
  let sum = 0;
  for (let i = 0; i < 60; i++) sum += work(i);
  const before = asked();
  for (let i = 0; i < 2000; i++) sum += work(i);
  console.log(label + ": " + sum + " | " + (asked() - before <= bound));
}
const texts = ["0", "1", "2", "3", "4", "5", "6", "7"];
const handsOn = { get(target, key, receiver) { return Reflect.get(target, key, receiver); }, has(target, key) { return Reflect.has(target, key); } };
const asksItself = { get(target, key) { return target[key]; }, has(target, key) { return key in target; } };
const small = [1, 2, 3, 4, 5, 6, 7, 8], halves = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], mixed = ["a", 1, null, "d", 0.5, true, "g", "h"];
const long = Array.from({ length: 1200 }, (unused, i) => i);
measure("under a text", i => small[texts[i & 7]], 0);
measure("fractions under a text", i => halves[texts[i & 7]], 0);
measure("anything under a text", i => String(mixed[texts[i & 7]]).length, 0);
measure("a text in a list", i => (texts[i & 7] in small ? 1 : 0) + (texts[i & 7] in halves ? 2 : 0), 0);
measure("a list behind a proxy that hands on", (list => i => list[i & 7])(new Proxy(small, handsOn)), 0);
measure("fractions behind a proxy that hands on", (list => i => list[i & 7])(new Proxy(halves, handsOn)), 0);
measure("a list behind a proxy that asks itself", (list => i => list[i & 7])(new Proxy(small, asksItself)), 0);
measure("an index in a proxy that hands on", (list => i => ((i & 15) in list ? 1 : 0))(new Proxy(small, handsOn)), 0);
measure("an index in a proxy that asks itself", (list => i => ((i & 15) in list ? 1 : 0))(new Proxy(mixed, asksItself)), 0);
measure("two, three and four digits", (list => i => list[[10, 99, 100, 999, 1000, 1023, 12, 345][i & 7]])(new Proxy(long, handsOn)), 0);

// Nothing is pinned from here on.
const keys = ["0", "1", "2", "3", "9", "10", "99", "100", "999", "1000", "1023", "1024", "9999", "10000", "4294967294", "4294967295", "00", "01", "010", "-0", "-1", "+1", "1.0", "1.", ".1", "1e1", "0x1", " 1", "1 ", "", "1a", "a1", "１", "1１", "length", "١"];
const made = () => [String(1) + String(2), ["1", "0"].join(""), "x1".slice(1), "12345".slice(0, 2), `${3}`, "１1".slice(1), new String("2"), { toString() { return "1"; } }, 2, 2.0, 1n, true, null, undefined];
const ask = (object, receiver) => [...keys, ...made()].map(key => { let by; try { by = [object[key], key in object, Reflect.get(object, key, receiver), Reflect.has(object, key), Object.hasOwn(object, key)]; } catch (error) { by = error.constructor.name; } return by; });
const above = { 1: "above one", 3: "above three", 12: "above twelve" };
for (let round = 0; round < 3; round++) {
  const receiver = { mark: "receiver" };
  attempt("small numbers", () => ask([1, 2, 3], receiver));
  attempt("fractions", () => ask([0.5, 1.5, , NaN, -0], receiver));
  attempt("anything", () => ask(["a", , undefined, null, 0], receiver));
  attempt("thirteen", () => ask(Array.from({ length: 13 }, (unused, i) => i * 2), receiver));
  attempt("eleven hundred", () => ask(Array.from({ length: 1100 }, (unused, i) => i + 0.5), receiver).map(by => by[0]));
  attempt("nothing", () => ask([], receiver));
  attempt("sparse", () => { const list = [1, 2]; list[100000] = 3; list[12] = "twelve"; return ask(list, receiver); });
  attempt("frozen", () => ask(Object.freeze([1, , 3]), receiver));
  attempt("an accessor among the elements", () => { const list = [1, 2, 3, 4]; Object.defineProperty(list, 1, { get() { return this.mark ?? "the list"; } }); Object.defineProperty(list, 12, { get() { return this.mark ?? "the list"; } }); return ask(list, receiver); });
  attempt("below an object with elements", () => { const list = [1, , 3]; Object.setPrototypeOf(list, above); return ask(list, receiver); });
  attempt("below an accessor", () => { const list = [1, , 3]; Object.setPrototypeOf(list, Object.defineProperty({}, 1, { get() { return this.mark ?? "the list"; } })); return ask(list, receiver); });
  attempt("a list with names", () => { const list = [1, 2]; list["01"] = "a name"; list["-1"] = "negative"; list["1.0"] = "a fraction"; list[""] = "empty"; return ask(list, receiver); });
  attempt("a list of a class", () => ask(new (class extends Array { })(1, 2, 3), receiver));
  attempt("an object filled by index", () => { const o = {}; o[0] = "a"; o[2] = "c"; o[12] = "m"; return ask(o, receiver); });
  attempt("names and indexes", () => ask({ name: 1, 0: "a", 2: "c", 12: "m", "01": "a name" }, receiver));
  attempt("bytes", () => ask(new Uint8Array([7, 8, 9]), receiver));
  attempt("arguments", () => (function () { return ask(arguments, receiver); })("a", "b", "c"));
  attempt("a text as an object", () => ask(new String("abc"), receiver));
  attempt("a proxy that hands on", () => ask(new Proxy([1, , 3], handsOn), receiver));
  attempt("a proxy that says no", () => { const proxy = new Proxy([1, 2, 3], { has() { return false; } }); return [0 in proxy, 1 in proxy, 5 in proxy, "0" in proxy, "length" in proxy].concat((() => { try { return "length" in new Proxy([1], { has() { return false; } }); } catch (error) { return error.constructor.name; } })()); });
  attempt("no over what may not be denied", () => [Object.freeze([1, 2]), Object.seal([1, 2]), Object.preventExtensions([1, 2]), Object.defineProperty([1, 2], 0, { configurable: false }), (() => { const list = [1, 2]; list[100000] = 1; return list; })()].map(target => [0, 1, 5].map(index => { try { return index in new Proxy(target, { has() { return false; } }); } catch (error) { return error.constructor.name; } })));
  attempt("the list changes between asks", () => { const list = [1, 2, 3]; const proxy = new Proxy(list, handsOn); const said = [proxy[2], 2 in proxy]; list.length = 1; said.push(proxy[2], 2 in proxy); list.push(0.5); said.push(proxy[1], 1 in proxy); list.push("text"); said.push(proxy[2], 2 in proxy); delete list[1]; said.push(proxy[1], 1 in proxy); return said; });
}
