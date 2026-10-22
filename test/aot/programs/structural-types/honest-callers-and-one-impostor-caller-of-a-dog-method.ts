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
  score(a: Animal): number;
}

class DogKeeper implements Keeper {
  score(d: Dog): number {
    let points = 0;
    for (let i = 0; i < d.tricks.length; i++) points += d.tricks[i].length;
    return points + d.legs * 100 + d.tag.length * 10 + d.owner.first.length;
  }
}

const own = new DogKeeper();
const rex = new Dog("rex");
const fido = new Dog("fido");
fido.legs = 3;
fido.tricks.push("beg");

function honestOne(): number {
  return own.score(rex);
}
function honestTwo(): number {
  return own.score(fido);
}
function honestThree(d: Dog): number {
  return own.score(d) + 1;
}
function honestFour(list: Dog[]): number {
  let sum = 0;
  for (const d of list) sum += own.score(d);
  return sum;
}

function plainImpostor(k: Keeper, a: Animal): number {
  return k.score(a);
}
function impostorByCall(k: Keeper, a: Animal): number {
  return k.score.call(k, a);
}
function impostorByApply(k: Keeper, a: Animal): number {
  return k.score.apply(k, [a]);
}
function impostorByBind(k: Keeper, a: Animal): number {
  return k.score.bind(k)(a);
}
function impostorByName(k: Keeper, a: Animal, name: "score"): number {
  return k[name](a);
}
function impostorByBuiltIn(k: Keeper, list: Animal[]): string {
  return list.map(a => {
    try {
      return String(k.score(a));
    } catch (error) {
      return "threw";
    }
  }).join();
}
function impostorByReflect(k: Keeper, a: Animal): number {
  return Reflect.apply(k.score, k, [a]);
}

function round(title: string): void {
  show(title + " honest one", honestOne);
  show(title + " honest two", honestTwo);
  show(title + " honest three", () => honestThree(rex));
  show(title + " honest four", () => honestFour([rex, fido]));
}

const impostors: Animal[] = [new Cat("tom"), new Spider("boris"), new Animal("thing"), { name: "literal" }];

round("before");
for (const impostor of impostors) {
  const kind = impostor.constructor.name;
  show(kind + " plain", () => plainImpostor(own, impostor));
  show(kind + " call", () => impostorByCall(own, impostor));
  show(kind + " apply", () => impostorByApply(own, impostor));
  show(kind + " bind", () => impostorByBind(own, impostor));
  show(kind + " computed name", () => impostorByName(own, impostor, "score"));
  show(kind + " reflect", () => impostorByReflect(own, impostor));
}
show("built-in", () => impostorByBuiltIn(own, [rex, ...impostors, fido]));
round("after");
show("dog through the impostor's door", () => plainImpostor(own, rex));
show("dog by call", () => impostorByCall(own, fido));
show("dog by reflect", () => impostorByReflect(own, fido));
