// `JSON.parse<T>` is the compiler's addition to `JSON.parse`. A function expression under `typeof JSON.parse` gets its parameter types as it does without it.
export const parse: typeof JSON.parse = (text, reviver) => JSON.parse(text, reviver);

console.log(parse("[1]"));
console.log(parse('{"a":1,"b":2}', (key, value) => (key === "a" ? undefined : value)));
console.log(JSON.parse<number[]>("[1,2]").length);
