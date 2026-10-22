// Only a generic function that makes a Proxy opens what the function type it goes to yields. One that hands its argument back leaves the type closed, also beside one that wraps another type.
// IR- ^layout (L\d+) .*name="State" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
type Sub = { k: number };
type State = { n: number; sub: Sub };
type Other = { o: number };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
function same<T extends object>(t: T): T { return t }
function wrap<T extends object>(t: T): T { return new Proxy(t, {}) }
const f: (s: State) => State = same;
const g: (o: Other) => Other = wrap;
for (let round = 0; round < 3; round++) {
  holder.s = f({ n: round, sub: { k: 2 } });
  console.log(holder.s.n, holder.s.sub.k, g({ o: 5 }).o);
}
