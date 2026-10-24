// A deep merge written once for all types, step by step: what it makes has every member its result type names.
interface Inner { n: number; tags: string[] }
interface R { a: number; b: string; inner: Inner }
function merge<T extends { inner: object }, U extends { inner: object }>(x: T, y: U): T & U { const inner = { ...x.inner, ...y.inner }; const merged = { ...x, ...y, inner }; return merged as T & U }
for (let round = 0; round < 3; round++) {
  const r: R = { a: round, b: "x", inner: { n: 1, tags: ["t"] } };
  const w = merge(r, { inner: { n: 100 + round } });
  console.log(w.a, w.b, w.inner.n, w.inner.tags.join(), r.inner.n);
}
