// A Proxy of an object of a type is of that type. A generic function that wraps its argument in one may be handed over as a value: what the function that takes it yields holds its Proxies. One form a program: another form in the same program may open the types to it.
type Sub = { k: number };
type State = { n: number; sub: Sub };
const seen: string[] = [];
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
const tools = { wrap<T extends object>(t: T): T { return new Proxy(t, { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver) } }) } };
for (let round = 0; round < 3; round++) {
  const list = [{ n: round, sub: { k: 2 } }].map(tools.wrap);
  holder.s = list[0];
  console.log(holder.s.n, holder.s.sub.k);
}
console.log(seen.join());
