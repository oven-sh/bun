// Only what is put in for a type parameter that a Proxy is made of is opened. A generic class that keeps its argument as it is leaves the type closed, also beside a generic class that makes a Proxy of another type.
// IR- ^layout (L\d+) .*name="State" [\s\S]*^    v\d+: [^=~\n]*(?<![=\w])\1(?![!\d])
type Sub = { k: number };
type State = { n: number; sub: Sub };
type Other = { o: number };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
class Box<T extends object> { held: T; constructor(t: T) { this.held = t } }
class Store<T extends object> { state: T; constructor(t: T) { this.state = new Proxy(t, {}) } }
const other: Other = new Store<Other>({ o: 5 }).state;
for (let round = 0; round < 3; round++) {
  holder.s = new Box<State>({ n: round, sub: { k: 2 } }).held;
  console.log(holder.s.n, holder.s.sub.k, other.o);
}
