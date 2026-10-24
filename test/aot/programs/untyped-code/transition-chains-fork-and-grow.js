// Properties added by key, one after the other: along a chain of shapes that has one way on, where it forks, where the room beside the object must grow, and where something stands in the way.
"use strict";
const lines = [];
function fill(target, names, from) {
    for (let i = 0; i < names.length; i++) target[names[i]] = from + i;
    return target;
}
function show(what, object) {
    lines.push(what + ": " + Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join());
}
const few = ["a", "b", "c"];
const many = [];
for (let i = 0; i < 40; i++) many.push("m" + i);
for (let round = 0; round < 4; round++) {
    show("few " + round, fill({}, few, round));
    show("many " + round, fill({}, many, round * 100));
}
show("the chain forks", fill(fill({}, ["a", "b"], 0), ["x", "c"], 7));
show("and the first way still holds", fill({}, few, 50));
show("another order", fill({}, ["c", "b", "a"], 0));
const mark = Symbol("mark");
show("a symbol in between", fill({}, ["a", mark, "b"], 0));
show("again", fill({}, ["a", mark, "b"], 10));
show("an index in between", fill({}, ["a", "7", "b", 3], 0));
show("a name twice", fill({}, ["a", "b", "a", "b", "c"], 0));

function outcome(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
const closed = Object.preventExtensions(fill({}, ["a"], 0));
lines.push("closed: " + outcome(() => fill(closed, ["a", "b"], 5)) + " " + Object.keys(closed).join());
let caught = [];
const parent = { set b(value) { caught.push(value); }, get c() { return "from the parent"; } };
Object.defineProperty(parent, "d", { value: "fixed", writable: false });
for (let round = 0; round < 3; round++) {
    const heir = Object.create(parent);
    lines.push("an heir: " + outcome(() => fill(heir, ["a", "b"], round)) .slice(0, 8) + " " + outcome(() => fill(heir, ["c"], 0)) + " " + outcome(() => fill(heir, ["d"], 0)) + " " + Object.keys(heir).join() + " " + caught.join());
}
const plainParent = {};
const first = fill(Object.create(plainParent), few, 0);
Object.defineProperty(plainParent, "c", { set(value) { caught.push("late " + value); }, configurable: true });
const second = fill(Object.create(plainParent), few, 0);
lines.push("a setter that came late: " + Object.keys(first).join() + " | " + Object.keys(second).join() + " | " + caught.join());
delete plainParent.c;
lines.push("and went: " + Object.keys(fill(Object.create(plainParent), few, 0)).join());

function Kind() { }
const made = new Kind();
fill(made, few, 0);
fill(Kind.prototype, ["p", "q"], 0);
show("an instance", made);
lines.push("its prototype: " + Object.keys(Kind.prototype).join() + " " + made.p + " " + new Kind().q);
const list = fill([1, 2], few, 0);
lines.push("an array: " + Object.keys(list).join() + " " + list.length);
function callable() { }
lines.push("a function: " + Object.keys(fill(callable, few, 0)).join());
let sum = 0;
for (let turn = 0; turn < 3000; turn++) {
    const names = [];
    for (let i = 0; i < 2 + turn % 9; i++) names.push("n" + (turn % 300) + "_" + i);
    const object = fill({}, names, turn);
    for (const name in object) sum += object[name];
    if (Object.keys(object).join() !== names.join()) sum = NaN;
}
lines.push("sum " + sum);
console.log(lines.join("\n"));
