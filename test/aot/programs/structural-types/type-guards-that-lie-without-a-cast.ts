function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Animal {
  name = "animal";
}

class Dog extends Animal {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

class Cat extends Animal {
  lives = "nine";
}

function isDog(a: Animal): a is Dog {
  return true;
}

function isDogByName(a: Animal): a is Dog {
  return a.name === "animal";
}

function isNumber(v: number | string): v is number {
  return v !== "text";
}

function isList(v: number[] | string): v is number[] {
  return v.length > 1;
}

function isPresent<T>(v: T | undefined): v is T {
  return true;
}

function legsOf(a: Animal): number {
  return isDog(a) ? a.legs + 1 : -1;
}

function barkOf(a: Animal): number {
  if (isDogByName(a)) return a.bark();
  return -1;
}

function half(v: number | string): number | string {
  return isNumber(v) ? v / 2 : v.toUpperCase();
}

function added(v: number | string): number | string {
  if (isNumber(v)) {
    const n: number = v;
    return n + 1;
  }
  return v;
}

function total(v: number[] | string): number {
  if (!isList(v)) return -v.length;
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  return sum;
}

function present(v: number | undefined): number {
  return isPresent(v) ? v + 1 : -1;
}

attempt("honest", () => [legsOf(new Dog()), barkOf(new Dog()), half(4), half("text"), added(1), total([1, 2]), total("a"), present(1)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += legsOf(new Dog()) + barkOf(new Dog()) + Number(half(i)) + Number(added(i)) + total([i, 1]) + present(i);
console.log("2000 honest rounds", warm);

attempt("a cat: a field", () => legsOf(new Cat()));
attempt("a cat: a method", () => barkOf(new Cat()));
attempt("an animal: a field", () => legsOf(new Animal()));
attempt("an animal: a method", () => barkOf(new Animal()));
attempt("a literal animal", () => [legsOf({ name: "literal" }), barkOf({ name: "literal" })]);
attempt("a string taken for a number: half", () => half("8"));
attempt("a string taken for a number: added", () => added("8"));
attempt("a string taken for a list", () => total("12"));
attempt("a short list taken for a string", () => total([5]));
attempt("undefined taken for present", () => present(undefined));
attempt("filter with the guard", () => {
  const pets: Animal[] = [new Dog(), new Cat(), new Animal()];
  const dogs: Dog[] = pets.filter(isDog);
  return dogs.map(d => d.legs);
});
attempt("filter with the guard, then a method", () => {
  const pets: Animal[] = [new Dog(), new Cat()];
  const dogs: Dog[] = pets.filter(isDog);
  return dogs.map(d => d.bark());
});
attempt("find with the guard", () => {
  const pets: Animal[] = [new Cat(), new Dog()];
  const dog: Dog | undefined = pets.find(isDog);
  return dog === undefined ? "none" : dog.legs;
});
attempt("every with the guard", () => {
  const pets: Animal[] = [new Cat(), new Dog()];
  return pets.every(isDog) ? pets.map(d => d.legs) : "no";
});
attempt("a guard nobody wrote", () => {
  const values: (number | string)[] = [1, "2", 3];
  const numbers = values.filter(v => typeof v === "number");
  return numbers.map(n => n + 1);
});
attempt("a guard nobody wrote, over a tag that is rewritten later", () => {
  type Pet = { kind: "dog"; legs: number } | { kind: "cat"; lives: string };
  const pets: Pet[] = [{ kind: "dog", legs: 4 }, { kind: "cat", lives: "nine" }];
  const dogs = pets.filter(p => p.kind === "dog");
  const open: { kind: "dog" | "cat" } = pets[1];
  open.kind = "dog";
  const more = pets.filter(p => p.kind === "dog");
  return [dogs.map(d => d.legs + 1), more.map(d => d.legs + 1)];
});
attempt("kept in a field", () => {
  class Kennel {
    dog: Dog = new Dog();
    take(a: Animal): void {
      if (isDog(a)) this.dog = a;
    }
  }
  const k = new Kennel();
  k.take(new Cat());
  return [k.dog.legs, k.dog.name, k.dog instanceof Dog];
});
attempt("kept in a field, then called", () => {
  class Kennel {
    dog: Dog = new Dog();
    take(a: Animal): void {
      if (isDog(a)) this.dog = a;
    }
  }
  const k = new Kennel();
  k.take(new Cat());
  return k.dog.bark();
});
attempt("a method that is a guard", () => {
  class Shape {
    sides = 4;
    isSquare(): this is Square {
      return true;
    }
  }
  class Square extends Shape {
    edge = 2;
  }
  const s = new Shape();
  return s.isSquare() ? s.edge * 2 : -1;
});
attempt("honest again", () => [legsOf(new Dog()), barkOf(new Dog()), half(4), added(1), total([1, 2]), present(1)]);
