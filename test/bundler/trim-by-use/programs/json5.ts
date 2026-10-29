const value: any = Bun.JSON5.parse(
  `{ unquoted: 'single', hex: 0x1F, trailing: [1, 2,], /* comment */ plus: +1, inf: Infinity }`,
);
console.log(value.unquoted, value.hex, value.trailing.length, value.plus, value.inf);
console.log(Bun.JSON5.stringify({ a: 1, "b-c": [NaN, "x"] }));
