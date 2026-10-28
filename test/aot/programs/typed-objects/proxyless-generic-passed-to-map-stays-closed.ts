// Only a generic function that makes a Proxy opens what the function that takes it yields. One that hands its argument back leaves the type closed, also beside one that wraps another type.
// IR- ^layout (L\d+) .*name="State" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
type Sub = { k: number };
type State = { n: number; sub: Sub };
type Other = { o: number };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
const same = <T extends object>(t: T): T => t;
const wrap = <T extends object>(t: T): T => new Proxy(t, {});
const others: Other[] = [{ o: 5 }].map(wrap);
for (let round = 0; round < 3; round++) {
  const list: State[] = [{ n: round, sub: { k: 2 } }].map(same);
  holder.s = list[0];
  console.log(holder.s.n, holder.s.sub.k, others[0].o);
}
