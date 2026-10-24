// A Proxy of an object of a type is of that type, by whatever door it enters a field: here by Object.assign. One form a program: another form in the same program may open the types to it.
type Sub = { k: number };
type State = { n: number; sub: Sub };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
for (let round = 0; round < 3; round++) {
  const proxy = new Proxy({ n: round, sub: { k: 2 } }, {});
  Object.assign(holder, { s: proxy });
  console.log(holder.s.n, holder.s.sub.k, (holder.s as object) === proxy);
}
