// Symbols that the program makes once and keeps in constants, used as keys of properties: each is a key like no other, and everything that lists, copies or compares keys sees it so.
"use strict";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
function outcome(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }

show("read before it is made", outcome(() => early({})));
function early(object) { return object[kName]; }

const kName = Symbol("name");
const kSame = Symbol("name");
const kBare = Symbol();
const kEmpty = Symbol("");
const kOdd = Symbol("a:b;c@d é 日本");
let kNeverStoredAgain = Symbol("let");
let kChanged = Symbol("first");
var kVar = Symbol("var");
const kCopy = kName;
const all = [kName, kSame, kBare, kEmpty, kOdd, kNeverStoredAgain, kChanged, kVar];

show("texts", all.map(String).join());
show("descriptions", all.map(symbol => typeof symbol.description + " " + symbol.description).join());
show("types", all.map(symbol => typeof symbol).join());
show("all differ", new Set(all).size);
show("a copy is the same", kCopy === kName && kSame !== kName);
show("not registered", Symbol.keyFor(kName));
show("no text by itself", outcome(() => "" + kName) + " " + outcome(() => `${kBare}`) + " " + outcome(() => kName + 1));

function Thing(value) {
    this.first = value;
    this[kName] = value + 1;
    this[kSame] = value + 2;
    this.second = value + 3;
    this[kBare] = value + 4;
    this[kEmpty] = value + 5;
    this[kOdd] = value + 6;
    this[kNeverStoredAgain] = value + 7;
    this[kChanged] = value + 8;
    this[kVar] = value + 9;
}
Thing.prototype[kName] = "never seen";
Thing.prototype[kCopy] = "nor this";
const kInherited = Symbol("inherited");
Thing.prototype[kInherited] = "from the prototype";
Thing.prototype.sum = function () { return this[kName] + this[kSame] + this[kBare] + this[kEmpty] + this[kOdd] + this[kNeverStoredAgain] + this[kChanged] + this[kVar]; };
Thing.prototype.bump = function () { this[kName]++; this[kBare] += 2; this[kEmpty] = this[kEmpty] * 2; return this[kInherited]; };

let total = 0;
let last;
for (let i = 0; i < 300; i++) {
    last = new Thing(i);
    if (last.bump() === "from the prototype") total += last.sum();
}
show("total", total);
show("keys", Object.keys(last).join());
show("own names", Object.getOwnPropertyNames(last).join());
show("own symbols", Object.getOwnPropertySymbols(last).map(String).join());
show("the symbols listed are the constants", Object.getOwnPropertySymbols(last).every((symbol, index) => symbol === all[index]));
show("all own keys", Reflect.ownKeys(last).map(String).join());
show("as JSON", JSON.stringify(last));
const seen = [];
for (const key in last) seen.push(key);
show("for in", seen.join());
show("entries", Object.entries(last).length);
const spread = { ...last };
const assigned = Object.assign({}, last);
show("copies", [spread[kName], assigned[kOdd], spread[kInherited], Object.getOwnPropertySymbols(spread).length, Object.getOwnPropertySymbols(assigned).length].join());
const { [kName]: taken, [kBare]: takenToo, ...others } = last;
show("taken apart", [taken, takenToo, Object.getOwnPropertySymbols(others).length, others[kName], others[kSame]].join());

show("in", [kName in last, kInherited in last, kName in {}, kInherited in Object.create(last)].join());
show("own", [Object.hasOwn(last, kName), Object.hasOwn(last, kInherited), last.hasOwnProperty(kBare), Object.prototype.propertyIsEnumerable.call(last, kOdd)].join());
show("deleted", [delete last[kName], last[kName], kName in last, Object.hasOwn(last, kName), delete last[kName]].join());
last[kName] = "again";
show("comes last now", Reflect.ownKeys(last).map(String).pop() + " " + last[kName]);

function readBy(object, key) { return object[key]; }
function storeBy(object, key, value) { object[key] = value; }
show("by a key that is handed over", [readBy(last, kSame), readBy(last, all[2]), readBy(last, Object(kOdd)), readBy(last, kInherited)].join());
storeBy(last, kSame, "stored by a key that is handed over");
show("and read by the constant", last[kSame]);
last[kOdd] = "stored by the constant";
show("and read by a key that is handed over", readBy(last, Object.getOwnPropertySymbols(last).find(symbol => String(symbol).includes("a:b"))));

kChanged = Symbol("second");
show("the variable was stored to again", [last[kChanged], String(kChanged), readBy(last, all[6])].join());
last[kChanged] = "under the second";
show("both are there", Object.getOwnPropertySymbols(last).filter(symbol => symbol.description === "first" || symbol.description === "second").length);

