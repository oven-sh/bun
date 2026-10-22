function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

const where = "outer";

function shadowedByVar(read: () => string = () => where): string {
  var where = "inner";
  return read() + " and " + where;
}

function shadowedByLet(read: () => string = () => where): string {
  let where = "inner";
  return read() + " and " + where;
}

function shadowedByFunction(read: () => string = () => typeof helper): string {
  function helper(): void {}
  return read() + " and " + typeof helper;
}
const helper = 5;

function separate(a: number, read: () => number = () => a): string {
  var a: number;
  const before = a;
  a = 99;
  return "before " + text(before) + ", variable " + text(a) + ", parameter " + text(read());
}

function shared(a: number): string {
  const read = (): number => a;
  var a: number;
  const before = a;
  a = 99;
  return "before " + text(before) + ", variable " + text(a) + ", through a closure " + text(read());
}

function written(a: number, write: (n: number) => void = n => {
  a = n;
}, read: () => number = () => a): string {
  var a: number;
  write(5);
  return "variable " + text(a) + ", parameter " + text(read());
}

function simpleList(a: number, b: number): string {
  a = 10;
  return text(arguments[0]) + " " + text(arguments[1]) + " " + text(a + b);
}

function withADefault(a: number, b: number = 2): string {
  a = 10;
  return text(arguments[0]) + " " + text(arguments[1]) + " " + text(a + b);
}

function argumentsInADefault(a: number, count: number = arguments.length, firstOne: unknown = arguments[0]): string {
  return text(a) + " " + text(count) + " " + text(firstOne);
}

function thisInAnArrowDefault(this: { tag: string }, read: () => string = () => this.tag): string {
  return read();
}

function makeCounter(start: number = 0, step: () => number = () => ++start): () => number {
  return step;
}

console.log("a var of the body: " + shadowedByVar());
console.log("a let of the body: " + shadowedByLet());
console.log("a function of the body: " + shadowedByFunction());
console.log("a var with the parameter's name: " + separate(1));
console.log("the same without a default: " + shared(1));
console.log("a default writes the parameter: " + written(1));
console.log("arguments, simple list: " + simpleList(1, 2));
console.log("arguments, with a default: " + withADefault(1));
console.log("arguments, with a default that is given: " + withADefault(1, 5));
console.log("arguments in a default: " + argumentsInADefault(7));
console.log("arguments in a default, all given: " + argumentsInADefault(7, 8, 9));
console.log("this in an arrow default: " + thisInAnArrowDefault.call({ tag: "receiver" }));

const counterA = makeCounter();
const counterB = makeCounter(10);
console.log("closures over a parameter: " + [counterA(), counterA(), counterB(), counterA(), counterB()].join());

let total = 0;
for (let i = 0; i < 2000; i++) total += separate(i).length + shadowedByVar().length;
console.log("2000 calls: " + total);
