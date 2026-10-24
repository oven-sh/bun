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

function inspect(numbers: number[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const value = numbers[i];
    const exact = Object.is(value, undefined) ? "undefined" : Object.is(value, 0) ? "zero" : Object.is(value, -0) ? "minus zero" : Object.is(value, NaN) ? "not a number" : String(value);
    lines.push(i + " " + (i in numbers ? "present" : "absent") + " " + typeof value + " " + exact);
  }
  return lines;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function sumByForOf(numbers: number[]): number {
  let total = 0;
  for (const number of numbers) total += number;
  return total;
}

function sumAsIntegers(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total = (total + numbers[i]) | 0;
  return total;
}

function doubled(numbers: number[]): number[] {
  return numbers.map(number => number * 2);
}

function doubledByHand(numbers: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < numbers.length; i++) result.push(numbers[i] * 2);
  return result;
}

function report(name: string, make: () => number[]): void {
  attempt(name + ": elements", () => inspect(make()));
  attempt(name + ": length", () => make().length);
  attempt(name + ": sum", () => sum(make()));
  attempt(name + ": sum by for-of", () => sumByForOf(make()));
  attempt(name + ": sum as integers", () => sumAsIntegers(make()));
  attempt(name + ": map", () => doubled(make()));
  attempt(name + ": doubled by hand", () => doubledByHand(make()));
  attempt(name + ": the first, fixed", () => make()[0].toFixed(1));
  attempt(name + ": after a push", () => {
    const numbers = make();
    const length = numbers.push(7);
    return [length, inspect(numbers), sum(numbers)];
  });
  attempt(name + ": after a store at 1", () => {
    const numbers = make();
    numbers[1] = 1.5;
    return [inspect(numbers), sum(numbers)];
  });
  attempt(name + ": keys", () => Object.keys(make()));
  attempt(name + ": JSON", () => JSON.stringify(make()));
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  for (const dense of [[i, 2, 3], [i + 0.5, 2.5, 3.5]]) {
    warm += inspect(dense).length + sum(dense) + sumByForOf(dense) + sumAsIntegers(dense) + doubled(dense)[0] + doubledByHand(dense)[1];
  }
}
console.log("after 4000 dense arrays", warm);

report("delete the first of integers", () => {
  const numbers = [1, 2, 3];
  delete numbers[0];
  return numbers;
});
report("delete the first of doubles", () => {
  const numbers = [1.5, 2.5, 3.5];
  delete numbers[0];
  return numbers;
});
report("the length is raised", () => {
  const numbers = [1];
  numbers.length = 3;
  return numbers;
});
report("the length of doubles is raised", () => {
  const numbers = [1.5];
  numbers.length = 3;
  return numbers;
});
report("a store past the end", () => {
  const numbers: number[] = [];
  numbers[2] = 3;
  return numbers;
});
report("a store of a double past the end", () => {
  const numbers: number[] = [];
  numbers[2] = 3.5;
  return numbers;
});
report("lowered and raised again", () => {
  const numbers = [1, 2, 3];
  numbers.length = 1;
  numbers.length = 3;
  return numbers;
});
report("popped and raised", () => {
  const numbers = [1.5, 2.5, 3.5];
  numbers.pop();
  numbers.pop();
  numbers.length = 3;
  return numbers;
});
report("spliced out of a holey array", () => {
  const numbers = new Array<number>(5);
  numbers[4] = 4;
  numbers.splice(1, 2);
  return numbers;
});
report("reversed", () => {
  const numbers = new Array<number>(3);
  numbers[0] = 1;
  return numbers.reverse();
});
report("copyWithin copies a hole", () => {
  const numbers = [1, 2, 3];
  delete numbers[2];
  return numbers.copyWithin(0, 2);
});
report("concat keeps holes", () => new Array<number>(2).concat([3]));
report("slice keeps holes", () => {
  const numbers = [1, 2, 3, 4];
  delete numbers[1];
  return numbers.slice(1);
});
report("unshift moves holes", () => {
  const numbers = new Array<number>(2);
  numbers.unshift(1);
  return numbers;
});
