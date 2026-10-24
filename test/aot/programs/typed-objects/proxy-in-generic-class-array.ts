// A Proxy of an object of a type is of that type. Where generic code makes one of a value of its type parameter and keeps it, it comes out as whatever type is put in for the type parameter. One form a program: another form in the same program may open the types to it.
type Sub = { k: number };
type State = { n: number; sub: Sub };
const seen: string[] = [];
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
class Store<T extends object> { all: T[] = []; add(t: T): void { this.all.push(new Proxy(t, { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver) } })) } }
for (let round = 0; round < 3; round++) {
  const store = new Store<State>();
  store.add({ n: round, sub: { k: 2 } });
  holder.s = store.all[0];
  console.log(holder.s.n, holder.s.sub.k);
}
console.log(seen.join());
