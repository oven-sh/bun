// A Proxy of an object of a type is of that type. A generic function that wraps its argument in one hands it out as whatever type is put in for the type parameter. One form a program: another form in the same program may open the types to it.
type Sub = { k: number };
type State = { n: number; sub: Sub };
const seen: string[] = [];
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
function wrap<T extends object>(t: T): T { return new Proxy(t, { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver) } }) }
for (let round = 0; round < 3; round++) {
  holder.s = wrap({ n: round, sub: { k: 2 } });
  console.log(holder.s.n, holder.s.sub.k);
}
console.log(seen.join());
