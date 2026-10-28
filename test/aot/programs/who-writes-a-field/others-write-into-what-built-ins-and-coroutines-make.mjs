// Lists, maps, sets and promises that built-ins and coroutines make, read after somebody else than a store of the program has written into them.
function sum(list) {
  let total = 0;
  for (let index = 0; index < list.length; index++) total += list[index];
  return total;
}

const doubled = [1, 2, 3].map(value => value * 2);
console.log(sum(doubled));
doubled.fill("x", 1, 2);
console.log(sum(doubled));

const sliced = [1, 2, 3, 4].slice(1);
Object.defineProperty(sliced, 1, { get: () => "from a getter" });
console.log(sum(sliced));

const holey = Array.from({ length: 3 }, (_, index) => index + 1);
delete holey[1];
Object.setPrototypeOf(holey, { __proto__: Array.prototype, 1: "from above" });
console.log(sum(holey));

const keys = Object.keys({ a: 1, b: 2 });
Reflect.set(keys, 0, 7);
console.log(keys[0] + 1, keys[1] + 1);

const copied = [1.5, 2.5].concat([3.5]);
copied.copyWithin(0, 2);
Array.prototype.push.call(copied, "pushed");
console.log(sum(copied));

const sorted = [3, 1, 2].toSorted();
Object.assign(sorted, { 0: "assigned" });
console.log(sum(sorted));

const map = new Map([[1, 1]]);
Map.prototype.set.call(map, 2, "two");
Reflect.apply(Map.prototype.set, map, ["three", 3]);
let seen = "";
for (const [key, value] of map) seen += typeof key + ":" + typeof value + " ";
console.log(seen, map.get(2) + 1);

const set = new Set([1, 2]);
Reflect.apply(Set.prototype.add, set, ["three"]);
let members = 0;
for (const member of set) members += member;
console.log(members);

const grouped = Map.groupBy([1, 2, 3], value => value % 2);
grouped.get(1).push("odd");
console.log(sum(grouped.get(1)), sum(grouped.get(0)));

function* numbers() {
  const sent = yield 1;
  yield sent;
}
const generator = numbers();
console.log(generator.next().value + 1, generator.next("sent").value + 1);

async function answer(value) {
  return value;
}
console.log(
  (await answer(1)) + 1,
  (await answer("text")) + 1,
  (await Promise.all([answer(1), "plain"])).map(value => value + 1).join(),
);

const bytes = Uint8Array.from([1, 2, 3]);
crypto.getRandomValues(bytes.subarray(0, 0));
new Uint8Array(bytes.buffer).set([9], 1);
console.log(sum(bytes));
