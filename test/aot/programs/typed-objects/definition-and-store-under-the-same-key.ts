// A store `made[key] = value` of a property that a typed object's layout does not have is remembered in a table by the object's Structure and the key. A definition `{ .., [key]: value }` on an object of the same Structure under the same key looks into the same table: it must read such an entry as what it is.
interface Named { id: number; label: string }
function defined(key: string, id: number): Named { return { id, label: "x", [key]: id }; }
function stored(key: string, id: number): Named { const made: Named = { id, label: "x" }; (made as unknown as Record<string, number>)[key] = id; return made; }
function definedTwice(key: string, other: string, id: number): Named { return { id, label: "y", [key]: id, [other]: id + 1 }; }
const makers: ((key: string, id: number) => Named)[] = [stored, defined];
const twice: ((key: string, other: string, id: number) => Named)[] = [definedTwice];
const names = ["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"];
function weigh(made: Named, key: string): number {
  return made.id + made.label.length + ((made as unknown as Record<string, number>)[key] ?? -1000000) + Object.keys(made).length;
}
let total = 0;
for (const order of [[0, 1], [1, 0], [0, 0], [1, 1]]) {
  for (const which of order) {
    for (let i = 0; i < 400; i++) total += weigh(makers[which]!(names[i & 3]!, i), names[i & 3]!);
  }
  console.log(order.join(), total);
}
for (let i = 0; i < 800; i++) total += weigh(makers[i & 1]!(names[(i >> 1) & 3]!, i), names[(i >> 1) & 3]!);
console.log(total);
for (let i = 0; i < 800; i++) {
  const made = twice[0]!(names[i % 9]!, names[(i + 1 + (i % 7)) % 9]!, i);
  total += weigh(made, names[i % 9]!);
  if (i % 100 === 0) console.log(JSON.stringify(made), Object.keys(made).join());
}
console.log(total);
const last = makers[1]!("k0", 1);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(last, "k0")), JSON.stringify(last), Object.getPrototypeOf(last) === Object.prototype);
