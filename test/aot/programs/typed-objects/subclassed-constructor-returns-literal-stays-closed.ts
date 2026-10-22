// A literal that a constructor returns in place of `this` has the members of the class: it is laid out and is a member of the view of the class, which admits no object without a layout.
// IR- ^layout (L\d+) .*name="Counter" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
class Counter { n: number; constructor(n: number) { this.n = n; return { n: n + 1 } } }
function read(c: Counter): number { return c.n }
for (let round = 0; round < 3; round++) {
  const made = new Counter(round);
  console.log(read(made), made instanceof Counter, Object.keys(made).join());
}
