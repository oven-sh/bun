// Only a generic function that makes a Proxy opens the types put in for its type parameter. One that hands its argument back leaves them closed, also beside a Proxy of another type.
// IR- ^layout (L\d+) .*name="State" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
type Sub = { k: number };
type State = { n: number; sub: Sub };
type Other = { o: number };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
function same<T extends object>(t: T): T { return t }
function wrap<T extends object>(t: T): T { return new Proxy(t, {}) }
const other: Other = wrap({ o: 5 });
for (let round = 0; round < 3; round++) {
  holder.s = same({ n: round, sub: { k: 2 } });
  console.log(holder.s.n, holder.s.sub.k, other.o);
}
