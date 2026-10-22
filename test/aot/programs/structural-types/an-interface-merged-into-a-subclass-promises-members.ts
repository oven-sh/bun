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

class Animal {
  legs: number = 4;
  walk(): number {
    return this.legs * 2;
  }
}

interface Dog {
  tail: number;
  sound: string;
}
class Dog extends Animal {
  name: string = "rex";
  wag(): number {
    return this.tail + this.legs;
  }
  bark(): string {
    return this.sound + this.name;
  }
}

class Puppy extends Dog {
  small: boolean = true;
  wagFast(): number {
    return this.tail * 2;
  }
}

function tailOf(dog: Dog): number {
  return dog.tail;
}

const dog = new Dog();
show("read", () => [dog.tail, dog.sound]);
show("the members that are made", () => [dog.legs, dog.name, dog.walk()]);
show("in a method", () => [dog.wag(), dog.bark()]);
show("through a function", () => tailOf(dog));
show("keys", () => Object.keys(dog));
show("JSON", () => JSON.stringify(dog));

const puppy = new Puppy();
show("below it: read", () => [puppy.tail, puppy.sound]);
show("below it: in methods", () => [puppy.wag(), puppy.wagFast(), puppy.bark()]);
show("below it: through a function", () => tailOf(puppy));
show("below it: keys", () => Object.keys(puppy));

puppy.tail = 3;
show("stored on the lower one", () => [puppy.tail, puppy.wag(), puppy.wagFast(), Object.keys(puppy)]);
show("the upper one has none", () => [dog.tail, dog.wag(), Object.keys(dog)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += tailOf(puppy);
show("2000 reads where it is", () => sum);
show("then where it is not", () => [tailOf(dog), tailOf(new Puppy())]);

const animals: Animal[] = [dog, puppy, new Animal()];
show("told apart by instanceof", () => animals.map(a => (a instanceof Dog ? a.tail : -1)));