const made = [];
for (let i = 0; i < 3; i++) {
    const kLoop = Symbol("loop");
    made.push(kLoop);
    last[kLoop] = i;
}
function fresh() { const kLocal = Symbol("local"); const holder = { [kLocal]: 1 }; return [kLocal, holder[kLocal]]; }
show("one each time", [new Set(made).size, made.map(symbol => last[symbol]).join(""), fresh()[0] === fresh()[0], fresh()[1]].join());
const kEither = total > 0 ? Symbol("yes") : Symbol("no");
last[kEither] = "either";
show("one of two", String(kEither) + " " + last[kEither]);

let got = 0;
const kAccessor = Symbol("accessor");
const kFixed = Symbol("fixed");
const guarded = {
    get [kAccessor]() { return "got " + got; },
    set [kAccessor](value) { got = value; },
    [kName]() { return "a method under " + String(kName); },
};
Object.defineProperty(guarded, kFixed, { value: "fixed", writable: false, enumerable: false, configurable: false });
guarded[kAccessor] = 7;
show("accessors", [guarded[kAccessor], guarded[kName](), guarded[kName].name, Object.getOwnPropertyDescriptor(guarded, kAccessor).set.name].join());
show("may not be written", [outcome(() => { guarded[kFixed] = 1; }), guarded[kFixed], outcome(() => delete guarded[kFixed]), Object.keys(Object.getOwnPropertyDescriptors(guarded)).length].join());
const frozen = Object.freeze({ [kName]: 1 });
show("frozen", [outcome(() => { frozen[kName] = 2; }), outcome(() => { frozen[kBare] = 2; }), frozen[kName], frozen[kBare]].join());

class Base {
    [kName] = "a field";
    static [kBare] = "a static field";
    [kSame]() { return "a method"; }
    get [kEmpty]() { return "a getter"; }
    static [kOdd]() { return "a static method"; }
}
class Derived extends Base {
    [kSame]() { return super[kSame]() + " and more"; }
}
const derived = new Derived();
show("classes", [derived[kName], Base[kBare], Derived[kBare], derived[kSame](), derived[kEmpty], Derived[kOdd](), Object.getOwnPropertySymbols(derived).length, Object.getOwnPropertySymbols(Base.prototype).length].join());

show("no object", [outcome(() => undefined[kName]), outcome(() => null[kName]), outcome(() => { undefined[kName] = 1; }), outcome(() => kName in 1)].join());
show("what is no plain object", ["text"[kName], (5)[kName], true[kName], [1, 2][kName], (() => 1)[kName], kName[kName]].join());
const list = [1, 2, 3];
list[kName] = "on an array";
function callable() { }
callable[kName] = "on a function";
const map = new Map([[kName, "in a map"]]);
map[kName] = "on a map";
show("on other objects", [list[kName], list.length, callable[kName], map[kName], map.get(kName), Object.keys(list).join("")].join());
const handler = { get(target, key) { return typeof key === "symbol" ? "asked for " + String(key) + " " + (key === kName) : target[key]; }, has(target, key) { return key === kBare; } };
const proxy = new Proxy({}, handler);
show("a proxy", [proxy[kName], proxy[kSame], kBare in proxy, kName in proxy].join());
const bare = Object.create(null);
bare[kName] = 1;
show("without a prototype", [bare[kName], bare[kInherited], kName in bare].join());

const kShared = Symbol.for("shared by its text");
const kSharedToo = Symbol.for("shared by its text");
function sharedAgain() { return Symbol.for("shared by " + ["its", "text"].join(" ")); }
const registered = { [kShared]: "registered" };
registered[kSharedToo] += ", one key";
show("registered", [kShared === kSharedToo, kShared === sharedAgain(), registered[kShared], registered[sharedAgain()], Symbol.keyFor(kShared), String(kShared), Object.getOwnPropertySymbols(registered).length, Symbol.for("name") === kName].join());
let countOfShared = 0;
for (let i = 0; i < 100; i++) {
    const holder = {};
    holder[Symbol.for("made in a loop")] = i;
    countOfShared += holder[Symbol.for("made in a loop")] + (Symbol.for("made in a loop") in holder ? 1 : 0);
}
show("registered in a loop", countOfShared);
const passedOn = (symbol => ({ [symbol]: "passed on at once", symbol }))(Symbol("never kept"));
show("never kept", [passedOn[passedOn.symbol], String(passedOn.symbol)].join());
console.log(lines.join("\n"));
