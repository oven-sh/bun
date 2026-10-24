// Every operator on operands nothing is known about, in a loop and outside of one.
var box = JSON.parse('{"numbers": [0, 1, -1, 7, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 4294967296, 0.5, -0.5, 1e15, -1e15, 1e300, -1e300, 65536, 46341], "others": ["", "7", "x", " 12 ", true, false, null]}');
var values = box.numbers.concat(box.others, [-0, NaN, Infinity, -Infinity, undefined, 10n, -3n, { valueOf: function () { return 5; } }, { toString: function () { return "9"; } }, [], [4], Symbol.iterator]);

var unary = {
  negate: function (a) { return -a; },
  plus: function (a) { return +a; },
  not: function (a) { return ~a; },
  increment: function (a) { a++; return a; },
  decrement: function (a) { a--; return a; },
  postfix: function (a) { return a++; },
  logicalNot: function (a) { return !a; },
  typeOf: function (a) { return typeof a; },
};
var binary = {
  add: function (a, b) { return a + b; },
  sub: function (a, b) { return a - b; },
  mul: function (a, b) { return a * b; },
  div: function (a, b) { return a / b; },
  mod: function (a, b) { return a % b; },
  pow: function (a, b) { return a ** b; },
  and: function (a, b) { return a & b; },
  or: function (a, b) { return a | b; },
  xor: function (a, b) { return a ^ b; },
  shl: function (a, b) { return a << b; },
  shr: function (a, b) { return a >> b; },
  ushr: function (a, b) { return a >>> b; },
  less: function (a, b) { return a < b; },
  lessEq: function (a, b) { return a <= b; },
  greater: function (a, b) { return a > b; },
  greaterEq: function (a, b) { return a >= b; },
  eq: function (a, b) { return a == b; },
  notEq: function (a, b) { return a != b; },
  strictEq: function (a, b) { return a === b; },
  strictNotEq: function (a, b) { return a !== b; },
};

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function attempt(fn, a, b) {
  try {
    return show(fn(a, b));
  } catch (error) {
    return error.constructor.name;
  }
}

function hash(text, seed) {
  for (var i = 0; i < text.length; i++) seed = (Math.imul(seed, 31) + text.charCodeAt(i)) | 0;
  return seed;
}

for (var name in unary) {
  var line = [];
  for (var i = 0; i < values.length; i++) line.push(attempt(unary[name], values[i]));
  console.log(name, line.join(" "));
}
for (var name in binary) {
  var seed = 0;
  for (var i = 0; i < values.length; i++) {
    var row = [];
    for (var j = 0; j < values.length; j++) row.push(attempt(binary[name], values[i], values[j]));
    seed = hash(row.join(" "), seed);
    if (i < box.numbers.length && i % 4 === 0) console.log(name, i, row.slice(0, box.numbers.length).join(" "));
  }
  console.log(name, seed);
}

function inLoops(list) {
  var text = [];
  for (var i = 0; i < list.length; i++) {
    var a = list[i], b = list[(i + 5) % list.length], c = a, d = b;
    c++;
    d--;
    text.push(show(-a), show(~a), show(c), show(d), show(a + b), show(a - b), show(a * b), show(a % b), show(a >>> b), show(a === b), show(a === a), show(a < b), show(a == b));
  }
  return hash(text.join(" "), 0) + " " + text.slice(0, 26).join(" ");
}
console.log(inLoops(box.numbers.concat([-0, NaN, Infinity, -Infinity])));
console.log(inLoops(box.numbers.concat(box.others, [undefined])));
