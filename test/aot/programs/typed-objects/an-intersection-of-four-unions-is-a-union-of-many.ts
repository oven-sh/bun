type A = { a: 0; a0?: string } | { a: 1; a1?: string } | { a: 2; a2?: string } | { a: 3; a3?: string };
type B = { b: 0; b0?: string } | { b: 1; b1?: string } | { b: 2; b2?: string } | { b: 3; b3?: string };
type C = { c: 0; c0?: string } | { c: 1; c1?: string } | { c: 2; c2?: string } | { c: 3; c3?: string };
type D = { d: 0; d0?: string } | { d: 1; d1?: string } | { d: 2; d2?: string } | { d: 3; d3?: string };
type All = A & B & C & D;
function weigh(it: All): number {
  return it.a * 64 + it.b * 16 + it.c * 4 + it.d;
}
function label(it: All): string {
  if (it.a === 2 && it.d === 3) return "two and three" + (it.a2 ?? "") + (it.d3 ?? "");
  return it.b === 1 ? "one" + (it.b1 ?? "") : "other";
}
const made: All[] = [
  { a: 0, b: 0, c: 0, d: 0 },
  { a: 3, b: 3, c: 3, d: 3, a3: "x" },
  { a: 2, b: 1, c: 0, d: 3, a2: "!", d3: "?" },
  { a: 1, b: 1, c: 2, d: 0, b1: "+" },
];
const either: All | undefined = made.length > 2 ? made[2] : undefined;
console.log(made.map(weigh).join(" "), made.map(label).join(" "), either ? weigh(either) : -1);
