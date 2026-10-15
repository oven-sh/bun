// Code that a program makes at run time reads `length` of strings of every kind, and of everything else that has or has not a length.
const lines = [];
const lengthOf = new Function("value", "return value.length;");
const total = new Function("values", "let sum = 0; for (let i = 0; i < values.length; i++) { const n = values[i].length; sum += typeof n === 'number' ? n : 1000; } return sum;");
const within = new Function("value", "least", "most", "return typeof value === 'string' && value.length >= least && value.length <= most;");
const show = (name, run) => {
  let text;
  try {
    const value = run();
    text = typeof value + " " + String(value);
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  lines.push(name + ": " + text);
};
const long = "abcdefghij".repeat(1000);
const values = () => [
  "", "a", "abc", "é", "中文字", "😀", "a😀b", long, long + long, long.slice(10, 5000), long.slice(3, 4), "left" + String(lines.length) + "right", ("x" + lines.length).padEnd(40, "é中"), `${lines.length}`,
  String.fromCharCode(0), String.fromCharCode(0xd800), JSON.parse('"from json"'), [1, 2, 3].join("-"), "A".toLowerCase(), Symbol.iterator.description,
  new String("wrapped"), Object("boxed"), [], [1, 2, 3], new Array(7), new Uint8Array(5), new Float64Array(2), { length: "mine" }, { length: -1 }, { get length() { return 42; } }, Object.create({ length: 9 }), {},
  function (a, b) {}, () => {}, class { constructor(a) {} }, new Map([[1, 2]]), new Set([1]), new ArrayBuffer(8), /abc/g, 5, 5.5, NaN, true, false, 10n, Symbol("s"), null, undefined,
  (function () { return arguments; })(1, 2, 3), new Proxy([1, 2], {}), new Proxy({}, { get: (target, key) => "trapped " + String(key) }),
];
for (let round = 0; round < 4; round++) {
  values().forEach((value, index) => show("length " + index, () => lengthOf(value)));
  show("total", () => total(values().slice(0, 44)));
  for (const value of values()) show("within", () => within(value, 1, 5));
}
let sum = 0;
for (let turn = 0; turn < 20000; turn++) sum += lengthOf(turn % 3 === 0 ? "abc" : turn % 3 === 1 ? "left" + turn : [turn]);
lines.push("sum " + sum);
console.log(lines.join("\n"));
