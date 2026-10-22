function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function read(numbers: number[], key: number): number {
  return numbers[key];
}

function readPlusOne(numbers: number[], key: number): number {
  return numbers[key] + 1;
}

function write(numbers: number[], key: number, value: number): void {
  numbers[key] = value;
}

function isIn(numbers: number[], key: number): boolean {
  return key in numbers;
}

function state(numbers: number[]): string {
  return "length " + numbers.length + ", keys " + Object.keys(numbers).join() + ", " + (numbers.length < 10 ? JSON.stringify(numbers) : "long");
}

let total = 0;
const warm = [1, 2, 3];
for (let i = 0; i < 2000; i++) {
  write(warm, i % 3, i);
  total += read(warm, i % 3) + readPlusOne(warm, (i + 1) % 3) + (isIn(warm, i % 3) ? 1 : 0);
}
console.log("2000 honest rounds: " + total);

const keys = [1, -1, 1.5, -0, NaN, Infinity, -Infinity, 0.1 + 0.2, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), 2 ** 32 - 2, 2 ** 32 - 1, 2 ** 32, 2 ** 53, 1e21, 5e-324];
for (const key of keys) {
  attempt("read " + show(key), () => {
    const numbers = [10, 20, 30];
    return [typeof read(numbers, key), read(numbers, key), readPlusOne(numbers, key), isIn(numbers, key)];
  });
  attempt("write " + show(key), () => {
    const numbers = [10, 20, 30];
    write(numbers, key, 7);
    return [state(numbers), read(numbers, key), isIn(numbers, key)];
  });
  attempt("delete " + show(key), () => {
    const numbers = [10, 20, 30];
    write(numbers, key, 7);
    const deleted = delete numbers[key];
    return [deleted, state(numbers)];
  });
}

const literal = [10, 20, 30];
attempt("written out: reads", () => [literal[-1], literal[1.5], literal[-0], literal[NaN], literal[Infinity], literal[4294967294], literal[4294967295], literal[9007199254740992], literal[1e21]]);
literal[-1] = 1;
literal[1.5] = 2;
literal[-0] = 3;
literal[NaN] = 4;
literal[Infinity] = 5;
literal[4294967295] = 6;
literal[9007199254740992] = 7;
literal[1e21] = 8;
console.log("written out: after eight stores: " + state(literal));
attempt("written out: reads again", () => [literal[-1], literal[1.5], literal[-0], literal[0], literal[NaN], literal[Infinity], literal[4294967295], literal[9007199254740992], literal[9007199254740993], literal[1e21]]);
attempt("the elements alone", () => [literal.map(n => n + 1), literal.reduce((a, b) => a + b, 0), [...literal], literal.slice()]);
attempt("for in", () => {
  const seen: string[] = [];
  for (const key in literal) seen.push(key + "=" + literal[key]);
  return seen;
});
literal[4294967294] = 9;
console.log("the largest index: " + state(literal));

export {};
