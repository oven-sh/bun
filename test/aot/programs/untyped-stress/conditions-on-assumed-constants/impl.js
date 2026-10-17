const failures = [];

function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        failures.push(what + ": " + String(actual) + " instead of " + String(expected));
}

function builtinFunction() { return Math.floor ? "a" : "b"; }
function builtinObject() { return Math ? "a" : "b"; }
function builtinString() { return Math[Symbol.toStringTag] == null ? "a" : "b"; }
function predicateOfNumber(n) { var x = n | 0; return Array.isArray(x) ? "a" : "b"; }
function integerOfInt32(n) { var x = n | 0; return Number.isInteger(x) ? "a" : "b"; }
function typeofOfString(s) { var x = "" + s; return typeof x === "function" ? "a" : "b"; }
function nullOfNumber(n) { var x = +n; return x == null ? "a" : "b"; }
function undefinedOfNumber(n) { var x = +n; return x === undefined ? "a" : "b"; }
function coalesceOfString(s) { var x = "" + s; return x ?? "b"; }
function callByPath(v) { return Math.floor.call(null, v); }
function undecided(x) { return x ? "a" : "b"; }
const all = [builtinFunction, builtinObject, builtinString, predicateOfNumber, integerOfInt32, typeofOfString, nullOfNumber, undefinedOfNumber, coalesceOfString, callByPath, undecided];
for (const f of all)
    noInline(f);

for (let i = 0; i < 20; ++i)
    check([builtinFunction(), builtinObject(), builtinString(), predicateOfNumber(i), integerOfInt32(i), typeofOfString(i), nullOfNumber(i), undefinedOfNumber(i), coalesceOfString(1), callByPath(1.5), undecided(0), undecided(1)].join(), "a,a,b,b,a,b,b,b,1,1,b,a", "the values");

if (failures.length)
    throw new Error(failures.length + " failures:\n" + [...new Set(failures)].join("\n"));
console.log("passed");
