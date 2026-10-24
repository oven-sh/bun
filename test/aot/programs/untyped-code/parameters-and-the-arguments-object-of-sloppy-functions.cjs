// In sloppy code a parameter and the element of `arguments` at its index are one variable. Every way to see that from either side, beside functions that only read `arguments.length` and `arguments[i]`.
function onlyLength(a, b) { return [arguments.length, a, b]; }
function onlyElements(a, b) { return [arguments[0], arguments[1], arguments[2], a, b]; }
function elementByKey(a, b, k) { return [arguments[k], a, b]; }
function storesParameter(a, b) { a = "stored"; return [arguments[0], arguments[1], a, b]; }
function storesOneOfTwo(a, b) { b = "stored"; return [arguments[0], arguments[1], a, b]; }
function storesElement(a, b) { arguments[0] = "stored"; return [arguments[0], a, b]; }
function storesElementByKey(a, b, k) { arguments[k] = "stored"; return [a, b]; }
function updatesElement(a) { arguments[0]++; return [arguments[0], a]; }
function updatesParameter(a) { a++; return [arguments[0], a]; }
function compoundElement(a) { arguments[0] += "!"; return [arguments[0], a]; }
function patternElement(a, b) { [arguments[0], arguments[1]] = ["x", "y"]; return [a, b]; }
function patternProperty(a) { ({ p: arguments[0] } = { p: "x" }); return [a]; }
function patternRest(a) { [...arguments[0]] = "xy"; return [a]; }
function patternParameter(a, b) { [a, b] = ["x", "y"]; return [arguments[0], arguments[1]]; }
function loopElement(a) { for (arguments[0] in { key: 1 }) {} return [a]; }
function loopOfElement(a) { for (arguments[0] of ["item"]) {} return [a]; }
function loopParameter(a) { for (a in { key: 1 }) {} return [arguments[0]]; }
function deletesElement(a) { delete arguments[0]; a = "stored"; return [arguments[0], a, arguments.length]; }
function deletesThenStores(a) { delete arguments[0]; arguments[0] = "again"; return [arguments[0], a]; }
function callsElement(a) { return [arguments[0](), a === arguments[0]]; }
function storesThroughThis() { this[0] = "through this"; return "called"; }
function callsElementThatStores(a, b) { arguments[1](); return [typeof a, a, typeof b]; }
function storesLength(a, b) { arguments.length = 1; return [arguments.length, a, b, Array.prototype.slice.call(arguments)]; }
function handsOn(a) { store(arguments); return [a]; }
function store(list) { list[0] = "stored elsewhere"; }
function returnsObject(a) { return arguments; }
function inArrow(a) { const read = () => arguments[0]; a = "stored"; return [read(), a]; }
function arrowStores(a) { const write = () => { arguments[0] = "stored"; }; write(); return [a]; }
function arrowStoresParameter(a) { const write = () => { a = "stored"; }; write(); return [arguments[0]]; }
function arrowOnlyReads(a, b) { const read = () => arguments.length + arguments[1]; return [read(), a, b]; }
function closureKeepsParameter(a) { if (arguments.length > 5) return null; return function () { return a; }; }
function redeclared(a) { var a = "declared again"; return [arguments[0], a]; }
function redeclaredWithoutValue(a) { var a; return [arguments[0], a]; }
function functionOfSameName(a) { function a() {} return [typeof arguments[0], typeof a]; }
function fewer(a, b) { b = "stored"; return [arguments.length, arguments[1], b]; }
function fewerElement(a, b) { arguments[1] = "stored"; return [arguments.length, arguments[1], b]; }
function more(a) { return [arguments.length, arguments[1], arguments[2], a]; }
function callee(a) { return [arguments.callee === callee, a]; }
function spreads(a, b) { return [...arguments, a, b]; }
function applies(a, b) { return onlyElements.apply(null, arguments).concat([a, b]); }
function declaresBinding(a) { var arguments = ["other"]; return [arguments[0], a]; }
function withObject(a) { with (arguments) { length = 0; } return [arguments.length, a]; }
function definesElement(a) { Object.defineProperty(arguments, "0", { value: "defined" }); return [arguments[0], a]; }
function freezes(a) { Object.freeze(arguments); a = "stored"; return [arguments[0], a]; }
function typeOfElement(a) { return [typeof arguments[0], typeof arguments[1], a]; }
function elementInCondition(a, b) { return arguments[1] ? [a, b] : [a]; }
function optionalElement(a) { return [arguments?.[0], arguments?.length, a]; }
function sideEffectInKey(a, b) { return [arguments[(a = "stored", 0)], a, b]; }
function Pair(first, second) { if (arguments.length !== 2) throw new Error("two arguments"); this.first = first; this.second = second; }

