// JSON.parse<T>(text) adds nothing to the type of JSON.parse: a function written for `typeof JSON.parse` or `typeof JSON.stringify` takes the types of its parameters from there, as it does with tsc.
const parse: typeof JSON.parse = (text, reviver) => JSON.parse(text.trim(), reviver);
const first: typeof JSON.parse = text => JSON.parse(text.slice(0, 1));
const holder: { read: typeof JSON.parse } = { read: (text, reviver) => JSON.parse(text, reviver) };
const write: typeof JSON.stringify = (value: unknown) => JSON.stringify(value);
type Parsed = ReturnType<typeof JSON.parse>;
const parsed: Parsed = parse("[7]");
console.log(parse(' {"a":1} ').a, first("12"), holder.read("[1,2]", (key, value) => (typeof value === "number" ? value + 1 : value)).join(), write([1]), parsed[0].toFixed(1));
Promise.resolve('{"b":2}').then(JSON.parse).then(value => console.log(value.b));
interface Point { x: number; y: number }
console.log(JSON.parse<Point>('{"x":1,"y":2}').y, JSON.stringify({ x: 1, y: 2 }));
