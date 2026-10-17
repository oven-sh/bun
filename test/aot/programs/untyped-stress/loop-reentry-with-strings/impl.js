function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const one = { one: 1 };

function literalThenNumbers(o) { let k = 1; const a = [k, k, k, k]; let x = "start"; let hits = 0; for (let i = 0; i < 4; i++) { if (x === 1) hits += o.one; x = a[i]; } return hits; }
function literalThenNumbersFrom(o, start) { let k = 1; const a = [k, k, k, k, k, k]; let x = "start"; let hits = 0; for (let i = start | 0; i < 6; i++) { if (x === 1) hits += o.one; x = a[i]; } return hits; }
function equalsLiteral(o, other, start) { let k = 1; const a = [k, k, k, k, k, k]; Reflect.set(a, 2, other); let x = "start"; let hits = 0; for (let i = start | 0; i < 6; i++) { if (x === "start") hits += o.one; x = a[i]; } return hits; }
function equalsLiteralLoosely(o, other, start) { let k = 1; const a = [k, k, k, k, k, k]; Reflect.set(a, 2, other); let x = "start"; let hits = 0; for (let i = start | 0; i < 6; i++) { if (x == "start") hits += o.one; x = a[i]; } return hits; }
function selectsLiteral(o, other, start) { let k = 1; const a = [k, k, k, k, k, k]; Reflect.set(a, 2, other); let x = "start"; let hits = 0; for (let i = start | 0; i < 6; i++) { switch (x) { case "start": hits += o.one; break; case "stop": hits += 10 * o.one; break; } x = a[i]; } return hits; }
function isTruthy(o, other, start) { let k = 1; const a = [k, k, k, k, k, k]; Reflect.set(a, 2, other); let x = "start"; let hits = 0; for (let i = start | 0; i < 6; i++) { if (typeof x === "string") { if (x) hits += o.one; } x = a[i]; } return hits; }
function equalsAnyString(o, text, other, start) { let k = 1; const a = [k, k, k, k, k, k]; Reflect.set(a, 2, other); let x = "" + text; let hits = 0; for (let i = start | 0; i < 6; i++) { if (x === "start") hits += o.one; x = a[i]; } return hits; }
const all = [literalThenNumbers, literalThenNumbersFrom, equalsLiteral, equalsLiteralLoosely, selectsLiteral, isTruthy, equalsAnyString];
for (let f of all)
    noInline(f);

check(literalThenNumbers(one), 3, "a literal, then numbers");
for (let start = 0; start < 7; start++)
    check(literalThenNumbersFrom(one, start), Math.max(5 - start, 0), "a literal, then numbers, from " + start);

const long = "start".padEnd(200, "!");
const strings = [
    ["the literal", "start", 2, 2, 2],
    ["another literal", "stop", 1, 11, 2],
    ["an equal string that was joined", ["sta", "rt"].join(""), 2, 2, 2],
    ["an equal string that was sliced", "restarted".slice(2, 7), 2, 2, 2],
    ["an equal rope", (s => s + "rt")(String.fromCharCode(115, 116, 97)), 2, 2, 2],
    ["an equal string of 16-bit characters", "startĀ".slice(0, 5), 2, 2, 2],
    ["another string that was joined", ["st", "op"].join(""), 1, 11, 2],
    ["a string of the same length", ["sta", "rs"].join(""), 1, 1, 2],
    ["a long string", long, 1, 1, 2],
    ["a long rope", (s => s + long)(long), 1, 1, 2],
    ["an empty string", "", 1, 1, 1],
    ["an empty string that was sliced", "start".slice(5), 1, 1, 1],
    ["a number", 7, 1, 1, 1],
    ["undefined", undefined, 1, 1, 1],
    ["a symbol", Symbol("start"), 1, 1, 1],
];
for (let [what, value, equal, selected, truthy] of strings) {
    check(equalsLiteral(one, value, 0), equal, "equal to the literal: " + what);
    check(equalsLiteralLoosely(one, value, 0), equal, "loosely equal to the literal: " + what);
    check(selectsLiteral(one, value, 0), selected, "selected by the literal: " + what);
    check(isTruthy(one, value, 0), truthy, "truthy: " + what);
    check(equalsAnyString(one, "start", value, 0), equal, "equal to the literal, after any string: " + what);
    check(equalsAnyString(one, "other", value, 0), equal - 1, "equal to the literal, after any other string: " + what);
}
check(equalsLiteral(one, new String("start"), 0), 1, "equal to the literal: a wrapped string");
check(equalsLiteralLoosely(one, new String("start"), 0), 2, "loosely equal to the literal: a wrapped string");
console.log("passed");
