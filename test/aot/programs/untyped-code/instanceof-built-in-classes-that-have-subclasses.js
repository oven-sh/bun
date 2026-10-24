// `value instanceof Promise` and its like in a program that also extends these classes and makes code from text: what counts is the prototype chain.
class OwnPromise extends Promise {}
class DeeperPromise extends OwnPromise {}
class OwnMap extends Map {}
class OwnArray extends Array {}
class OwnError extends TypeError {}
class OwnDate extends Date {}
class OwnRegExp extends RegExp {}
class OwnSet extends Set {}
const fromText = new Function("return class extends Promise {}")();
const nothing = () => {};

function isPromise(value) { return value instanceof Promise; }
function isMap(value) { return value instanceof Map; }
function isArray(value) { return value instanceof Array; }
function isError(value) { return value instanceof Error; }
function isTypeError(value) { return value instanceof TypeError; }
function isDate(value) { return value instanceof Date; }
function isRegExp(value) { return value instanceof RegExp; }
function isSet(value) { return value instanceof Set; }
function twice(value, context) {
    if (value instanceof Promise && context?.async === false) return "refused";
    return value instanceof Promise ? "later" : "now";
}
function kind(value) {
    if (value instanceof Promise) return "Promise";
    if (value instanceof Map) return "Map";
    if (value instanceof Set) return "Set";
    if (value instanceof Array) return "Array";
    if (value instanceof Date) return "Date";
    if (value instanceof RegExp) return "RegExp";
    if (value instanceof Error) return "Error";
    return "none";
}

const stripped = new OwnPromise(nothing);
Object.setPrototypeOf(stripped, Object.prototype);
const adopted = {};
Object.setPrototypeOf(adopted, OwnPromise.prototype);
const bareMap = new Map();
Object.setPrototypeOf(bareMap, null);
const swapped = new OwnMap();
Object.setPrototypeOf(swapped, OwnArray.prototype);
const values = [
    undefined, null, true, 0, 1.5, "text", Symbol("s"), 10n, {}, [], nothing, Object.create(null),
    new Promise(nothing), new OwnPromise(nothing), new DeeperPromise(nothing), new fromText(nothing), Promise.resolve(1), OwnPromise.resolve(1), (async () => {})(),
    Object.create(Promise.prototype), Object.create(OwnPromise.prototype), Object.create(Object.create(DeeperPromise.prototype)), stripped, adopted,
    new Proxy(new OwnPromise(nothing), {}), new Proxy({}, { getPrototypeOf() { return Promise.prototype; } }), new Proxy({}, { getPrototypeOf() { return OwnMap.prototype; } }),
    new Map(), new OwnMap(), bareMap, swapped, new Set(), new OwnSet(), new OwnArray(3), OwnArray.from([1]), new OwnArray(1, 2).map((x) => x),
    new Error("e"), new TypeError("t"), new OwnError("o"), new RangeError("r"), new Date(0), new OwnDate(0), /x/, new OwnRegExp("y"),
    Promise, OwnPromise, Promise.prototype, OwnPromise.prototype, Map.prototype, Array.prototype, Error.prototype,
];
const tests = [isPromise, isMap, isArray, isError, isTypeError, isDate, isRegExp, isSet];
for (let round = 0; round < 3; round++) {
    console.log(values.map((value) => tests.map((test) => (test(value) ? "1" : "0")).join("")).join(" "));
    console.log(values.map(kind).join(" "));
    console.log(values.map((value) => twice(value, round ? { async: round === 1 } : undefined)).join(" "));
}

const late = new OwnPromise(nothing);
const answers = [isPromise(late), kind(late)];
Object.setPrototypeOf(late, OwnMap.prototype);
answers.push(isPromise(late), isMap(late), kind(late));
Object.setPrototypeOf(OwnPromise.prototype, OwnError.prototype);
answers.push(isPromise(new OwnPromise(nothing)), isError(new OwnPromise(nothing)), isPromise(new DeeperPromise(nothing)), kind(new DeeperPromise(nothing)), isPromise(new Promise(nothing)));
console.log(answers.join(" "));
