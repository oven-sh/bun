// A record with more fields than its cell has room for stores the later ones out of line. One literal lists them all as undefined, which needs no storage. Another gives some of them objects, strings and numbers at creation, so the allocation itself creates the storage, and what it stored there must survive a collection.
// The functions are called through a table, so that nothing is inlined and no allocation is removed.
interface Leaf { n: number }
interface Wide {
  a0?: Leaf; a1?: Leaf; a2?: Leaf; a3?: Leaf; a4?: Leaf; a5?: Leaf; a6?: Leaf; a7?: Leaf
  b0?: Leaf; b1?: Leaf; b2?: Leaf; b3?: Leaf; b4?: Leaf; b5?: Leaf; b6?: Leaf; b7?: Leaf
  c0?: Leaf; c1?: Leaf; c2?: Leaf; c3?: Leaf; c4?: Leaf; c5?: Leaf; c6?: Leaf; c7?: Leaf
  d0?: Leaf; d1?: Leaf; d2?: Leaf; d3?: Leaf; d4?: Leaf; d5?: Leaf; d6?: Leaf; d7?: Leaf
  e0?: Leaf; e1?: Leaf; e2?: Leaf; e3?: Leaf; e4?: Leaf; e5?: string; e6?: number; e7?: Leaf
}

function leaf(n: number): Leaf { return { n } }
function text(n: number): string { return ["t", n].join("") }
function empty(): Wide {
  return {
    a0: undefined, a1: undefined, a2: undefined, a3: undefined, a4: undefined, a5: undefined, a6: undefined, a7: undefined,
    b0: undefined, b1: undefined, b2: undefined, b3: undefined, b4: undefined, b5: undefined, b6: undefined, b7: undefined,
    c0: undefined, c1: undefined, c2: undefined, c3: undefined, c4: undefined, c5: undefined, c6: undefined, c7: undefined,
    d0: undefined, d1: undefined, d2: undefined, d3: undefined, d4: undefined, d5: undefined, d6: undefined, d7: undefined,
    e0: undefined, e1: undefined, e2: undefined, e3: undefined, e4: undefined, e5: undefined, e6: undefined, e7: undefined,
  };
}
function filledAtEnd(n: number): Wide {
  return {
    a0: undefined, a1: undefined, a2: undefined, a3: undefined, a4: undefined, a5: undefined, a6: undefined, a7: undefined,
    b0: undefined, b1: undefined, b2: undefined, b3: undefined, b4: undefined, b5: undefined, b6: undefined, b7: undefined,
    c0: undefined, c1: undefined, c2: undefined, c3: undefined, c4: undefined, c5: undefined, c6: undefined, c7: undefined,
    d0: undefined, d1: undefined, d2: undefined, d3: F.leaf(n + 1), d4: undefined, d5: undefined, d6: undefined, d7: undefined,
    e0: undefined, e1: undefined, e2: F.leaf(n + 2), e3: undefined, e4: undefined, e5: F.text(n), e6: n + 0.5, e7: F.leaf(n + 3),
  };
}
function churn(): number {
  let sum = 0;
  for (let i = 0; i < 400; i++) sum += F.leaf(9000 + i).n + F.text(i).length;
  return sum;
}
function describe(wide: Wide): string {
  return [wide.a0, wide.d3?.n, wide.d4, wide.e2?.n, wide.e5, wide.e6, wide.e7?.n, Object.keys(wide).length].join();
}
const F = { leaf, text, empty, filledAtEnd, churn, describe };

const live: Wide[] = [];
for (let i = 0; i < 300; i++) {
  live.push(F.filledAtEnd(i * 10), F.empty());
  if (i % 50 === 49) {
    Bun.gc(true);
    F.churn();
  }
}
Bun.gc(true);
F.churn();
for (const i of [0, 1, 2, 3, 298, 299, 598, 599]) console.log(i, F.describe(live[i]));
let sum = 0;
for (const wide of live) sum += (wide.d3?.n ?? 0) + (wide.e2?.n ?? 0) + (wide.e7?.n ?? 0) + (wide.e6 ?? 0) + (wide.e5?.length ?? 0);
console.log(sum);
