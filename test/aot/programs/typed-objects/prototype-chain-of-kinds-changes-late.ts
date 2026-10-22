// Objects of several kinds come from one constructor. Hot code walks their prototype chain, then the chain changes.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Tree { readonly kind: number; readonly pos: number }
interface Name extends Tree { readonly kind: 1; readonly text: string }
interface Pair extends Tree { readonly kind: 2; readonly left: Name }
function TreeObject(this: Mutable<Tree>, kind: number, pos: number) {
  this.kind = kind;
  this.pos = pos;
}
const TreeConstructor = TreeObject as any as new (kind: number, pos: number) => Tree;
function makeName(text: string): Name {
  const n = new TreeConstructor(1, 0) as Mutable<Name>;
  n.text = text;
  return n;
}
function makePair(left: Name): Pair {
  const n = new TreeConstructor(2, 0) as Mutable<Pair>;
  n.left = left;
  return n;
}

class Leaf {
  constructor(public kind: number, public pos: number) {}
}
interface Word extends Leaf { kind: 1; text: string }
interface Digit extends Leaf { kind: 2; value: number }
function makeWord(text: string): Word {
  const n = new Leaf(1, 0) as Word;
  n.text = text;
  return n;
}
function makeDigit(value: number): Digit {
  const n = new Leaf(2, 0) as Digit;
  n.value = value;
  return n;
}

let traps = 0;
function keysOfName(n: Name): string {
  const before = traps;
  let keys = "";
  for (const key in n) keys += key + ",";
  return keys + (traps - before);
}
function keysOfWord(n: Word): string {
  const before = traps;
  let keys = "";
  for (const key in n) keys += key + ",";
  return keys + (traps - before);
}
function isTree(n: Pair): string {
  const before = traps;
  const answer = n instanceof TreeConstructor;
  return answer + "," + (traps - before);
}
function isLeaf(n: Digit): string {
  const before = traps;
  const answer = n instanceof Leaf;
  return answer + "," + (traps - before);
}
function hasAbove(n: Name): string {
  const before = traps;
  const answer = "above" in n;
  return answer + "," + (traps - before);
}

const names = [makeName("a"), makeName("b")];
const pairs = [makePair(names[0]), makePair(names[1])];
const words = [makeWord("a"), makeWord("b")];
const digits = [makeDigit(1), makeDigit(2)];
function show(label: string): void {
  console.log(label, keysOfName(names[0]), keysOfWord(words[0]), isTree(pairs[0]), isLeaf(digits[0]), hasAbove(names[0]), keysOfName(names[1]), keysOfWord(words[1]));
}

let length = 0;
for (let r = 0; r < 20000; r++) length += keysOfName(names[r & 1]).length + keysOfWord(words[r & 1]).length + isTree(pairs[r & 1]).length + isLeaf(digits[r & 1]).length + hasAbove(names[r & 1]).length;
console.log(length);
show("untouched");

(TreeObject.prototype as any).above = 1;
(Leaf.prototype as any).above = 1;
show("a name on the prototype objects");

const counting = (target: object): object =>
  new Proxy(target, {
    ownKeys(t) { traps++; return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, key) { traps++; return Reflect.getOwnPropertyDescriptor(t, key); },
    getPrototypeOf(t) { traps++; return Reflect.getPrototypeOf(t); },
    has(t, key) { traps++; return Reflect.has(t, key); },
  });
delete (TreeObject.prototype as any).above;
delete (Leaf.prototype as any).above;
Object.setPrototypeOf(TreeObject.prototype, counting({ deep: 1 }));
Object.setPrototypeOf(Leaf.prototype, counting({ deep: 1 }));
show("a proxy above the prototype objects");

Object.setPrototypeOf(names[0], counting({ own: 1 }));
Object.setPrototypeOf(words[0], counting({ own: 1 }));
Object.setPrototypeOf(pairs[0], null);
Object.setPrototypeOf(digits[0], null);
show("another prototype for one object of each kind");

function Other() {}
(Other as any).prototype = counting({ foreign: 1 });
const foreignName = Reflect.construct(TreeConstructor, [1, 0], Other) as Mutable<Name>;
foreignName.text = "f";
const foreignPair = Reflect.construct(TreeConstructor, [2, 0], Other) as Mutable<Pair>;
foreignPair.left = foreignName;
const foreignWord = Reflect.construct(Leaf, [1, 0], Other) as Word;
foreignWord.text = "f";
const foreignDigit = Reflect.construct(Leaf, [2, 0], Other) as Digit;
foreignDigit.value = 3;
console.log("another new.target", keysOfName(foreignName), keysOfWord(foreignWord), isTree(foreignPair), isLeaf(foreignDigit), hasAbove(foreignName));
