function answersFor(value: number): string {
  return [isFinite(value), Number.isFinite(value), Number.isSafeInteger(value), Number.isInteger(value), isNaN(value)].join();
}

const edges = [
  9007199254740990, 9007199254740991, 9007199254740992, 9007199254740994, -9007199254740991, -9007199254740992, 4611686018427387904,
  2147483647, 2147483648, 0, -0, 1.5, NaN, Infinity, -Infinity,
];
for (const edge of edges) console.log(edge, answersFor(edge));

for (let integer = 9007199254740989; integer <= 9007199254740991; integer++) {
  console.log(Number.isSafeInteger(integer), Number.isSafeInteger(integer + 1), isFinite(integer + 1), Number.isSafeInteger(-integer - 1));
}

function answersForInt32(value: number): string {
  const integer = value | 0;
  return [isFinite(integer), Number.isSafeInteger(integer), isFinite(integer * 4294967296), Number.isSafeInteger(integer * 4294967296)].join();
}
for (const value of [0, 1, -1, 2097151, 2097152, -2097152, 2147483647, -2147483648, 1e300]) console.log(value, answersForInt32(value));

function textOf(text: string): unknown[] {
  const same = String(text);
  const wrapped = new String(text);
  return [same === text, typeof same, typeof wrapped, wrapped == text, (wrapped as unknown) === text, same.length];
}
for (const text of ["", "a", "a" + edges.length, "\u{1F600}"]) console.log(textOf(text));
console.log(String(Symbol("s")), String(), String(undefined), String(null));
