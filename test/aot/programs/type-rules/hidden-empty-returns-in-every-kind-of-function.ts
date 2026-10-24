// An empty `return` in every kind of function with a declared result, its error hidden. The caller gets `undefined`, as in plain Bun.
async function halfLater(n: number): Promise<number> {
  // @ts-ignore
  if (n < 0) return;
  return n / 2;
}
class Holder {
  flag: boolean;
  constructor(flag: boolean) { this.flag = flag; }
  get size(): number {
    // @ts-ignore
    if (this.flag) return;
    return 3;
  }
  name(): string {
    // @ts-ignore
    if (this.flag) return;
    return "name";
  }
  static make(flag: boolean): Holder {
    // @ts-ignore
    if (flag) return;
    return new Holder(flag);
  }
}
const arrow = (n: number): number => {
  // @ts-ignore
  if (n > 0) return;
  return n;
};
function* steps(flag: boolean): Generator<number, number, void> {
  yield 1;
  // @ts-ignore
  if (flag) return;
  return 2;
}
function isBig(n: number): boolean {
  // @ts-ignore
  if (n < 0) return;
  return n > 10;
}
function describe(n: number): string {
  return `${typeof n} ${n} ${n + 1} ${n | 0} ${n * 2 > 1}`;
}
function describeText(s: string): string {
  return `${typeof s} ${s} ${s + "!"} ${s === "name"}`;
}
function describeFlag(b: boolean): string {
  return `${typeof b} ${b} ${b ? "yes" : "no"} ${b === false}`;
}
console.log(describe(await halfLater(4)), "|", describe(await halfLater(-4)));
for (const flag of [false, true]) {
  const holder = new Holder(flag);
  console.log(describe(holder.size), "|", describeText(holder.name()), "|", typeof Holder.make(flag));
  const iterator = steps(flag);
  iterator.next();
  const last = iterator.next();
  if (last.done) console.log(describe(last.value));
}
console.log(describe(arrow(-1)), "|", describe(arrow(1)));
console.log(describeFlag(isBig(11)), "|", describeFlag(isBig(1)), "|", describeFlag(isBig(-1)));
let sum = 0;
for (let i = -2; i < 3; i++) sum += arrow(i);
console.log(sum);
