const json = JSON as unknown as { isRawJSON(value: unknown): boolean };
console.log(
  json.isRawJSON({}),
  json.isRawJSON("1"),
  json.isRawJSON(Object.freeze(Object.create(null, { rawJSON: { value: "1", enumerable: true } }))),
);
console.log(
  JSON.stringify({ rawJSON: "12345678901234567890", big: 12345678901234567890, list: ["text", null, -1.5e3, true] }),
);
console.log(JSON.stringify(Object.freeze(Object.create(null, { rawJSON: { value: "1", enumerable: true } }))));
console.log(
  JSON.stringify(JSON.parse("12345678901234567890")),
  JSON.stringify(JSON.parse('"日本"')),
  Object.getOwnPropertyNames(JSON).sort().join(),
);
console.log(
  JSON.stringify({ toJSON: () => "by toJSON" }),
  JSON.stringify([undefined, () => 1, Symbol.iterator, NaN, 1n < 2n]),
  JSON.stringify(" \ud800"),
  JSON.stringify({ a: 1, b: [1, 2] }, null, "--"),
);
