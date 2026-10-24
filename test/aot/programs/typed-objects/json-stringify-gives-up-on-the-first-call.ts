// The first JSON.stringify of a process, and the first after a large result, start without an output buffer. One that gives up
// then, with 16-bit text already taken, must leave nothing behind for the results that follow.
const writers: Record<string, (value: unknown) => string> = { write: (value) => JSON.stringify(value) as string };
const write = (value: unknown) => writers["write"]!(value);
interface Row { id: number; text: string; list: number[] }
interface Holds { value: unknown }
interface Pair { text: string; next: unknown }
function row(id: number): Row { return { id, text: "t" + id, list: [id, id + 1] }; }
function holds(value: unknown): Holds { return { value }; }
function pair(text: string, next: unknown): Pair { return { text, next }; }
const plain: unknown = JSON.parse('{"p":1}');
const replaced: unknown = JSON.parse('{"q":2}');
Object.defineProperty(replaced, "toJSON", { value: () => "replaced" });
const large = () => console.log(write("x".repeat(70000)).length, write(["x".repeat(70000)]).length);

console.log(write(["first 日", plain]));
console.log(write(row(1)));
console.log(write(holds([row(2), plain])));
large();
console.log(write(["after a large result 日", plain]));
console.log(write(row(3)));
large();
console.log(write(pair("in a typed object 日", replaced)));
console.log(write(row(4)));
large();
console.log(write([pair("in a list 日", replaced)]));
console.log(write("a string"));
large();
console.log(write(holds(["nested 日", replaced])));
console.log(write([5]));
large();
console.log(write(["long 日" + "z".repeat(70000), "y".repeat(70000), plain]).length);
console.log(write(row(6)));
console.log(write([row(7), "s", plain]));
console.log(write(holds([row(8), plain])));
large();
console.log(write(undefined), write(() => 1), write(Symbol("s")));
console.log(write(row(9)));
console.log(write(["wide that is finished 日"]));
console.log(write(row(10)));
