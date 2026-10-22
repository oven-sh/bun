function* tens(): Generator<number, undefined, unknown> {
  yield 10;
  yield 20;
  return undefined;
}

function odd(): number[] {
  const list = [1, 2, 3];
  list[Symbol.iterator] = tens;
  return list;
}

function honest(): number[] {
  return [1, 2, 3];
}

class Holder {
  list: number[];
  constructor(list: number[]) {
    this.list = list;
  }
  sum(): number {
    let total = 0;
    for (const n of this.list) total += n;
    return total;
  }
  copy(): number[] {
    return [...this.list];
  }
}

function sumOfParameter(list: number[]): number {
  let total = 0;
  for (const n of list) total += n;
  return total;
}

function sumOfLocal(make: () => number[]): number {
  const local = make();
  let total = 0;
  for (const n of local) total += n;
  return total;
}

function sumOfRows(grid: number[][]): number {
  let total = 0;
  for (const row of grid) for (const n of row) total += n;
  return total;
}

function sumOfResult(make: () => number[]): number {
  let total = 0;
  for (const n of make()) total += n;
  return total;
}

function capture(list: number[]): () => number {
  return () => {
    let total = 0;
    for (const n of list) total += n;
    return total;
  };
}

function spreadInto(list: number[]): string {
  return [0, ...list, 9].join();
}

function asArguments(list: number[]): number {
  return Math.min(...list);
}

function pattern(list: number[]): string {
  const [a, b, c] = list;
  return a + " " + b + " " + c;
}

function withEntries(list: number[]): string {
  const seen: string[] = [];
  for (const [i, n] of list.entries()) seen.push(i + ":" + n);
  return seen.join();
}

function everywhere(label: string, make: () => number[]): void {
  console.log(label + ", a parameter: " + sumOfParameter(make()));
  console.log(label + ", a local: " + sumOfLocal(make));
  console.log(label + ", a field: " + new Holder(make()).sum() + " " + new Holder(make()).copy().join());
  console.log(label + ", rows: " + sumOfRows([make(), honest(), make()]));
  console.log(label + ", a result: " + sumOfResult(make));
  console.log(label + ", captured: " + capture(make())());
  console.log(label + ", spread: " + spreadInto(make()) + ", arguments: " + asArguments(make()) + ", a pattern: " + pattern(make()) + ", entries: " + withEntries(make()));
}

everywhere("honest, first", honest);
everywhere("odd, first", odd);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sumOfParameter(honest()) + sumOfLocal(honest) + new Holder(honest()).sum() + sumOfRows([honest()]) + sumOfResult(honest) + capture(honest())() + spreadInto(honest()).length + asArguments(honest());
console.log("2000 honest: " + warm);
everywhere("odd, after them", odd);
everywhere("honest, again", honest);

const shared = honest();
const holder = new Holder(shared);
const captured = capture(shared);
console.log("one array, before: " + sumOfParameter(shared) + " " + holder.sum() + " " + captured());
shared[Symbol.iterator] = tens;
console.log("one array, with its own iterator: " + sumOfParameter(shared) + " " + holder.sum() + " " + captured());
Reflect.deleteProperty(shared, Symbol.iterator);
console.log("one array, without it again: " + sumOfParameter(shared) + " " + holder.sum() + " " + captured());

const walking = honest();
const seen: number[] = [];
for (const n of walking) {
  seen.push(n);
  if (n === 1) walking[Symbol.iterator] = tens;
}
console.log("set while a loop runs: " + seen.join() + ", the next loop: " + sumOfParameter(walking));

export {};
