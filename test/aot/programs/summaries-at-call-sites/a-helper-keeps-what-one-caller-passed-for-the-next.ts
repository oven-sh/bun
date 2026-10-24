// What a helper answers is not always what THIS caller passed: it may have kept what an earlier caller passed, in a variable, a closure, a field or an array.
class Apple {
  constructor(public weight: number) {}
}
class Pear {
  constructor(public name: string) {}
}
let last: unknown;
function swap<T>(value: T): unknown {
  const old = last;
  last = value;
  return old;
}
function makeCell<T>() {
  let held: T | undefined;
  return (value: T): T | undefined => {
    const old = held;
    held = value;
    return old;
  };
}
const shelf: unknown[] = [];
function shelve<T>(value: T): unknown {
  shelf.push(value);
  return shelf[shelf.length >> 1];
}
const box: { content: unknown } = { content: 0 };
function exchange<T>(target: { content: unknown }, value: T): unknown {
  const old = target.content;
  target.content = value;
  return old;
}
function describe(value: unknown): string {
  if (value instanceof Apple) return "apple " + value.weight;
  if (value instanceof Pear) return "pear " + value.name;
  return typeof value + " " + String(value);
}
const cell = makeCell<Apple | Pear>();
const lines: string[] = [];
for (let i = 0; i < 6; i++) {
  const apple = new Apple(i);
  const pear = new Pear("p" + i);
  lines.push(describe(swap(apple)) + " | " + describe(swap(pear)) + " | " + describe(swap(i)));
  lines.push(describe(cell(apple)) + " | " + describe(cell(pear)));
  lines.push(describe(shelve(apple)) + " | " + describe(shelve(pear)) + " | " + describe(shelve("s" + i)));
  lines.push(describe(exchange(box, apple)) + " | " + describe(exchange(box, pear)) + " | " + describe(exchange({ content: i }, pear)));
}
console.log(lines.join("\n"));
