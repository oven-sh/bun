// Prints querystring.parse results for a fixed set of inputs as JSON.
// querystring-node-results.json is the output of this script under Node:
//
//   node test/js/node/querystring/querystring-node-oracle.mjs > test/js/node/querystring/querystring-node-results.json
//
// querystring.test.ts compares Bun's results against that file.
import querystring from "node:querystring";

const edgeCases = [
  "__proto__=1",
  "foo=bar&foo=quux",
  "my+weird+field=q1%212%22%27w%245%267%2Fz8%29%3F",
  "foo=baz=bar",
  "str=foo&arr=1&arr=2&arr=3&somenull=&undef=",
  "foo=%zx",
  "foo=%EF%BF%BD",
  "foo&bar=baz",
  "a=b&=c&d=e",
  "&&foo=bar&&",
  "&=&=",
  "=",
  "+",
  "=+",
  "a+&",
  "=%20+&",
  "a=%E4\u00e9",
  "%2sf%2a\u4e2d",
  "a=%zz\u4e2d",
  "a=%2+0\u4e2d",
  "%2+0\u4e2d=1",
  "%",
  "q=100%",
  "discount=50%&x=y",
  "%E2%82",
  "%ED%A0%80",
  "%C0%80",
  "%C1%BF",
  "%F5%80%80%80",
  "%80",
  "%BF",
  "%E0%80%80",
  "%F0%80%80%80",
  "%E4%B8%41",
  "%e4%b8%ad=%c3%a4",
  "%F4%8F%BF%BF=%F0%90%80%80",
  "%u0041=%u00e9",
  "a=\ud800",
  "a=\ud800%41",
  "0=1",
  "0=a&0=b",
  "1=a&0=b&x=y",
  "a=b&",
  "%41%42=%zz\u4e2d",
  "%41%42=100%",
  "%C3%A4=caf\u00e9%",
  "%41+%42=%zz",
  "a=%F0%9F%98%80&b=%E4%B8%AD%E6%96%87",
  "a=%F4%90%80%80",
  "a=%E0%9F%BF",
  "x=%2G",
  "x=%",
  "x=%4",
  "4294967295=a",
  "4294967294=a",
  "01=a",
  "a=b&a=c&a=d",
  "k%E4%B8%AD=v&k%E4%B8%AD=w",
  "\u00e9=\u00e9&\u00e9=x",
  "a%2Bb=c%2Bd",
];

const maxKeysCases = [];
for (const maxKeys of [1, 2, 3, 0, -1, 1.5, Infinity, NaN, 2 ** 33]) {
  for (const input of ["a=1&b=1&c=1", "&a", "&&a=b&c=d", "a=1&a=2&a=3&b=4"]) {
    maxKeysCases.push([input, undefined, undefined, { maxKeys }]);
  }
}

// Seeded LCG so that Node and Bun generate the same inputs.
let seed = 20261019;
const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8;
const alphabet = [
  "a",
  "b",
  "z",
  "0",
  "1",
  "9",
  "A",
  "F",
  "f",
  "%",
  "%",
  "%",
  "&",
  "&",
  "=",
  "=",
  "+",
  "+",
  "\u00e9",
  "\u4e2d",
  "\ud83d",
  "\ude00",
  "\ud83d\ude00",
  "%41",
  "%E4%B8%AD",
  "%F0%9F%98%80",
  "%ED%A0%80",
  "%C0%80",
  "%2",
  "%zz",
  "__proto__",
  "4",
  "12",
  " ",
];
const fuzzCases = [];
for (let i = 0; i < 800; i++) {
  const length = rand() % 12;
  let input = "";
  for (let j = 0; j < length; j++) input += alphabet[rand() % alphabet.length];
  const form = rand() % 4;
  if (form === 0) fuzzCases.push([input, undefined, undefined, { maxKeys: rand() % 4 }]);
  else if (form === 1) fuzzCases.push([input, null, null, undefined]);
  else fuzzCases.push([input, undefined, undefined, undefined]);
}

const serialize = result =>
  JSON.stringify(result) + "|" + Object.keys(result).join("\u0001") + "|" + (Object.getPrototypeOf(result) === null);

const cases = [...edgeCases.map(input => [input, undefined, undefined, undefined]), ...maxKeysCases, ...fuzzCases];
// JSON has no undefined: an absent property is an undefined argument, and a
// non-finite maxKeys is written as a string.
const results = cases.map(([input, sep, eq, options]) => ({
  input,
  sep,
  eq,
  options,
  expected: serialize(querystring.parse(input, sep, eq, options)),
}));

const replacer = (key, value) => (typeof value === "number" && !Number.isFinite(value) ? `#${value}` : value);
const version = typeof Bun === "undefined" ? process.version : `bun ${Bun.version}`;
console.log(
  `{"version":${JSON.stringify(version)},"results":[\n${results.map(r => JSON.stringify(r, replacer)).join(",\n")}\n]}`,
);
