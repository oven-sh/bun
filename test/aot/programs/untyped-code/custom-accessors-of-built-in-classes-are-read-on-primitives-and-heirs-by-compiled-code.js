// Some built-in classes keep an accessor or a value in a table of the class, as Symbol.prototype keeps `description` and RegExp keeps `input`. Compiled code calls what the table names, for a primitive and for whatever inherits it, and asks the run time again only when the holder has changed.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const operations = ["GetById", "GetByIdAndCache", "GetByVal", "GetByValAndCache", "GetGeneric", "GetByValGeneric"];
const asked = () => operations.reduce((sum, name) => sum + count("operationAOT" + name), 0);
const show = value => typeof value === "symbol" ? String(value) : typeof value === "string" ? JSON.stringify(value) : String(value);
function attempt(label, work) { let said; try { said = show(work()); } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + said); }
const describe = value => value.description;
const marks = [Symbol("one"), Symbol(), Symbol(""), Symbol.iterator, Symbol.for("shared"), Object(Symbol("boxed")), Object.create(Symbol.prototype), { description: "own" }, "text", 1, true, 10n, [], function f() {}, Object.create(null), Object.create({ description: "inherited" })];
for (let round = 0; round < 4; round++) for (const [index, mark] of marks.entries()) attempt("round " + round + " value " + index, () => describe(mark));
const under = (value, key) => value[key];
for (let round = 0; round < 4; round++) for (const [index, mark] of marks.entries()) attempt("under a key, round " + round + " value " + index, () => under(mark, "description"));
for (let round = 0; round < 3; round++) attempt("in", () => marks.slice(5, 8).map(mark => "description" in mark).join(" "));
for (let round = 0; round < 3; round++) attempt("has own", () => [Symbol.prototype, ...marks.slice(5, 8)].map(mark => Object.hasOwn(mark, "description")).join(" "));
function store(value) { "use strict"; value.description = "stored"; return value.description; }
function storeSloppy(value) { value.description = "stored"; return value.description; }
for (let round = 0; round < 3; round++) { attempt("a strict store on a symbol", () => store(marks[0])); attempt("a sloppy store on a symbol", () => storeSloppy(marks[0])); attempt("a strict store on a boxed symbol", () => store(marks[5])); attempt("a sloppy store below the prototype", () => storeSloppy(Object.create(Symbol.prototype))); }
console.log(JSON.stringify(Object.getOwnPropertyNames(Symbol.prototype)), Reflect.ownKeys(Symbol.prototype).length);
const descriptor = Object.getOwnPropertyDescriptor(Symbol.prototype, "description");
console.log(typeof descriptor.get, descriptor.set, descriptor.enumerable, descriptor.configurable);
attempt("the getter by itself", () => descriptor.get.call(marks[0]));
attempt("the getter on a number", () => descriptor.get.call(1));
let sum = 0;
let before = asked();
for (let i = 0; i < 3000; i++) sum += describe(marks[i & 3 ? 0 : 4]).length + describe(marks[5]).length + (under(marks[i & 1], "description")?.length | 0);
console.log(sum, "the run time is asked at most 20 times for 9000 reads on symbols and on an object that holds one:", asked() - before <= 20);
// The methods beside it are read for the first time between two reads.
attempt("before the methods", () => describe(marks[0]));
attempt("toString", () => marks[0].toString());
attempt("valueOf", () => marks[0].valueOf() === marks[0]);
attempt("behind the methods", () => describe(marks[0]));
// RegExp has custom values of its own that its heirs read.
class Heir extends RegExp {}
const lastInput = constructor => constructor.input + "|" + constructor.$1 + "|" + constructor.lastMatch;
for (let round = 0; round < 4; round++) { /(b+)c/.exec("a" + "b".repeat(round + 1) + "c"); attempt("of RegExp " + round, () => lastInput(RegExp)); attempt("of an heir " + round, () => lastInput(Heir)); }
before = asked();
let text = 0;
for (let i = 0; i < 3000; i++) text += lastInput(RegExp).length;
console.log(text, "the run time is asked at most 20 times for 9000 reads on RegExp:", asked() - before <= 20);
function setInput(constructor, text) { constructor.input = text; return RegExp.input; }
for (let round = 0; round < 4; round++) { attempt("stored on RegExp " + round, () => setInput(RegExp, "r" + round)); attempt("stored on an heir " + round, () => setInput(Heir, "h" + round) + " " + Object.hasOwn(Heir, "input")); }
