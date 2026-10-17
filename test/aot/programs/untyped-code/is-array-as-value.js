// Array.isArray kept in a variable, as libraries do (`const isArray = Array.isArray`), handed on, called through call | apply | bind, in tail position, with no argument and with many:
// arrays, heirs of Array, proxies of arrays and of other things, a revoked proxy, typed arrays, arguments, array-likes, primitives.
const isArray = Array.isArray;
const lines = [];
class Heir extends Array {}
function args() { return arguments; }
const revocable = Proxy.revocable([], {});
const values = [[], [1], new Array(3), new Heir, Heir.of(1, 2), new Proxy([], {}), new Proxy(new Proxy(new Heir, {}), {}), new Proxy({}, {}), new Proxy(function () {}, {}),
    new Uint8Array(2), args(1, 2), { length: 0 }, Object.create([]), Object.create(Array.prototype), Array.prototype, "text", "", 0, 1.5, NaN, null, undefined, true, Symbol.iterator, 10n, function () {}, Array, new Map, Object.freeze([1]), Object.setPrototypeOf([], null)];
const show = answers => answers.map(x => x === true ? "T" : x === false ? "f" : String(x)).join("");
const tail = x => isArray(x);
const holder = { isArray, other: isArray };
const bound = isArray.bind(null);
const boundToValue = isArray.bind(null, []);
for (let round = 0; round < 3; round++) {
    lines.push(show(values.map(x => isArray(x))));
    lines.push(show(values.map(tail)));
    lines.push(show(values.map(isArray)));
    lines.push(show(values.map(x => holder.isArray(x))) + " " + show(values.map(x => holder.other(x, 1, 2))));
    lines.push(show(values.map(x => isArray.call(x, x))) + " " + show(values.map(x => isArray.apply(null, [x]))) + " " + show(values.map(x => Reflect.apply(isArray, x, [x]))));
    lines.push(show(values.map(x => bound(x))) + " " + show(values.map(x => boundToValue(x))));
    lines.push(show([isArray(), isArray.call(), isArray.call([]), isArray([], {}), isArray({}, [])]));
}
revocable.revoke();
for (let round = 0; round < 3; round++) {
    try { lines.push(String(isArray(revocable.proxy))); } catch (error) { lines.push(error.constructor.name); }
}
let count = 0;
for (let i = 0; i < 30000; i++) count += isArray(values[i % values.length]) ? 1 : 0;
lines.push(String(count), typeof isArray + " " + isArray.name + " " + isArray.length + " " + (isArray === Array.isArray));
console.log(lines.join("\n"));
