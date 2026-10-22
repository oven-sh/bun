// Whether a list has a name of its own, asked in a function whose parameter is declared a list: of plain lists, which have none but `length`, and of lists that were given names, lost them again, or got them by a definition, a class, a match or a template.
const has = Object.prototype.hasOwnProperty;
function onlyLists(list: readonly unknown[]): string {
  return [has.call(list, "pos"), has.call(list, "end"), Object.hasOwn(list, "index"), Object.hasOwn(list, "raw"), Object.hasOwn(list, "map"), Object.hasOwn(list, "length"), Object.hasOwn(list, "0"), Object.hasOwn(list, "constructor"), Object.hasOwn(list, "__proto__"), Object.hasOwn(list, Symbol.iterator), Object.hasOwn(list, "name7")].join();
}
const plain: unknown[] = [1, 2, 3];
const nodes: any = [1, 2, 3]; nodes.pos = 0; nodes.end = 1;
const removed: any = [1]; removed.pos = 1; delete removed.pos;
const defined: any = Object.defineProperty([1], "pos", { get() { return 1; } });
const hidden: any = Object.defineProperty([1], "pos", { value: 1, enumerable: false });
const symbolic: any = [1]; symbolic[Symbol.iterator] = function* () {};
class Stack extends Array<unknown> { pos = 1; }
class Bare extends Array<unknown> {}
const match: any = /a/.exec("a");
const template: any = ((strings: TemplateStringsArray) => strings)`x`;
const frozen = Object.freeze([1]);
const sparse: unknown[] = []; sparse[100000] = 1;
const many: any = []; for (let i = 0; i < 100; i++) many["name" + i] = i; many.pos = 1;
const manyRemoved: any = []; for (let i = 0; i < 100; i++) manyRemoved["name" + i] = i; for (let i = 0; i < 100; i++) delete manyRemoved["name" + i];
const own: any = [1]; Object.defineProperty(own, "__proto__", { value: 1 });
const all: Record<string, readonly unknown[]> = { plain, nodes, removed, defined, hidden, symbolic, stack: new Stack(), bare: new Bare(), match, template, frozen, sparse, many, manyRemoved, own, prototype: Array.prototype, empty: [], made: new Array(5), from: Array.from("ab"), sliced: plain.slice(1), mapped: nodes.map((value: unknown) => value), keys: Object.keys({ a: 1 }) };
for (const label in all) console.log(label, onlyLists(all[label]));
const later: any = [1];
console.log(onlyLists(later)); later.pos = 5; console.log(onlyLists(later)); delete later.pos; console.log(onlyLists(later));
