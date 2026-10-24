// `a === b` where nothing is known about either side and both turn out to be strings: every pair of representations (literal, built at run time, rope, substring, 16-bit, property key), beside symbols, BigInts, numbers and objects; outside a loop, in a loop, and walking a linked list by key.
const print = (s) => console.log(s);
function join(a, b) {
  return a + b;
}
const long = join("the quick brown fox jumps over ", "the lazy dog");
const values = [
  "",
  "a",
  "b",
  "key",
  "kez",
  "service/one",
  "service/two",
  "service/three",
  join("service/", "one"),
  join("service", "/two"),
  join(join("ser", "vice"), join("/", "three")),
  long,
  join("the quick brown fox jumps over the lazy ", "dog"),
  join("the quick brown fox jumps over the lazy ", "doh"),
  long.slice(4, 9),
  "quick",
  "xquickx".substring(1, 6),
  String.fromCharCode(113, 117, 105, 99, 107),
  "ābc",
  join("ā", "bc"),
  "abc",
  "ābc".slice(1),
  "bc",
  Object.keys({ key: 1, "service/one": 2 })[0],
  Object.keys({ key: 1, "service/one": 2 })[1],
  JSON.parse('"service/two"'),
  String(12),
  "12",
  12,
  12.5,
  "12.5",
  NaN,
  "NaN",
  0,
  -0,
  "0",
  10n,
  10n + 0n,
  11n,
  "10",
  123456789012345678901234567890n,
  123456789012345678901234567890n * 1n,
  Symbol.iterator,
  Symbol("key"),
  Symbol.for("key"),
  Symbol.for("key"),
  null,
  undefined,
  "null",
  "undefined",
  true,
  "true",
  false,
  {},
  [],
  new String("key"),
  print,
];
function same(a, b) {
  return a === b;
}
function differ(a, b) {
  return a !== b;
}
let table = "";
for (let i = 0; i < values.length; i++) {
  let row = "";
  for (let j = 0; j < values.length; j++) {
    const first = same(values[i], values[j]);
    if (first === differ(values[i], values[j]))
      print("=== and !== agree at " + i + ", " + j);
    if (first !== (values[i] === values[j]))
      print("the loop and the function differ at " + i + ", " + j);
    row += first ? "1" : ".";
  }
  table += row + "\n";
}
print(table);

function add(parent, key, value) {
  return { key, value, parent };
}
function find(list, key) {
  for (let entry = list; entry; entry = entry.parent) {
    if (entry.key === key)
      return entry.value;
  }
  return "absent";
}
let list;
for (let i = 0; i < values.length; i++)
  list = add(list, values[i], i);
let found = "";
for (let i = 0; i < values.length; i++)
  found += find(list, values[i]) + " ";
print(found);
print(find(list, join("service/th", "ree")) + " " + find(list, join("service/fo", "ur")) + " " + find(list, "quic" + "k") + " " + find(list, join("āb", "c")) + " " + find(list, join("āb", "d")));

function count(keys, wanted) {
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === wanted)
      n++;
  }
  return n;
}
let counts = "";
for (let i = 0; i < values.length; i++)
  counts += count(values, values[i]);
print(counts);
