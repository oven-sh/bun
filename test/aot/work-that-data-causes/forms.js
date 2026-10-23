// forms.js <form> <n>: one kind of work on data as it may come from outside, n items of it. Prints the milliseconds of the work alone.
const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
function order(number, names = letters) {
  const left = [...names];
  const out = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
const textOf = names => "{" + names.map((name, at) => JSON.stringify(name) + ":" + at).join(",") + "}";
const listOf = (n, text) => "[" + Array.from({ length: n }, (_, at) => text(at)).join(",") + "]";
const ordersText = n => listOf(n, at => textOf(order(at)));
const orders = n => JSON.parse(ordersText(n));
const subset = number => letters.concat(["k", "l", "m", "n", "o", "p"]).filter((_, at) => number & (1 << at));
const newNames = (n, each) => listOf(Math.ceil(n / each), at => textOf(Array.from({ length: each }, (_, k) => "id" + (at * each + k))));
class Point {
  x = 0;
  y = 0;
}

// Each form: what is made ready, then the work that is timed.
const forms = {
  "parse: orders of ten names, one text": n => [ordersText(n), text => JSON.parse(text).length],
  "parse: orders of ten names, a text an object, all kept": n => [Array.from({ length: n }, (_, at) => textOf(order(at))), texts => texts.map(text => JSON.parse(text)).length],
  "parse: orders of ten names, a text an object, none kept": n => [Array.from({ length: n }, (_, at) => textOf(order(at))), texts => texts.reduce((sum, text) => sum + JSON.parse(text).a, 0)],
  "parse: subsets of sixteen names": n => [listOf(n, at => textOf(subset((at * 2654435761) >>> 16))), text => JSON.parse(text).length],
  "parse: one new name an object": n => [newNames(n, 1), text => JSON.parse(text).length],
  "parse: ten new names an object": n => [newNames(n, 10), text => JSON.parse(text).length],
  "parse: one object of n names": n => [newNames(n, n), text => JSON.parse(text).length],
  "parse: names a thousand characters long": n => [listOf(Math.ceil(n / 10), at => textOf(["x".repeat(1000) + at])), text => JSON.parse(text).length],
  "parse: names that look like indexes": n => [listOf(n, at => textOf([String(at), "0" + at, "-" + at, at + ".0", String(4294967295 - at)])), text => JSON.parse(text).length],
  "parse: one name again and again in an object": n => [listOf(Math.ceil(n / 10), at => "{" + Array.from({ length: 10 }, (_, k) => '"a":' + k).join(",") + "}"), text => JSON.parse(text).length],
  "parse: with a reviver": n => [ordersText(n), text => JSON.parse(text, (key, value) => value).length],
  "parse: lists of every length": n => [listOf(Math.ceil(Math.sqrt(2 * n)), at => "[" + Array.from({ length: at }, (_, k) => k).join(",") + "]"), text => JSON.parse(text).length],
  "parse: lists that mix kinds": n => [listOf(n, at => ["[1,2.5]", '[1,"a"]', "[null,1]", "[{},1.5]", "[[],true]"][at % 5]), text => JSON.parse(text).length],
  "stringify: orders": n => [orders(n), list => JSON.stringify(list).length],
  "stringify: orders, one by one": n => [orders(n), list => list.reduce((sum, value) => sum + JSON.stringify(value).length, 0)],
  "Object.fromEntries: orders": n => [Array.from({ length: n }, (_, at) => order(at).map((name, k) => [name, k])), lists => lists.map(list => Object.fromEntries(list)).length],
  "Object.assign to an empty object: orders": n => [orders(n), list => list.map(value => Object.assign({}, value)).length],
  "Object.assign to an instance: orders": n => [orders(n), list => list.map(value => Object.assign(new Point(), value)).length],
  "spread: orders": n => [orders(n), list => list.map(value => ({ ...value })).length],
  "spread behind a name: orders": n => [orders(n), list => list.map(value => ({ kind: 1, ...value })).length],
  "rest: orders": n => [orders(n), list => list.map(({ a, ...rest }) => rest).length],
  "read by a written name: orders": n => [orders(n), list => list.reduce((sum, value) => sum + value.a + value.j, 0)],
  "read by a computed name: orders": n => [orders(n), list => list.reduce((sum, value, at) => sum + value[letters[at % 10]], 0)],
  "write a written name: orders": n => [orders(n), list => list.forEach(value => void (value.e = 1))],
  "add a written name: orders": n => [orders(n), list => list.forEach(value => void (value.extra = 1))],
  "add a computed name: orders": n => [orders(n), list => list.forEach((value, at) => void (value["x" + (at % 7)] = 1))],
  "add names one by one in every order": n => [Array.from({ length: n }, (_, at) => order(at)), lists => lists.map(names => { const made = {}; for (const name of names) made[name] = 1; return made; }).length],
  "add n new names to one object": n => [Array.from({ length: n }, (_, at) => "id" + at), names => { const made = {}; for (const name of names) made[name] = 1; return Object.keys(made).length; }],
  "add a new name to each of n objects": n => [Array.from({ length: n }, (_, at) => "id" + at), names => names.map(name => ({ [name]: 1 })).length],
  "delete a name: orders": n => [orders(n), list => list.forEach(value => void delete value.c)],
  "delete and add again: orders": n => [orders(n), list => list.forEach(value => { delete value.c; value.c = 1; })],
  "Object.keys: orders": n => [orders(n), list => list.reduce((sum, value) => sum + Object.keys(value).length, 0)],
  "Object.entries: orders": n => [orders(n), list => list.reduce((sum, value) => sum + Object.entries(value).length, 0)],
  "Object.values: orders": n => [orders(n), list => list.reduce((sum, value) => sum + Object.values(value).length, 0)],
  "for-in: orders": n => [orders(n), list => list.reduce((sum, value) => { for (const key in value) sum += value[key]; return sum; }, 0)],
  "in and hasOwn: orders": n => [orders(n), list => list.reduce((sum, value) => sum + ("a" in value ? 1 : 0) + (Object.hasOwn(value, "z") ? 1 : 0), 0)],
  "Object.freeze: orders": n => [orders(n), list => list.forEach(value => void Object.freeze(value))],
  "Object.defineProperty: orders": n => [orders(n), list => list.forEach(value => void Object.defineProperty(value, "hidden", { value: 1, enumerable: false }))],
  "Object.setPrototypeOf: orders": n => [orders(n), list => list.forEach(value => void Object.setPrototypeOf(value, Point.prototype))],
  "Object.create with each as the prototype: orders": n => [orders(n), list => list.reduce((sum, value) => sum + Object.create(value).a, 0)],
  "Object.getOwnPropertyDescriptors: orders": n => [orders(n), list => list.reduce((sum, value) => sum + Object.keys(Object.getOwnPropertyDescriptors(value)).length, 0)],
  "structuredClone: orders": n => [orders(n), list => structuredClone(list).length],
  "sort by a member: orders": n => [orders(n), list => list.sort((left, right) => left.a - right.a || left.b - right.b).length],
  "Bun.deepEquals: orders": n => [[orders(n), orders(n)], ([left, right]) => Bun.deepEquals(left, right)],
  "Bun.inspect: orders": n => [orders(Math.ceil(n / 10)), list => Bun.inspect(list, { depth: 3 }).length],
  "Map of n names": n => [Array.from({ length: n }, (_, at) => "id" + at), names => { const map = new Map(); for (const name of names) map.set(name, 1); let sum = 0; for (const name of names) sum += map.get(name); return sum; }],
  "Set of n names": n => [Array.from({ length: n }, (_, at) => "id" + at), names => new Set(names).size],
  "Map of n objects": n => [orders(n), list => { const map = new Map(); for (const value of list) map.set(value, 1); return map.size; }],
  "Map of n numbers that are far apart": n => [Array.from({ length: n }, (_, at) => at * 1000003.5), numbers => { const map = new Map(); for (const number of numbers) map.set(number, 1); return map.size; }],
  "a list written at indexes that are far apart": n => [Array.from({ length: n }, (_, at) => (at * 2654435761) % 4000000000), indexes => { const list = []; for (const index of indexes) list[index] = 1; return Object.keys(list).length; }],
  "a list written from the end": n => [n, count => { const list = []; for (let index = count; index--; ) list[index] = index; return list.length; }],
  "a regular expression over the text": n => [ordersText(n), text => [...text.matchAll(/"(\w+)":(\d+)/g)].length],
  "split and join the text": n => [ordersText(n), text => text.split(",").join(";").length],
  "replaceAll in the text": n => [ordersText(n), text => text.replaceAll('"a"', '"alpha"').length],
  "texts joined one by one": n => [Array.from({ length: n }, (_, at) => "id" + at), names => { let text = ""; for (const name of names) text += name; return text.length + text.charCodeAt(text.length >> 1); }],
  "texts compared and sorted": n => [Array.from({ length: n }, (_, at) => "id" + ((at * 2654435761) >>> 0)), names => names.sort().length],
  "Headers of n names": n => [Array.from({ length: Math.ceil(n / 10) }, (_, at) => ["x-id-" + at, "1"]), entries => [...new Headers(entries)].length],
  "URLSearchParams of n names": n => [Array.from({ length: n }, (_, at) => "id" + at + "=1").join("&"), text => [...new URLSearchParams(text)].length],
  "a switch on a text from outside": n => [Array.from({ length: n }, (_, at) => letters[at % 10] + (at % 3 ? "" : at)), names => names.reduce((sum, name) => { switch (name) { case "a": return sum + 1; case "b": return sum + 2; case "c": return sum + 3; default: return sum; } }, 0)],
  "methods called on instances of n classes": n => [Array.from({ length: Math.ceil(n / 10) }, (_, at) => new (class { at() { return at; } })()), list => list.reduce((sum, value) => sum + value.at(), 0)],
};

const [name, count] = process.argv.slice(2);
if (!name) {
  console.log(Object.keys(forms).join("\n"));
} else {
  const [ready, work] = forms[name](Number(count));
  const began = performance.now();
  const answer = work(ready);
  console.log((performance.now() - began).toFixed(1), String(answer));
}
