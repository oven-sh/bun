function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Dog {
  weight: number;
  sound: string;
  roll(times: number): number;
}
class Dog {
  legs: number = 4;
}
declare namespace Dog {
  let make: (legs: number) => Dog;
  let count: number;
}

function helper(n: number): number {
  return n + 1;
}
declare namespace helper {
  let twice: (n: number) => number;
}

namespace Hooks {
  export let onDone: (n: number) => number;
  export let level: number;
}

let callback: (n: number) => number;
let total: number;

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value + " " + String(value);
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : "another error";
  }
}

const dog = new Dog();

function all(): string[] {
  return [
    attempt(() => dog.weight),
    attempt(() => dog.weight + 1),
    attempt(() => dog.sound.length),
    attempt(() => dog.roll(2)),
    attempt(() => Dog.make(3).legs),
    attempt(() => Dog.count + 1),
    attempt(() => helper.twice(2)),
    attempt(() => Hooks.onDone(1)),
    attempt(() => Hooks.level + 1),
    attempt(() => callback(1)),
    attempt(() => total + 1),
  ];
}

function install(): void {
  Dog.prototype.weight = 30;
  Dog.prototype.sound = "woof";
  Dog.prototype.roll = function (this: Dog, times: number): number {
    return this.legs * times;
  };
  Dog.make = legs => {
    const made = new Dog();
    made.legs = legs;
    return made;
  };
  Dog.count = 1;
  helper.twice = n => n * 2;
  Hooks.onDone = n => n + 10;
  Hooks.level = 5;
  callback = n => n + 100;
  total = 7;
}

show("before", () => all());
show("before, again", () => all());
install();
show("after", () => all());

let letters = 0;
for (let i = 0; i < 2000; i++) letters += all().join().length;
show("2000 rounds", () => letters);
