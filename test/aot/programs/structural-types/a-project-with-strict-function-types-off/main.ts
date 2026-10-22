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

function barkOf(d: Dog): number {
  return d.bark();
}

function legsOf(d: Dog): number {
  return d.legs + 1;
}

const half = (n: number): number => n / 2;
const size = (s: string): number => s.length;

type OnAnimal = (a: Animal) => number;
type OnValue = (v: number | string) => number;

function withCat(f: OnAnimal): number {
  return f(new Cat());
}

function withDog(f: OnAnimal): number {
  return f(new Dog());
}

function withText(f: OnValue): number {
  return f("8");
}

function withNumber(f: OnValue): number {
  return f(8);
}

attempt("honest", () => [barkOf(new Dog()), legsOf(new Dog()), half(8), size("ab"), withDog(barkOf), withDog(legsOf), withNumber(half), withText(size), withCat(a => a.name.length)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += barkOf(new Dog()) + legsOf(new Dog()) + half(i) + withDog(barkOf) + withDog(legsOf) + withNumber(half) + withText(size);
console.log("2000 honest rounds", warm);

attempt("a function of dogs is called with a cat: method", () => withCat(barkOf));
attempt("a function of dogs is called with a cat: field", () => withCat(legsOf));
attempt("a function of numbers is called with a string", () => withText(half));
attempt("a function of strings is called with a number", () => withNumber(size));
attempt("in a typed variable", () => {
  const f: OnAnimal = legsOf;
  return [f(new Dog()), f(new Cat()), f(new Animal())];
});
attempt("in a field", () => {
  class Handler {
    on: OnAnimal = legsOf;
    fire(a: Animal): number {
      return this.on(a);
    }
  }
  return [new Handler().fire(new Dog()), new Handler().fire(new Cat())];
});
attempt("in an array", () => {
  const handlers: OnAnimal[] = [legsOf, a => a.name.length, (d: Dog) => d.legs * 100];
  return handlers.map(h => h(new Cat()));
});
attempt("as a result", () => {
  const pick = (): OnValue => half;
  return [pick()(8), pick()("8"), pick()("x")];
});
attempt("as a callback of a built-in", () => {
  const pets: Animal[] = [new Dog(), new Cat()];
  return pets.map(legsOf);
});
attempt("as a callback of a built-in, a method call", () => {
  const pets: Animal[] = [new Dog(), new Cat()];
  return pets.map(barkOf);
});
attempt("a comparator of dogs sorts animals", () => {
  const pets: Animal[] = [new Dog(), new Cat(), new Dog()];
  const byLegs = (a: Dog, b: Dog): number => a.legs - b.legs;
  return pets.sort(byLegs).map(p => p.constructor.name);
});
attempt("a generic holder of functions", () => {
  const box: { f: OnValue }[] = [{ f: half }, { f: size }];
  return box.map(b => [b.f(4), b.f("four")]);
});
attempt("one site, a dog 2000 times and then a cat", () => {
  const f: OnAnimal = legsOf;
  let sum = 0;
  for (let i = 0; i <= 2000; i++) sum += f(i === 2000 ? new Cat() : new Dog());
  return sum;
});
attempt("honest again", () => [barkOf(new Dog()), legsOf(new Dog()), withDog(barkOf), withNumber(half)]);
