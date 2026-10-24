function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Item {
  id: number;
  tags: string[] = ["t"];
  constructor(id: number) {
    this.id = id;
  }
}

async function byIndex(list: Item[]): Promise<string> {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    await null;
    const item: Item = list[i];
    try {
      out.push(String(item.id));
    } catch (error) {
      out.push(failure(error));
    }
  }
  return out.join();
}

async function byOldLength(list: Item[]): Promise<string> {
  const out: string[] = [];
  const length = list.length;
  for (let i = 0; i < length; i++) {
    const item: Item = list[i];
    await null;
    try {
      out.push(item.id + ":" + item.tags.length + ":" + (list[i] === item));
    } catch (error) {
      out.push(failure(error));
    }
  }
  return out.join();
}

async function byForOf(list: Iterable<Item>): Promise<string> {
  const out: string[] = [];
  for (const item of list) {
    await null;
    out.push(String(item.id));
  }
  return out.join();
}

async function numbers(list: number[]): Promise<string> {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    await null;
    sum += list[i];
  }
  return text(sum);
}

function items(): Item[] {
  return [new Item(1), new Item(2), new Item(3), new Item(4)];
}

async function meanwhile(jobs: number, change: () => void): Promise<void> {
  for (let i = 0; i < jobs; i++) await null;
  change();
}

const changes: [string, (list: Item[]) => void][] = [
  ["nothing", () => {}],
  ["pop twice", list => {
    list.pop();
    list.pop();
  }],
  ["shift", list => void list.shift()],
  ["push", list => void list.push(new Item(5))],
  ["emptied", list => {
    list.length = 0;
  }],
  ["reversed", list => void list.reverse()],
  ["a hole", list => {
    delete list[2];
  }],
  ["an item changes", list => {
    list[2].id = -3;
    list[2].tags = [];
  }],
];

for (const [label, change] of changes) {
  for (const [name, walk] of [["by index", byIndex], ["by the old length", byOldLength], ["by for-of", byForOf]] satisfies [string, (list: Item[]) => Promise<string>][]) {
    const list = items();
    const [result] = await Promise.all([walk(list), meanwhile(2, () => change(list))]);
    console.log(label + ", " + name + ": " + result);
  }
}

const plain = [1, 2, 3, 4];
const [shrunk] = await Promise.all([numbers(plain), meanwhile(2, () => void plain.pop())]);
console.log("a number[] shrinks: " + shrunk);
const real = [1, 2, 3, 4];
const [mixed] = await Promise.all([numbers(real), meanwhile(2, () => {
  real[3] = 0.5;
})]);
console.log("a number[] gets a fraction: " + mixed);

const set = new Set(items());
const [fromSet] = await Promise.all([byForOf(set), meanwhile(1, () => {
  const [first, second] = set;
  set.delete(second);
  set.delete(first);
  set.add(first);
  set.add(new Item(9));
})]);
console.log("a set loses and gains members: " + fromSet);

const map = new Map(items().map(item => [item.id, item]));
const [fromMap] = await Promise.all([byForOf(map.values()), meanwhile(1, () => {
  map.delete(3);
  map.set(1, new Item(100));
  map.set(7, new Item(7));
})]);
console.log("a map loses and gains entries: " + fromMap);

const cleared = new Set(items());
const [fromCleared] = await Promise.all([byForOf(cleared), meanwhile(1, () => {
  cleared.clear();
  cleared.add(new Item(8));
})]);
console.log("a set is cleared and refilled: " + fromCleared);

export {};
