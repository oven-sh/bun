// + - * / % < <= > >= where nothing is known about either side and both turn out to be BigInts, beside every mix with numbers, strings, objects and nullish values (which throw, convert or compare as the language says).
const print = (s) => console.log(s);
const values = [
  0n,
  -0n,
  1n,
  -1n,
  7n,
  -7n,
  1000000n,
  4294967296n,
  -4294967296n,
  9007199254740993n,
  18446744073709551615n,
  18446744073709551616n,
  -18446744073709551617n,
  123456789012345678901234567890123456789n,
  BigInt(Date.UTC(2020, 0, 1)) * 1000000n,
  0,
  -0,
  1,
  7.5,
  NaN,
  Infinity,
  "7",
  "7n",
  "",
  "x",
  null,
  undefined,
  true,
  { valueOf() { return 7n; } },
  { valueOf() { return 7; } },
  [7],
  Symbol.iterator,
];
const operations = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b,
  remainder: (a, b) => a % b,
  less: (a, b) => a < b,
  lessOrEqual: (a, b) => a <= b,
  greater: (a, b) => a > b,
  greaterOrEqual: (a, b) => a >= b,
};
function show(x) {
  return typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : String(x);
}
for (const name in operations) {
  const operation = operations[name];
  let hash = 0;
  const samples = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      let text;
      try {
        text = show(operation(values[i], values[j]));
      } catch (e) {
        text = e.name;
      }
      for (let k = 0; k < text.length; k++)
        hash = (hash * 31 + text.charCodeAt(k)) | 0;
      if ((i * values.length + j) % 37 === 0)
        samples.push(text);
    }
  }
  print(name + " " + hash + " " + samples.join(" "));
}
function clock(ticks) {
  const scale = BigInt(1000000);
  let previous = BigInt(0);
  let origin;
  let steps = 0;
  for (const tick of ticks) {
    const current = BigInt(tick) * scale;
    if (origin === undefined)
      origin = current - previous;
    if (current > previous) {
      previous = current;
      steps++;
    }
    if (current + origin >= previous + previous)
      steps += 100;
  }
  return previous + "n " + origin + "n " + steps;
}
print(clock([5, 3, 9, 9, 12, 1700000000000, 2, 1700000000001]));
