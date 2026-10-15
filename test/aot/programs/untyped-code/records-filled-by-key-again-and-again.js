// `{}` filled by key in a loop, in functions that run again: with the same names every time, with names of its own, with both; and everything one can see of such an object.
"use strict";
const lines = [];
function fill(names, from) {
    const record = {};
    for (let i = 0; i < names.length; i++) record[names[i]] = from + i;
    return record;
}
function fillBare(names, from) {
    const record = { __proto__: null };
    for (let i = 0; i < names.length; i++) record[names[i]] = from + i;
    return record;
}
function count(words) {
    const counts = {};
    for (const word of words) counts[word] = (counts[word] ?? 0) + 1;
    return counts;
}
function describe(record) {
    return Reflect.ownKeys(record).map(key => String(key) + "=" + String(record[key])).join() + " | " + JSON.stringify(record) + " | " + Object.keys({ ...record }).length;
}
const recurring = ["host", "accept", "user-agent", "cookie"];
for (let round = 0; round < 8; round++) lines.push("the same names, round " + round + ": " + describe(fill(recurring, round * 10)));
for (let round = 0; round < 4; round++) lines.push("names of its own, round " + round + ": " + describe(fill(["a" + round, "b" + round, "c" + round], round)));
for (let round = 0; round < 6; round++) lines.push("the same two, then its own: " + describe(fill(["id", "kind", "x" + round, "tail"], round)));
for (let round = 0; round < 6; round++) lines.push("in another order: " + describe(fill(round & 1 ? ["p", "q", "r"] : ["r", "q", "p"], round)));
for (let round = 0; round < 5; round++) lines.push("without a prototype: " + describe(fillBare(recurring, round)) + " " + (Object.getPrototypeOf(fillBare(recurring, 0)) === null));
const mark = Symbol("mark");
for (let round = 0; round < 5; round++) lines.push("a symbol, an index, a name twice: " + describe(fill(["n", mark, "7", "n", 3, "m"], round)));
for (let round = 0; round < 4; round++) {
    const parent = { inherited: round };
    const record = fill(["before", "__proto__", "after"].map((name, i) => name), 0);
    lines.push("__proto__ given a number: " + describe(record) + " " + (Object.getPrototypeOf(record) === Object.prototype));
    const other = {};
    for (const [name, value] of [["before", 1], ["__proto__", parent], ["after", 2]]) other[name] = value;
    lines.push("__proto__ given an object: " + Object.keys(other).join() + " " + other.inherited);
}
const many = [];
for (let i = 0; i < 150; i++) many.push("name" + i);
for (let round = 0; round < 4; round++) {
    const record = fill(many, round);
    let sum = 0;
    for (const name in record) sum += record[name];
    lines.push("150 names: " + Object.keys(record).length + " " + sum + " " + record.name149);
}
for (let round = 0; round < 6; round++) {
    const record = fill(recurring, round);
    delete record.accept;
    record.added = true;
    record[recurring[1]] = "again";
    Object.defineProperty(record, "hidden", { value: round, enumerable: false });
    lines.push("changed afterwards: " + describe(record) + " " + record.hidden);
}
for (let round = 0; round < 6; round++) {
    const record = Object.freeze(fill(recurring, round));
    let refused = "";
    try { record[recurring[0]] = 1; } catch (error) { refused = error.constructor.name; }
    try { record.more = 1; } catch (error) { refused += error.constructor.name; }
    lines.push("frozen: " + refused + " " + describe(record));
}
lines.push("counted: " + describe(count("a b a c b a d e a".split(" "))) + " || " + describe(count("a b a c b a d e a".split(" "))) + " || " + describe(count("z y z".split(" "))));
let total = 0;
const kept = [];
for (let turn = 0; turn < 30000; turn++) {
    const record = fill(turn % 3 ? recurring : ["only" + (turn % 50), "host"], turn);
    total += record.host + Object.keys(record).length;
    if (turn % 1000 === 0) kept.push(record);
}
lines.push("many turns: " + total + " " + kept.map(record => Object.keys(record).join("+")).slice(0, 4).join(" "));
console.log(lines.join("\n"));
