function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs = 4;
  tag = "dog tag";
  owner = { id: 7 };
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives = "nine";
  indoor = true;
  purr(): string {
    return this.name + " purrs";
  }
}

function legsAndCount(pair: [Dog, number]): number {
  return pair[0].legs + pair[1];
}

function barkOfFirst(pair: [Dog, number]): string {
  return pair[0].bark();
}

function twiceTheSecond(pair: [Dog, number]): number {
  return pair[1] * 2;
}

function lengthOf(pair: [number, number]): number {
  return pair.length;
}

function sumOf(pair: [number, number]): number {
  const [a, b] = pair;
  return a + b;
}

function textAndNumber(pair: [string, number]): string {
  return pair[0].toUpperCase() + pair[1].toFixed(1);
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: [Dog, number] = [new Dog("d"), i];
  warm += legsAndCount(honest) + barkOfFirst(honest).length + twiceTheSecond(honest) + lengthOf([i, i]) + sumOf([i, 1]) + textAndNumber(["a", i]).length;
}
console.log("after 2000 honest tuples", warm);

attempt("a cat in the first place", () => {
  const pair: [Dog, number] = [new Dog("rex"), 1];
  const wide: [Animal, number] = pair;
  wide[0] = new Cat("tom");
  return [legsAndCount(pair), pair[0].name, typeof pair[0].legs];
});
attempt("a cat in the first place barks", () => {
  const pair: [Dog, number] = [new Dog("rex"), 1];
  const wide: [Animal, number] = pair;
  wide[0] = new Cat("tom");
  return barkOfFirst(pair);
});
attempt("a string in the second place", () => {
  const pair: [Dog, number] = [new Dog("rex"), 1];
  const wide: [Dog, number | string] = pair;
  wide[1] = "one";
  return [twiceTheSecond(pair), legsAndCount(pair), typeof pair[1]];
});
attempt("as an array of the union", () => {
  const pair: [Dog, number] = [new Dog("rex"), 1];
  const loose: (Dog | number)[] = pair;
  loose[0] = 5;
  loose[1] = new Dog("second");
  return [typeof pair[0], typeof pair[1], legsAndCount(pair)];
});
attempt("reversed", () => {
  const pair: [string, number] = ["a", 1];
  pair.reverse();
  return textAndNumber(pair);
});
attempt("sorted", () => {
  const pair: [string, number] = ["b", 1];
  pair.sort();
  return [typeof pair[0], typeof pair[1]];
});
attempt("filled", () => {
  const pair: [string, number] = ["a", 1];
  pair.fill(2);
  return textAndNumber(pair);
});
attempt("pushed: the length is typed 2", () => {
  const pair: [number, number] = [1, 2];
  pair.push(3);
  return [lengthOf(pair), pair.length, sumOf(pair), pair];
});
attempt("popped: the length is typed 2", () => {
  const pair: [number, number] = [1, 2];
  pair.pop();
  return [lengthOf(pair), pair.length, sumOf(pair), pair[1], 1 in pair];
});
attempt("emptied by splice", () => {
  const pair: [number, number] = [1, 2];
  pair.splice(0);
  return [lengthOf(pair), sumOf(pair), pair[0]];
});
attempt("shifted", () => {
  const pair: [string, number] = ["a", 1];
  pair.shift();
  return textAndNumber(pair);
});
attempt("the length compared with 2", () => {
  const pair: [number, number] = [1, 2];
  pair.push(3);
  return pair.length === 2 ? "two" : "not two";
});
attempt("spread as arguments after a pop", () => {
  const add = (a: number, b: number) => a + b;
  const pair: [number, number] = [1, 2];
  pair.pop();
  return add(...pair);
});
attempt("an optional place", () => {
  const some: [number, number?] = [1];
  const wide: [number, (number | string)?] = some;
  wide[1] = "two";
  return [some.length, (some[1] ?? 0) * 2, typeof some[1]];
});
attempt("a rest of numbers gets a string", () => {
  const row: [string, ...number[]] = ["sum", 1, 2];
  const wide: [string, ...(number | string)[]] = row;
  wide.push("three");
  const [, ...numbers] = row;
  let total = 0;
  for (const number of numbers) total += number;
  return total;
});
attempt("tuples in an array", () => {
  const rows: [Dog, number][] = [[new Dog("a"), 1], [new Dog("b"), 2]];
  const wide: [Animal, number][] = rows;
  wide[1] = [new Cat("c"), 3];
  wide[0][0] = new Cat("d");
  return rows.map(legsAndCount);
});
