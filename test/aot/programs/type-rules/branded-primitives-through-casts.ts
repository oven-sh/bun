// A brand is a phantom: no value has it when the program runs. A branded string, and the `void & { brand }` beside it, is a string or `undefined`, so a cast from it to `string` is no cast of an object, and `.slice` on the result is the string's. A real object cast to `string` is still let through, and the place that receives it takes it. Every line prints what plain Bun prints.
type Escaped = (string & { __escaped: void }) | (void & { __escaped: void }) | "known";
type Id = number & { __tag: "id" };
const hide = (value: unknown): unknown => value;

function escape(text: string): Escaped { return (text.startsWith("__") ? "_" + text : text) as Escaped; }
function unescape(name: Escaped): string { const text = name as string; return text.length >= 3 && text.startsWith("___") ? text.slice(1) : text; }
function firstOf(text: string): string { return text.slice(0, 1); }
function next(id: Id): number { return (id as number) + 1; }
function describe(text: string): string { return typeof text + " " + String(text === undefined ? "nothing" : text.slice(0, 2)); }

console.log(unescape(escape("__proto__")), unescape(escape("plain")), unescape("known"));
console.log(firstOf(unescape(escape("abc"))), firstOf(escape("xyz") as string));
console.log(next(41 as Id), next(hide(1) as Id));
console.log(describe(hide(undefined) as Escaped as string));
const names: Escaped[] = [escape("a"), escape("__b"), "known"];
console.log(names.map(name => unescape(name)).join(","));

const sliceable = { slice: (from: number, to: number) => "object " + from + to };
console.log(firstOf(sliceable as unknown as string), describe(sliceable as unknown as string));
