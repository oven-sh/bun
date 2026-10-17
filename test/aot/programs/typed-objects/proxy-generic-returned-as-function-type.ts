// A Proxy of an object of a type is of that type. A generic function that wraps its argument in one may go to a place whose function type is written down: what that type yields admits its Proxies. One form a program: another form in the same program may open the types to it.
type Sub = { k: number };
type State = { n: number; sub: Sub };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
function wrap<T extends object>(t: T): T { return new Proxy(t, {}) }
function chosen(): (s: State) => State { return wrap }
for (let round = 0; round < 3; round++) {
  holder.s = chosen()({ n: round, sub: { k: 2 } });
  console.log(holder.s.n, holder.s.sub.k);
}
