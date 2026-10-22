// Whether a list has a name of its own: asked of plain lists, which have none but `length`, and of lists that were given names, lost them again, got them by a definition, by a class, by a match or by a template; of names that a list inherits, of `length`, of indexes and of symbols; in a function that gets nothing but lists, and before and behind a store and a delete.
const has = Object.prototype.hasOwnProperty;
function test(list, label) {
  console.log(label, has.call(list, "pos"), Object.hasOwn(list, "pos"), has.call(list, "length"), has.call(list, "0"), has.call(list, 0), has.call(list, "map"), has.call(list, "constructor"), has.call(list, "__proto__"), has.call(list, Symbol.iterator), has.call(list, "index"), has.call(list, "raw"));
}
function onlyLists(list) { return [has.call(list, "pos"), has.call(list, "end"), Object.hasOwn(list, "index"), Object.hasOwn(list, "raw"), Object.hasOwn(list, "map"), Object.hasOwn(list, "length")].join(); }
const plain = [1, 2, 3];
const nodes = [1, 2, 3]; nodes.pos = 0; nodes.end = 1;
const removed = [1]; removed.pos = 1; delete removed.pos;
const defined = Object.defineProperty([1], "pos", { get() { return 1; } });
const hidden = Object.defineProperty([1], "pos", { value: 1, enumerable: false });
const symbolic = [1]; symbolic[Symbol.iterator] = function* () {};
class Stack extends Array { pos = 1; }
class Bare extends Array {}
const match = /a/.exec("a");
const template = (strings => strings)`x`;
const frozen = Object.freeze([1]);
const sparse = []; sparse[100000] = 1;
const many = []; for (let i = 0; i < 100; i++) many["name" + i] = i; many.pos = 1;
const manyRemoved = []; for (let i = 0; i < 100; i++) manyRemoved["name" + i] = i; for (let i = 0; i < 100; i++) delete manyRemoved["name" + i];
for (const [label, list] of Object.entries({ plain, nodes, removed, defined, hidden, symbolic, stack: new Stack(), bare: new Bare(), match, template, frozen, sparse, many, manyRemoved, prototype: Array.prototype, empty: [], made: new Array(5), from: Array.from("ab"), args: (function () { return Array.prototype.slice.call(arguments); })(1) })) {
  test(list, label);
  console.log(label, onlyLists(list));
}
const later = [1];
console.log(onlyLists(later)); later.pos = 5; console.log(onlyLists(later)); delete later.pos; console.log(onlyLists(later));
