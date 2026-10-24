// What a closure has captured, the two functions of an accessor pair and the elements of an array literal must stay alive through any number of collections, of the young and of everything, also when nothing else refers to them.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Box = { id: number; text: string; inner: { n: number } };
function box(i: number): Box {
  return { id: i, text: "box" + i, inner: { n: i * 3 } };
}
function churn(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = { a: i, b: "t" + i, c: [i, i + 1] };
    sum += t.b.length + t.c.length;
  }
  return sum;
}
const readers: Array<() => number> = [];
const writers: Array<(n: number) => void> = [];
for (let i = 0; i < 3000; i++) {
  const first = box(i);
  const second = box(i + 100000);
  let count = i;
  const name = "name" + i;
  readers.push(() => first.id + second.inner.n + count + name.length);
  writers.push((n: number) => {
    count += n;
    first.inner = { n: first.inner.n + n };
  });
  if (i % 500 === 0) collect(false);
}
function sumOfReaders(): number {
  let sum = 0;
  for (const read of readers) sum += read();
  return sum;
}
console.log("closures", sumOfReaders());
for (let round = 0; round < 12; round++) {
  churn(20000);
  for (let i = round; i < writers.length; i += 7) writers[i](round);
  collect(round % 4 === 3);
  console.log("round", round, sumOfReaders());
}
const closureWithProperties = Object.assign(() => 7, { extra: box(5), list: [box(6)] });
collect(false);
churn(5000);
collect(true);
console.log("properties", closureWithProperties(), closureWithProperties.extra.text, closureWithProperties.list[0].inner.n);

const holders: any[] = [];
for (let i = 0; i < 1500; i++) {
  const hidden = box(i);
  if (i % 2) {
    holders.push({
      get value(): number {
        return hidden.inner.n;
      },
      set value(n: number) {
        hidden.inner = { n };
      },
      get label(): string {
        return hidden.text;
      },
    });
    continue;
  }
  const holder: any = {};
  Object.defineProperty(holder, "value", {
    get() {
      return hidden.inner.n;
    },
    set(n: number) {
      hidden.inner = { n };
    },
    enumerable: true,
  });
  Object.defineProperty(holder, "label", {
    get() {
      return hidden.text;
    },
    enumerable: true,
  });
  holders.push(holder);
}
function sumOfHolders(): number {
  let sum = 0;
  for (const holder of holders) sum += holder.value + holder.label.length;
  return sum;
}
console.log("accessors", sumOfHolders());
for (let round = 0; round < 8; round++) {
  churn(15000);
  for (let i = round; i < holders.length; i += 5) holders[i].value = i + round;
  collect(round % 3 === 2);
  console.log("round", round, sumOfHolders());
}
class Temperature {
  #celsius: { degrees: number };
  constructor(degrees: number) {
    this.#celsius = { degrees };
  }
  get fahrenheit(): number {
    return this.#celsius.degrees * 9 / 5 + 32;
  }
  set fahrenheit(value: number) {
    this.#celsius = { degrees: (value - 32) * 5 / 9 };
  }
}
const temperatures: Temperature[] = [];
for (let i = 0; i < 500; i++) temperatures.push(new Temperature(i));
collect(false);
for (const t of temperatures) t.fahrenheit = t.fahrenheit + 9;
collect(true);
console.log("class accessors", temperatures.reduce((sum, t) => sum + t.fahrenheit, 0));

function literal(): string[] {
  return ["alpha", "beta", "gamma", "delta", "epsilon"];
}
function numbers(): number[] {
  return [1, 2, 3, 4, 5, 6, 7, 8];
}
function halves(): number[] {
  return [0.5, 1.5, 2.5];
}
const lists: string[][] = [];
const sums: number[] = [];
for (let i = 0; i < 4000; i++) {
  const list = literal();
  if (i % 3 === 0) list.push("more" + i);
  if (i % 5 === 0) list[1] = "changed" + i;
  lists.push(list);
  sums.push(numbers().length + halves()[i % 3]);
  if (i % 800 === 0) collect(i % 1600 === 0);
}
churn(30000);
collect(false);
collect(true);
let letters = 0;
for (const list of lists) for (const word of list) letters += word.length;
console.log("literals", letters, sums.reduce((a, b) => a + b, 0), literal().join());
