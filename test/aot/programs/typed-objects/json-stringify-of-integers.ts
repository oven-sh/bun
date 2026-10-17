// Integers around every digit count, written by the compiled writers at a known and an unknown type.
interface Row { a: number; b: number }
const write = (row: Row): string => JSON.stringify(row);
const writers: Record<string, (value: unknown) => string> = { write: (value) => JSON.stringify(value) as string };
const total: number[] = [];
for (let i = 0; i <= 10100; i++) {
  const row: Row = { a: i, b: -i };
  const text = write(row);
  if (text !== `{"a":${i},"b":${i === 0 ? 0 : "-" + i}}` || writers["write"]!(row) !== text) console.log("wrong", text);
  total.push(text.length);
}
for (const i of [99999, 100000, 2147483647, -2147483648]) console.log(write({ a: i, b: i }));
console.log(total.reduce((sum, length) => sum + length, 0));
