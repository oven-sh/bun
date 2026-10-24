class Person {
  first: string;
  constructor(first: string) {
    this.first = first;
  }
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs: number = 4;
  tag: string = "rex-tag";
  owner: Person = new Person("ann");
  tricks: string[] = ["sit", "roll"];
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives: string = "nine";
  weight: number = 3.5;
  toys: number[] = [7, 8, 9];
  enemy: Person = new Person("bob");
  purr(): string {
    return this.name + " purrs";
  }
}

class Spider extends Animal {
  legs: string = "eight";
  tag: number = 88;
}

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Keeper {
  legsOf(a: Animal): number;
}

class DogKeeper implements Keeper {
  legsOf(d: Dog): number {
    return d.legs + 1;
  }
}

const cat: Animal = new Cat("tom");
const dog: Animal = new Dog("rex");

function test(way: string, keeper: Keeper): void {
  show(way + ": cat", () => keeper.legsOf(cat));
  show(way + ": dog", () => keeper.legsOf(dog));
}

function returned(): Keeper {
  return new DogKeeper();
}
function identity<T>(value: T): T {
  return value;
}
function defaulted(keeper: Keeper = new DogKeeper()): Keeper {
  return keeper;
}
function rest(...keepers: Keeper[]): Keeper {
  return keepers[0];
}
function* yielded(): Generator<Keeper> {
  yield new DogKeeper();
}
class Holder {
  keeper: Keeper = new DogKeeper();
  static shared: Keeper = new DogKeeper();
  constructor(public given: Keeper) {}
}

const variable: Keeper = new DogKeeper();
test("a variable", variable);
test("an argument", new DogKeeper());
test("a result", returned());
test("a type argument", identity<Keeper>(new DogKeeper()));
test("a default", defaulted());
test("a rest parameter", rest(new DogKeeper()));
test("a field", new Holder(new DogKeeper()).keeper);
test("a parameter property", new Holder(new DogKeeper()).given);
test("a static field", Holder.shared);

const dogKeepers: DogKeeper[] = [new DogKeeper()];
const asList: Keeper[] = dogKeepers;
test("an array of them", asList[0]);
test("a spread array", [...dogKeepers][0]);
const literalList: Keeper[] = [new DogKeeper()];
test("an array literal", literalList[0]);
const tuple: [Keeper, number] = [new DogKeeper(), 1];
test("a tuple", tuple[0]);
const record: Record<string, Keeper> = { k: new DogKeeper() };
test("a record", record.k);
test("values of a record", Object.values(record)[0]);
const nested: { inner: { keeper: Keeper } } = { inner: { keeper: new DogKeeper() } };
test("a nested literal", nested.inner.keeper);
const { inner: { keeper: destructured } } = nested;
test("destructured", destructured);
const conditional: Keeper = cat.name.length > 0 ? new DogKeeper() : { legsOf: () => 0 };
test("a conditional", conditional);
const maybe: Keeper | null = cat.name.length > 0 ? new DogKeeper() : null;
if (maybe !== null) test("a union with null", maybe);
const missing: DogKeeper | undefined = undefined;
test("after ??", missing ?? new DogKeeper());
test("after ||", missing || new DogKeeper());
test("after a comma", (dog.name.trim(), new DogKeeper()));
for (const keeper of yielded()) test("yielded", keeper);
for (const keeper of new Set<Keeper>([new DogKeeper()])) test("from a set", keeper);
const fromMap = new Map<number, Keeper>([[1, new DogKeeper()]]).get(1);
if (fromMap !== undefined) test("from a map", fromMap);
const made: () => Keeper = () => new DogKeeper();
test("a function type's result", made());
const makesDogKeeper = (): DogKeeper => new DogKeeper();
const widened: () => Keeper = makesDogKeeper;
test("a function type widened", widened());
class SubKeeper extends DogKeeper {}
test("a subclass", new SubKeeper());
test("Object.assign", Object.assign(new DogKeeper(), { extra: 1 }));
test("Object.create", Object.create(new DogKeeper()));

Promise.resolve<Keeper>(new DogKeeper()).then(keeper => {
  test("a promise", keeper);
  return (async (): Promise<Keeper> => new DogKeeper())();
}).then(keeper => test("an async result", keeper));
