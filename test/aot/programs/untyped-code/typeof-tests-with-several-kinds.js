// Tests that several kinds of value pass (typeof x === "function", a number or nothing, a string or a function ..) answer as in plain Bun for every kind of value, as a condition and as a value.
const parsed = JSON.parse('{"zero":0,"five":5,"large":4294967296,"fraction":1.5,"text":"a","empty":"","list":[1],"object":{"k":1},"nothing":null,"yes":true,"no":false}');
const doubles = new Float64Array([5, -0, NaN, Infinity]);
class Plain {}
const values = [
    undefined, parsed.nothing, parsed.yes, parsed.no, parsed.zero, parsed.five, parsed.large, parsed.fraction, -1, 2147483647, -2147483648, 2147483648,
    doubles[0], doubles[1], doubles[2], doubles[3], parsed.text, parsed.empty, "function", Symbol("s"), Symbol.iterator, 10n, 0n,
    parsed.object, parsed.list, new Plain(), Plain, function () {}, () => 1, async () => 1, function* () {}, Math.max, (function () {}).bind(null),
    new Proxy(function () {}, {}), new Proxy({}, {}), new Proxy(Plain, {}), new Map(), /x/, new Date(0), Object.create(null), Object(1), Object("s"),
];

function isFunction(x) { return typeof x === "function" ? 1 : 0; }
function isFunctionValue(x) { return typeof x === "function"; }
function isNumberOrNothing(x) { return typeof x === "number" || x === undefined || x === null ? 1 : 0; }
function isNumberOrUndefined(x) { return typeof x === "number" || x === undefined ? 1 : 0; }
function isBooleanOrNumber(x) { return typeof x === "boolean" || typeof x === "number" ? 1 : 0; }
function isStringOrFunction(x) { return typeof x === "string" || typeof x === "function" ? 1 : 0; }
function isStringOrNumber(x) { return typeof x === "string" || typeof x === "number"; }
function isFunctionOrNothing(x) { return x == null || typeof x === "function" ? 1 : 0; }
function isObjectOrFunction(x) { return (typeof x === "object" && x !== null) || typeof x === "function" ? 1 : 0; }
function isPrimitiveCell(x) { return typeof x === "string" || typeof x === "symbol" || typeof x === "bigint" ? 1 : 0; }
function isBigIntOrFunction(x) { return typeof x === "bigint" || typeof x === "function"; }
function isNoFunction(x) { return typeof x !== "function" ? 1 : 0; }
function callsIfFunction(x) {
    if (typeof x !== "function")
        return "no";
    try {
        return typeof x();
    } catch (error) {
        return error.constructor.name;
    }
}

const tests = [isFunction, isFunctionValue, isNumberOrNothing, isNumberOrUndefined, isBooleanOrNumber, isStringOrFunction, isStringOrNumber, isFunctionOrNothing, isObjectOrFunction, isPrimitiveCell, isBigIntOrFunction, isNoFunction];
for (const test of tests) {
    let line = "";
    for (let round = 0; round < 3; ++round) {
        line = "";
        for (const value of values)
            line += Number(test(value));
    }
    console.log(test.name, line);
}
console.log(values.map(callsIfFunction).join(" "));
