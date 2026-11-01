// Three small functions update an optional field in a hot loop, and the prototype gets accessors under its name afterwards.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const log: string[] = [];
class Counter {
  declare id: number;
  n?: number;
  constructor(id: number) {
    delete this.n;
    handOver(this);
    this.id = id;
  }
}
function add(counter: Counter) {
  counter.n! += 1;
  return counter.n;
}
function bump(counter: Counter) {
  return counter.n!++;
}
function orFive(counter: Counter) {
  return (counter.n ??= 5);
}
function round(title: string) {
  const parts: string[] = [];
  const a = new Counter(2);
  const b = new Counter(3);
  const c = new Counter(4);
  parts.push(`typed: ${add(a)} ${bump(b)} ${b.n} ${orFive(c)} [${Object.keys(a)}] [${Object.keys(b)}] [${Object.keys(c)}]`);
  console.log(title + " -> " + parts.join("; ") + (log.length ? " | " + log.join(", ") : ""));
  log.length = 0;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const counter = new Counter(i);
  sum += orFive(counter) + bump(counter) + add(counter)!;
}
console.log("warm", sum);
const holder: any = Reflect.getPrototypeOf(new Counter(0));
Object.defineProperty(holder, "n", {
  get(this: Counter) {
    log.push("get");
    return 9;
  },
  set(this: Counter, value: number) {
    log.push("set " + value);
  },
  configurable: true,
});
round("accessors inherited");

export {};
