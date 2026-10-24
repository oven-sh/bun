const kept = [];
function h1(p0, p1, d) {
  const c6 = p1.n % 2 === 0 ? p1 : p1;
  const r7 = d > 0 ? h1(p1, { tag: "s4." + p1.n, n: p1.n + 5, a: null, b: null }, d - 1) : null;
  if (r7 !== null) {
    c6.b = p1;
  }
  if (c6.n % 53 === 8) kept.push(p1);
  return c6;
}
let sum = 0;
for (let i = 0; i < 60; i++) sum += h1({ tag: "a", n: i, a: null, b: null }, { tag: "b", n: i + 1, a: null, b: null }, 2).n;
console.log(sum, kept.length);
