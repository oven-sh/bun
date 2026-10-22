// What Object.assign copies into a field opens the type of the field only where it may be an object that is not laid out. A record of the program leaves it closed.
// IR- ^layout (L\d+) .*name="State" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
type Sub = { k: number };
type State = { n: number; sub: Sub };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
for (let round = 0; round < 3; round++) {
  const next: State = { n: round, sub: { k: 2 } };
  Object.assign(holder, { s: next });
  console.log(holder.s.n, holder.s.sub.k, holder.s === next);
}
