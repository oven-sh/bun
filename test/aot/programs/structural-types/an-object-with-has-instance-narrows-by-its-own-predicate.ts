interface Dog {
  name: string;
  legs: number;
  bark(): string;
}

const DogLike = {
  asked: 0,
  [Symbol.hasInstance](value: unknown): value is Dog {
    this.asked++;
    return typeof value === "object" && value !== null && "name" in value;
  },
};

const AnyNumber = {
  [Symbol.hasInstance](value: unknown): value is number {
    return true;
  },
};

const AnyList = {
  [Symbol.hasInstance](value: unknown): value is number[] {
    return typeof value === "object";
  },
};

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function legs(value: unknown): string {
  return value instanceof DogLike ? typeof value.legs + " " + value.legs : "no dog";
}

function double(value: unknown): string {
  return value instanceof DogLike ? String(value.legs * 2) : "no dog";
}

function bark(value: unknown): string {
  return value instanceof DogLike ? value.bark() : "no dog";
}

function plusOne(value: unknown): string {
  if (value instanceof AnyNumber) {
    const next = value + 1;
    return typeof next + " " + next;
  }
  return "no number";
}

function fixed(value: unknown): string {
  return value instanceof AnyNumber ? value.toFixed(1) : "no number";
}

function total(value: unknown): string {
  if (value instanceof AnyList) {
    let sum = 0;
    for (let i = 0; i < value.length; i++) sum += value[i];
    return typeof value.length + " " + sum;
  }
  return "no list";
}

const real: Dog = { name: "rex", legs: 4, bark: () => "woof" };
let warm = 0;
for (let i = 0; i < 2000; i++) warm += legs(real).length + double(real).length + bark(real).length + plusOne(i).length + total([i]).length;
console.log("2000 honest: " + warm);

const values: [string, unknown][] = [
  ["a dog", real],
  ["only a name", { name: "cat" }],
  ["legs that are a string", { name: "spider", legs: "eight" }],
  ["an error", new RangeError("e")],
  ["a number", 5],
  ["null", null],
];
for (const [label, value] of values) {
  attempt(label + ", legs", () => legs(value));
  attempt(label + ", double", () => double(value));
  attempt(label + ", bark", () => bark(value));
}
console.log("asked: " + (DogLike.asked - 6000));

const numbers: [string, unknown][] = [
  ["a number", 1.5],
  ["a string", "text"],
  ["undefined", undefined],
  ["an object", { a: 1 }],
  ["a bigint", 5n],
];
for (const [label, value] of numbers) {
  attempt(label + ", plus one", () => plusOne(value));
  attempt(label + ", toFixed", () => fixed(value));
}

const lists: [string, unknown][] = [
  ["a list", [1, 2, 3]],
  ["an object with a length", { length: 2, 0: 5, 1: 6 }],
  ["an empty object", {}],
  ["null", null],
  ["a list of strings", ["a", "b"]],
];
for (const [label, value] of lists) attempt(label + ", total", () => total(value));

export {};