function show(name, value) { console.log(name, JSON.stringify(value, (key, held) => (typeof held === "function" ? "function" : held))); }
show("onlyLength", [onlyLength(), onlyLength(1), onlyLength(1, 2), onlyLength(1, 2, 3)]);
show("onlyElements", [onlyElements(), onlyElements(1), onlyElements(1, 2, 3)]);
show("elementByKey", [elementByKey(1, 2, 0), elementByKey(1, 2, 1), elementByKey(1, 2, "length"), elementByKey(1, 2, 9)]);
show("storesParameter", [storesParameter(1, 2), storesParameter()]);
show("storesOneOfTwo", [storesOneOfTwo(1, 2), storesOneOfTwo(1)]);
show("storesElement", [storesElement(1, 2), storesElement()]);
show("storesElementByKey", [storesElementByKey(1, 2, 0), storesElementByKey(1, 2, 1), storesElementByKey(1, 2, 5)]);
show("updatesElement", updatesElement(1));
show("updatesParameter", updatesParameter(1));
show("compoundElement", compoundElement("a"));
show("patternElement", patternElement(1, 2));
show("patternProperty", patternProperty(1));
show("patternRest", patternRest(1));
show("patternParameter", patternParameter(1, 2));
show("loopElement", loopElement(1));
show("loopOfElement", loopOfElement(1));
show("loopParameter", loopParameter(1));
show("deletesElement", deletesElement(1));
show("deletesThenStores", deletesThenStores(1));
show("callsElement", callsElement(function () { return this.length; }));
show("callsElementThatStores", callsElementThatStores(1, storesThroughThis));
show("storesLength", storesLength(1, 2));
show("handsOn", handsOn(1));
show("returnsObject", Array.from(returnsObject(1, 2)));
show("inArrow", inArrow(1));
show("arrowStores", arrowStores(1));
show("arrowStoresParameter", arrowStoresParameter(1));
show("arrowOnlyReads", arrowOnlyReads(1, 2));
show("closureKeepsParameter", closureKeepsParameter("kept")());
show("redeclared", redeclared(1));
show("redeclaredWithoutValue", redeclaredWithoutValue(1));
show("fewer", fewer(1));
show("fewerElement", fewerElement(1));
show("more", more(1, 2, 3));
show("callee", callee(1));
show("spreads", spreads(1, 2));
show("applies", applies(1, 2));
show("declaresBinding", declaresBinding(1));
show("withObject", withObject(1));
show("definesElement", definesElement(1));
show("freezes", freezes(1));
show("typeOfElement", typeOfElement(1));
show("elementInCondition", [elementInCondition(1, 2), elementInCondition(1)]);
show("optionalElement", optionalElement(1));
show("sideEffectInKey", sideEffectInKey(1, 2));
show("Pair", new Pair(1, "two"));
let sum = 0;
for (let i = 0; i < 3000; i++) sum += new Pair(i, "ab").first + new Pair(i, "abc").second.length + onlyLength(i, i)[0] + onlyElements(i)[3];
console.log(sum);
