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

function totalLegs(dogs: Dog[]): number {
  let total = 0;
  for (let i = 0; i < dogs.length; i++) total += dogs[i].legs;
  return total;
}

function firstLegs(dogs: Dog[]): number {
  return dogs[0].legs;
}

function firstBark(dogs: Dog[]): string {
  return dogs[0].bark();
}

function honestOne(): number {
  return totalLegs([new Dog("a")]) + firstLegs([new Dog("a")]) + firstBark([new Dog("a")]).length;
}
function honestTwo(): number {
  const dogs = [new Dog("b"), new Dog("c")];
  return totalLegs(dogs) + firstLegs(dogs) + firstBark(dogs).length;
}
function honestThree(size: number): number {
  const dogs: Dog[] = [];
  for (let i = 0; i <= size; i++) dogs.push(new Dog("d"));
  return totalLegs(dogs) + firstLegs(dogs) + firstBark(dogs).length;
}

function polluted(): Dog[] {
  const dogs: Dog[] = [];
  const animals: Animal[] = dogs;
  animals.push(new Cat("tom"), new Dog("rex"));
  return dogs;
}

function pollutedCaller(): unknown[] {
  const dogs = polluted();
  return [totalLegs(dogs), firstLegs(dogs)];
}

const table = { totalLegs, firstLegs };

class Vet {
  constructor(private measure: (dogs: Dog[]) => number) {}
  visit(dogs: Dog[]): number {
    return this.measure(dogs);
  }
}

attempt("the polluted caller comes first", pollutedCaller);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += honestOne() + honestTwo() + honestThree(i & 3);
console.log("after 6000 honest calls", warm);

attempt("a plain call", pollutedCaller);
attempt("a plain call that barks", () => firstBark(polluted()));
attempt("honest again", () => honestOne() + honestTwo() + honestThree(1));
attempt("call", () => [totalLegs.call(undefined, polluted()), firstLegs.call(undefined, polluted())]);
attempt("apply", () => [totalLegs.apply(undefined, [polluted()]), firstLegs.apply(undefined, [polluted()])]);
attempt("bind", () => [totalLegs.bind(undefined, polluted())(), firstLegs.bind(undefined)(polluted())]);
attempt("Reflect.apply", () => Reflect.apply(totalLegs, undefined, [polluted()]));
attempt("handed to map", () => [[new Dog("a")], polluted(), [new Dog("b")]].map(totalLegs));
attempt("handed to map, first legs", () => [[new Dog("a")], polluted(), [new Dog("b")]].map(firstLegs));
attempt("read from a literal", () => [table.totalLegs(polluted()), table.firstLegs(polluted()), table.firstLegs([new Dog("a")])]);
attempt("read by a computed name", () => (["totalLegs", "firstLegs"] satisfies (keyof typeof table)[]).map(name => table[name](polluted())));
attempt("held in a private field", () => [new Vet(totalLegs).visit(polluted()), new Vet(firstLegs).visit(polluted()), new Vet(firstLegs).visit([new Dog("a")])]);
attempt("honest at the end", () => honestOne() + honestTwo() + honestThree(1));
console.log("in a promise reaction", show(await Promise.resolve(polluted()).then(totalLegs)), show(await Promise.resolve([new Dog("a")]).then(totalLegs)));

export {};
