const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTDeleteByVal") + count("operationAOTDeleteByValSloppy");

const strip = (object, keys) => { for (const key of keys) delete object[key]; return object; };
const show = object => JSON.stringify(object) + " " + Reflect.ownKeys(object).map(String).join();
const mark = Symbol("mark");

const styles = ["error", "errorStyles", "errorScripts", "template", "templateStyles", "notFound", "forbidden", "unauthorized"];
const page = n => ({ layout: n, error: 1, errorStyles: 2, errorScripts: 3, template: 4, templateStyles: 5, notFound: 6, forbidden: 7, unauthorized: 8, page: -n });
const few = n => ({ error: n, page: n });
const wide = n => { const made = {}; for (let i = 0; i < 12; i++) made["name" + i] = n + i; made.error = "e"; made.forbidden = "f"; made[mark] = "m"; return made; };

for (let i = 0; i < 30; i++) { strip(page(i), styles); strip(few(i), styles); strip(wide(i), styles); strip({}, styles); }
console.log("a literal:", show(strip(page(1), styles)));
console.log("one with few of the names:", show(strip(few(2), styles)));
console.log("one with storage out of line:", show(strip(wide(3), styles)));
console.log("an empty one:", show(strip({}, styles)));
console.log("backwards:", show(strip(page(4), styles.slice().reverse())));
console.log("some:", show(strip(page(5), ["template", "nothing", "layout"])));
console.log("under a symbol:", show(strip(wide(6), [mark, "name3", mark])));

const again = strip(page(7), styles);
again.error = "back"; again.forbidden = "too";
console.log("set again behind the deletion:", show(again), again.error, again.template);
console.log("and deleted once more:", show(strip(again, styles)));

const held = page(8);
const values = () => styles.map(key => String(held[key])).join();
console.log("read before:", values());
strip(held, styles.slice(0, 4));
console.log("read between:", values(), "error" in held, Object.hasOwn(held, "notFound"));
strip(held, styles);
console.log("read behind:", values(), Object.keys(held).join());

const indexed = n => ({ 0: n, 1: n + 1, 12: n + 12, error: n, "-1": "minus", "1.5": "half" });
const indices = ["0", "12", "error", "-1", "1.5", "7"];
for (let i = 0; i < 30; i++) strip(indexed(i), indices);
console.log("names that are indices:", show(strip(indexed(9), indices)));
console.log("only one of them:", show(strip(indexed(10), ["12"])), show(strip(indexed(11), [12, 0])));
console.log("an object of the same kind keeps its elements:", show(strip(indexed(12), ["7", "error"])));

const parent = { error: "the parent's", template: "the parent's" };
const child = n => { const made = Object.create(parent); made.error = n; made.page = n; return made; };
for (let i = 0; i < 30; i++) strip(child(i), styles);
const orphan = strip(child(13), styles);
console.log("what is inherited shows through:", show(orphan), orphan.error, orphan.template);
strip(parent, ["error"]);
console.log("the parent loses a name:", show(parent), orphan.error, child(14).error, strip(child(15), styles).error);
parent.error = "the parent's again";
console.log("and has it again:", strip(child(16), styles).error);

const withAccessors = n => ({ get error() { return n; }, set template(v) { }, notFound: n, get forbidden() { return -n; }, set forbidden(v) { } });
for (let i = 0; i < 30; i++) strip(withAccessors(i), styles);
console.log("accessors:", show(strip(withAccessors(17), styles)), show(strip(withAccessors(18), ["forbidden"])));

const attempt = (label, make, keys) => {
    for (let i = 0; i < 12; i++) { try { strip(make(), keys); } catch { } }
    const made = make();
    const left = () => Reflect.ownKeys(Object(made)).map(String).join();
    try { strip(made, keys); console.log(label + ":", "deleted", left()); } catch (error) { console.log(label + ":", error instanceof TypeError, left()); }
};
attempt("frozen", () => Object.freeze(page(1)), styles);
attempt("sealed", () => Object.seal(few(1)), styles);
attempt("not extensible", () => Object.preventExtensions(few(1)), styles);
attempt("one name that stays", () => Object.defineProperty(page(1), "template", { value: 1, configurable: false }), styles);
attempt("frozen, names it lacks", () => Object.freeze({ other: 1 }), styles);
attempt("an array", () => Object.assign([1, 2, 3], { error: 1 }), ["error", "1", "nothing"]);
attempt("the length of an array", () => [1, 2, 3], ["length"]);
attempt("a function", () => Object.assign(function named(a, b) { }, { error: 1 }), ["error", "name", "length", "nothing"]);
attempt("the prototype of a function", () => function named() { }, ["prototype"]);
attempt("a class", () => class Named { static error = 1; static other() { } }, ["error", "other", "name"]);
attempt("an instance", () => new (class { error = 1; template = 2; #hidden = 3; page = 4; })(), styles);
attempt("a map", () => Object.assign(new Map(), { error: 1 }), styles);
attempt("a string object", () => Object.assign(new String("ab"), { error: 1 }), ["error", "nothing"]);
attempt("a character of a string object", () => new String("ab"), ["0"]);
attempt("a typed array", () => Object.assign(new Uint8Array(2), { error: 1 }), ["error", "5"]);
attempt("an element of a typed array", () => new Uint8Array(2), ["1"]);
attempt("arguments", () => (function () { return arguments; })(1, 2), ["0", "length", "callee", "nothing"]);
attempt("no parent", () => Object.assign(Object.create(null), page(1)), styles);
attempt("a number", () => 5, styles);
attempt("a string", () => "text", ["nothing"]);
attempt("the length of a string", () => "text", ["length"]);
const log = [];
attempt("a proxy", () => new Proxy(page(1), { deleteProperty(target, key) { log.push(String(key)); return key !== "template" && Reflect.deleteProperty(target, key); } }), styles);
console.log("the trap saw:", log.slice(-4).join());
for (const nothing of [null, undefined]) { try { strip(nothing, styles); console.log("no error"); } catch (error) { console.log(error instanceof TypeError); } }
let asked = 0;
const key = { toString() { asked++; return "error"; } };
console.log("a key that is an object:", show(strip(page(19), [key, key])), asked);

const many = {};
for (let i = 0; i < 300; i++) many["k" + i] = i;
const names = Object.keys(many);
strip(many, names.slice(0, 290));
console.log("hundreds of names gone from one object:", show(many));
many.error = 1;
console.log("and one more:", show(strip(many, styles)));

let kept = 0;
const round = i => { kept += Object.keys(strip(page(i), styles)).length + Object.keys(strip(few(i), styles)).length + Object.keys(strip(wide(i), styles)).length + Object.keys(strip({ page: i }, styles)).length; };
for (let i = 0; i < 300; i++) round(i);
const before = visits();
for (let i = 0; i < 1000; i++) round(i);
const visited = visits() - before;
console.log("names kept:", kept);
console.log("the run time is asked at most 300 times for 32000 deletions at one place:", typeof aotOperationCount !== "function" || visited <= 300);
