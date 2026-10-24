// An object that nothing but a local variable of a running function refers to stays alive through collections that run far below that function, whatever else lies on the stack: numbers, strings, large arrays, pointers into the middle of nothing.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Leaf = { id: number; text: string; list: number[] };
function leaf(i: number): Leaf {
  return { id: i, text: "leaf" + i, list: [i, i * 2, i * 3] };
}
function churn(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += leaf(i).text.length;
  return sum;
}
function descend(depth: number, salt: number): number {
  const mine = leaf(depth * 1000 + salt);
  const big = new Array<number>(depth % 7 === 0 ? 40000 : 3).fill(depth);
  const text = "d" + depth + "s" + salt;
  const fraction = depth / 3 + salt;
  const large = depth * 4294967296 + salt * 16384 + 8;
  let below = 0;
  if (depth > 0) below = descend(depth - 1, salt);
  else {
    churn(3000);
    collect(false);
    churn(3000);
    collect(salt % 3 === 0);
  }
  return below + mine.id + mine.text.length + mine.list[2] + big.length + big[big.length - 1] + text.length + Math.floor(fraction) + (large % 1000);
}
for (let salt = 0; salt < 9; salt++) console.log("depth", 20 + salt * 35, descend(20 + salt * 35, salt));

function* walk(n: number): Generator<Leaf> {
  for (let i = 0; i < n; i++) {
    const held = leaf(i);
    if (i % 50 === 0) collect(false);
    yield held;
  }
}
let total = 0;
for (const item of walk(1000)) total += item.list[1] + item.text.length;
console.log("generator", total);

async function later(i: number): Promise<number> {
  const held = leaf(i);
  await null;
  if (i % 40 === 0) collect(i % 80 === 0);
  await null;
  return held.id + held.list[2];
}
const results = await Promise.all(Array.from({ length: 400 }, (_, i) => later(i)));
console.log("async", results.reduce((a, b) => a + b, 0));

function manyArguments(a: Leaf, b: Leaf, c: Leaf, d: Leaf, e: Leaf, f: Leaf, g: Leaf, h: Leaf, i: Leaf, j: Leaf): number {
  churn(2000);
  collect(false);
  return a.id + b.id + c.id + d.id + e.id + f.id + g.id + h.id + i.id + j.list[2];
}
let sum = 0;
for (let i = 0; i < 30; i++) sum += manyArguments(leaf(i), leaf(i + 1), leaf(i + 2), leaf(i + 3), leaf(i + 4), leaf(i + 5), leaf(i + 6), leaf(i + 7), leaf(i + 8), leaf(i + 9));
console.log("arguments", sum);
