function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function afterMember(value) { return { first: 1, ...value }; }
function betweenMembers(value) { return { first: 1, ...value, last: 2 }; }
function afterSpread(object, value) { return { ...object, ...value }; }
function restOf(value) { const { first, ...rest } = value; return rest; }
function whenTrue(condition, object) { return { first: 1, ...(condition && object) }; }
for (let f of [afterMember, betweenMembers, afterSpread, restOf, whenTrue])
    noInline(f);

for (const prototype of [Boolean.prototype, Number.prototype, Symbol.prototype, BigInt.prototype, String.prototype, Object.prototype]) {
    try {
        prototype.inheritedAndEnumerable = "must not be copied";
    } catch { }
}

const keys = o => Reflect.ownKeys(o).map(String).join();
const withoutProperties = [false, true, 0, 1, -1, 1.5, -0, NaN, Infinity, 2 ** 40, Symbol("s"), Symbol.iterator, 10n, -3n, 2n ** 70n];
const rounds = 200;

for (let round = 0; round < rounds; ++round) {
    for (const value of withoutProperties) {
        check(keys(afterMember(value)), "first", "a member, then a value without properties");
        check(keys(betweenMembers(value)), "first,last", "a value without properties between members");
        check(keys(afterSpread({ a: 1 }, value)), "a", "an object, then a value without properties");
        check(keys(restOf(value)), "", "the rest of a value without properties");
    }
    check(keys(whenTrue(false, { a: 1 })), "first", "a condition that is false");
    check(keys(whenTrue(0, { a: 1 })), "first", "a condition that is zero");
}
for (let round = 0; round < rounds; ++round) {
    check(keys(afterMember("ab")), "0,1,first", "a member, then a string");
    check(afterMember("ab")[1], "b", "a character of the string");
    check(keys(afterMember("")), "first", "a member, then the empty string");
    check(keys(restOf("xyz")), "0,1,2", "the rest of a string");
    check(keys(afterSpread({ a: 1 }, "q" + round)).startsWith("0,1"), true, "an object, then a rope");
}
for (let round = 0; round < rounds; ++round) {
    check(keys(afterMember(null)), "first", "a member, then null");
    check(keys(afterMember(undefined)), "first", "a member, then undefined");
    check(keys(whenTrue(true, { a: 1 })), "first,a", "a condition that is true");
    check(keys(afterMember(new Boolean(false))), "first", "a member, then a wrapper");
    check(keys(afterMember(Object.assign(new Number(5), { own: 1 }))), "first,own", "a member, then a wrapper with a property");
    check(keys(afterMember([7])), "0,first", "a member, then an array");
}
let thrown = 0;
for (const value of [null, undefined]) {
    try {
        restOf(value);
    } catch (error) {
        thrown += error instanceof TypeError;
    }
}
check(thrown, 2, "the rest of null and of undefined");

console.log("passed");
