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
  constructor(public name: string) {}
}

class Dog extends Animal {
  legs: number = 4;
  weight: number = 20.5;
  friend: Dog | null = null;
  speak(): string {
    return "woof";
  }
  size(): number {
    return this.legs * this.weight;
  }
}

class Spider extends Animal {
  legs: string = "eight";
  weight: { grams: number } = { grams: 1 };
  friend: number = 0;
  speak: number = 3;
  size: string = "tiny";
}

class Bird extends Animal {
  weight: number = 0.25;
  legs: number = 2;
  speak(): number {
    return 99;
  }
}

function legsPlusOne(dog: Dog): number {
  return dog.legs + 1;
}

function legsTimesTwo(dog: Dog): number {
  return dog.legs * 2;
}

function halfTheWeight(dog: Dog): number {
  return dog.weight / 2;
}

function friendName(dog: Dog): string {
  return dog.friend === null ? "no friend" : dog.friend.name;
}

function speak(dog: Dog): string {
  return dog.speak().toUpperCase();
}

function size(dog: Dog): number {
  return dog.size() + 1;
}

function total(dogs: Dog[]): number {
  let sum = 0;
  for (const dog of dogs) sum += dog.legs + dog.weight;
  return sum;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const dog = new Dog("d");
  warm += legsPlusOne(dog) + legsTimesTwo(dog) + halfTheWeight(dog) + friendName(dog).length + speak(dog).length + size(dog) + total([dog]);
}
console.log("after 2000 honest dogs", warm);

const dogs: Dog[] = [new Dog("rex")];
const animals: Animal[] = dogs;
animals.push(new Spider("boris"), new Bird("tweety"), new Dog("fido"));

for (const dog of dogs) {
  attempt(dog.name + ": legs + 1", () => legsPlusOne(dog));
  attempt(dog.name + ": legs * 2", () => legsTimesTwo(dog));
  attempt(dog.name + ": weight / 2", () => halfTheWeight(dog));
  attempt(dog.name + ": name of the friend", () => friendName(dog));
  attempt(dog.name + ": speak", () => speak(dog));
  attempt(dog.name + ": size", () => size(dog));
  attempt(dog.name + ": kinds", () => [typeof dog.legs, typeof dog.weight, typeof dog.friend, typeof dog.speak, typeof dog.size]);
  attempt(dog.name + ": keys", () => Object.keys(dog));
}
attempt("total", () => total(dogs));
attempt("a store of a number into the spider's legs", () => {
  dogs[1].legs = 8;
  return [dogs[1].legs + 1, typeof dogs[1].legs, Object.keys(dogs[1])];
});
attempt("legs++ on a fresh spider", () => {
  const list: Dog[] = [];
  const wide: Animal[] = list;
  wide.push(new Spider("web"));
  list[0].legs++;
  return list[0].legs;
});
attempt("weight += on a fresh spider", () => {
  const list: Dog[] = [];
  const wide: Animal[] = list;
  wide.push(new Spider("web"));
  list[0].weight += 1;
  return list[0].weight;
});
