function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function objectAndNumber(given, n) { let o = given === true ? { a: 1 } : undefined; let result = o && (n | 0); return result ? "truthy" : "falsy"; }
function arrayAndNumber(given, n) { let list = given === true ? [1] : null; let result = list && (n | 0); return result ? "truthy" : "falsy"; }
function mapAndFlag(given, flag) { let map = given === true ? new Map() : undefined; let result = map && flag === 0; return result ? "truthy" : "falsy"; }
function symbolAndNumber(given, n) { let symbol = given === true ? Symbol.iterator : undefined; let result = symbol && (n | 0); return result ? "truthy" : "falsy"; }
function regExpAndNumber(given, n) { let pattern = given === true ? /a/ : null; let result = pattern && (n | 0); return result ? "truthy" : "falsy"; }
function returnsMissingObject(which) { let o = which === 0 ? { a: 1 } : which === 1 ? undefined : null; if (!o) return o; return 1; }
function returnsMissingArray(which) { let list = which === 0 ? [] : which === 1 ? undefined : null; if (list) return 1; return list; }
function objectOrZero(which) { let v = which === 0 ? { a: 1 } : which === 1 ? 0 : which === 2 ? -0 : NaN; if (!v) return v; return 1; }
function objectOrFlag(which) { let v = which === 0 ? [] : which === 1 ? false : true; let result = v && 7; return result ? "truthy" : "falsy"; }
function lastOfChain(length) { let node = null; for (let i = 0; i < length; ++i) node = { next: node }; let steps = 0; while (node) { node = node.next === null ? null : { next: null }; ++steps; } return node === null ? steps : -1; }
const narrowed = [objectAndNumber, arrayAndNumber, mapAndFlag, symbolAndNumber, regExpAndNumber, returnsMissingObject, returnsMissingArray, objectOrZero, objectOrFlag];
for (let f of [...narrowed, lastOfChain])
    noInline(f);

for (let f of [objectAndNumber, arrayAndNumber, symbolAndNumber, regExpAndNumber])
    check(f(true, 1) + f(true, 0) + f(false, 1) + f(false, 0), "truthyfalsyfalsyfalsy", f.name);
check(mapAndFlag(true, 0) + mapAndFlag(true, 1) + mapAndFlag(false, 0), "truthyfalsyfalsy", "a map and a boolean");
check([0, 1, 2].map(returnsMissingObject).map(String).join(), "1,undefined,null", "an object that is missing");
check([0, 1, 2].map(returnsMissingArray).map(String).join(), "1,undefined,null", "an array that is missing");
check(objectOrZero(0), 1, "an object and not a number");
check(objectOrZero(1), 0, "zero and not an object");
check(objectOrZero(2), -0, "negative zero and not an object");
check(objectOrZero(3), NaN, "NaN and not an object");
check([0, 1, 2].map(objectOrFlag).join(), "truthy,falsy,truthy", "an array or a boolean");
check([0, 1, 3].map(lastOfChain).join(), "0,1,2", "a loop that ends at null");

function functionAndNumber(given, n) { let f = given ? () => 1 : undefined; let result = f && (n | 0); return result ? "truthy" : "falsy"; }
function stringAndNumber(which, n) { let text = which === 0 ? "text" : which === 1 ? "" : undefined; let result = text && (n | 0); return result === "" ? "empty" : result ? "truthy" : "falsy"; }
function bigIntAndNumber(which, n) { let big = which === 0 ? 1n : which === 1 ? 0n : undefined; let result = big && (n | 0); return result === 0n ? "zero" : result ? "truthy" : "falsy"; }
function anythingAndNumber(v, n) { return v && (n | 0); }
function anythingOrNumber(v, n) { return v || (n | 0); }
function returnsFalsyAnything(v) { if (!v) return v; return "truthy"; }
function objectThatIsNotUsed(given) { let o = given ? { a: 1 } : undefined; if (!o) return 0; return o.a; }
const notNarrowed = [functionAndNumber, stringAndNumber, bigIntAndNumber, anythingAndNumber, anythingOrNumber, returnsFalsyAnything, objectThatIsNotUsed];
for (let f of notNarrowed)
    noInline(f);

check(functionAndNumber(true, 1) + functionAndNumber(true, 0) + functionAndNumber(false, 1), "truthyfalsyfalsy", "a function and a number");
check([0, 1, 2].map(which => stringAndNumber(which, 1)).join(), "truthy,empty,falsy", "a string and a number");
check([0, 1, 2].map(which => bigIntAndNumber(which, 1)).join(), "truthy,zero,falsy", "a BigInt and a number");
const falsyValues = [undefined, null, false, 0, -0, NaN, "", 0n], truthyValues = [true, 1, -1, "0", "false", 1n, Symbol.iterator, {}, [], () => 0, /a/, new Map(), new Date(0), new Boolean(false), new String("")];
for (let v of falsyValues) {
    check(anythingAndNumber(v, 5), v, "a falsy value and a number");
    check(anythingOrNumber(v, 5), 5, "a falsy value or a number");
    check(returnsFalsyAnything(v), v, "a falsy value that is returned");
}
for (let v of truthyValues) {
    check(anythingAndNumber(v, 5), 5, "a truthy value and a number");
    check(anythingOrNumber(v, 5), v, "a truthy value or a number");
    check(returnsFalsyAnything(v), "truthy", "a truthy value that is tested");
}
if (typeof makeMasquerader === "function") {
    let masquerader = makeMasquerader();
    check(anythingAndNumber(masquerader, 5), masquerader, "an object that masquerades as undefined and a number");
    check(anythingOrNumber(masquerader, 5), 5, "an object that masquerades as undefined or a number");
    check(returnsFalsyAnything(masquerader), masquerader, "an object that masquerades as undefined and is returned");
}
check(objectThatIsNotUsed(true) + objectThatIsNotUsed(false), 1, "an object that is not used where it is missing");
console.log("passed");
