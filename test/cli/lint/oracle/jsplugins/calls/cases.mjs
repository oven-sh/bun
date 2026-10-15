// Inputs for the test of the order in which listeners are called.
export const cases = {
  "module.js": `import a, { b, c as d } from "e"; export { a, b as f };
function g(a, { b = 1, ...h }) { if (a) return; else { b(a, 1); } for (const i of h) { if (i) continue; break; } return () => a + b; }
class A extends g { #j = a; static { g(1); } k() { try { a(); } catch { throw b; } finally { d; } unreachable: while (true) {} after; } }
const l = { a, m: b, [d]: 1, n() {} }, o = \`p\${a}q\`; l.a.b = o?.[a] ?? <r s="t">{a}</r>;`,
  "script.js": `var a = 1, b; a: for (b in a) { switch (b) { case 1: a(); default: break a; } } with (a) b; do { a++; } while (b);`,
  "types.ts": `import type { A } from "a"; let b: A<c.D> = e as A; function f<G>(this: A, h?: G): h is G { return h!; }
enum I { J = 1 } namespace K { export const l = 1; } abstract class M<N> implements A { constructor(private o: N) {} @p q?: N; }`,
};
