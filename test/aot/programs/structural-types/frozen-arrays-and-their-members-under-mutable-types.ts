function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Basket {
  items: number[];
  total: number;
}

function add(b: Basket, n: number): number {
  b.items.push(n);
  b.total += n;
  return b.items.length;
}

function setFirst(list: number[], n: number): number {
  list[0] = n;
  return list[0];
}

function grow(list: number[]): number {
  return list.push(9);
}

function shorten(list: number[]): number {
  list.length = 1;
  return list.length;
}

function frozenList(): number[] {
  const list = [1, 2, 3];
  Object.freeze(list);
  return list;
}

function sealedList(): number[] {
  return Object.seal([1, 2, 3]);
}

function closedList(): number[] {
  return Object.preventExtensions([1, 2, 3]);
}

const makers: [string, () => number[]][] = [
  ["open", () => [1, 2, 3]],
  ["frozen", frozenList],
  ["sealed", sealedList],
  ["not extensible", closedList],
];

for (const [label, make] of makers) {
  const uses: [string, (list: number[]) => unknown][] = [
    ["an element stored", list => setFirst(list, 7)],
    ["push", grow],
    ["pop", list => list.pop()],
    ["shift", list => list.shift()],
    ["unshift", list => list.unshift(0)],
    ["length made shorter", shorten],
    ["length made longer", list => (list.length = 5)],
    ["an element behind the end", list => (list[3] = 4)],
    ["sort", list => list.sort((a, b) => b - a).join()],
    ["reverse", list => list.reverse().join()],
    ["fill", list => list.fill(0).join()],
    ["splice", list => list.splice(0, 1).join()],
    ["copyWithin", list => list.copyWithin(0, 1).join()],
    ["map makes an open copy", list => grow(list.map(n => n))],
    ["spread makes an open copy", list => grow([...list])],
    ["slice makes an open copy", list => grow(list.slice())],
    ["read", list => list[0] + list[1] + list[2]],
  ];
  for (const [name, use] of uses) {
    const list = make();
    attempt(label + ", " + name, () => use(list));
    console.log("  holds " + JSON.stringify(list) + " length " + list.length);
  }
}

const open: number[] = [0];
for (let i = 0; i < 2000; i++) {
  setFirst(open, i);
  grow(open);
}
console.log("2000 honest: " + open.length + " " + open[0]);
attempt("then a frozen one, stored", () => setFirst(frozenList(), 1));
attempt("then a frozen one, pushed", () => grow(frozenList()));
attempt("then the open one", () => setFirst(open, 1) + grow(open));

const outerFrozen: Basket = Object.freeze({ items: [1], total: 1 });
attempt("a frozen basket, an open list", () => add(outerFrozen, 2));
console.log("  holds " + JSON.stringify(outerFrozen));
const innerFrozen: Basket = { items: frozenList(), total: 6 };
attempt("an open basket, a frozen list", () => add(innerFrozen, 2));
console.log("  holds " + JSON.stringify(innerFrozen));

const pair: [number, string] = Object.seal<[number, string]>([1, "a"]);
attempt("a sealed tuple, stored", () => ((pair[0] = 2), pair.join()));
attempt("a sealed tuple, pushed", () => pair.push("b"));

export {};
