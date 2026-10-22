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

interface Home {
  pet: Animal;
}

class DogHome implements Home {
  current: Dog = new Dog("first");
  legsSeen: number[] = [];
  tagsSeen: string[] = [];
  get pet(): Dog {
    return this.current;
  }
  set pet(d: Dog) {
    this.legsSeen.push(d.legs);
    this.tagsSeen.push(d.tag);
    this.current = d;
  }
}

class FieldHome implements Home {
  pet: Dog = new Dog("field");
}

function move(home: Home, a: Animal): void {
  home.pet = a;
}

const dogHome = new DogHome();
const fieldHome = new FieldHome();

show("start legs", () => dogHome.pet.legs);
move(dogHome, new Dog("rex"));
show("a dog moved in: legs", () => dogHome.pet.legs);
show("a dog moved in: bark", () => dogHome.pet.bark());
move(dogHome, new Cat("tom"));
show("a cat moved in: legs", () => dogHome.pet.legs);
show("a cat moved in: legs + 1", () => dogHome.pet.legs + 1);
show("a cat moved in: tag", () => dogHome.pet.tag);
show("a cat moved in: owner", () => dogHome.pet.owner);
show("a cat moved in: owner's name", () => dogHome.pet.owner.first);
show("a cat moved in: bark", () => dogHome.pet.bark());
show("a cat moved in: current", () => dogHome.current);
move(dogHome, new Spider("boris"));
show("a spider moved in: legs", () => dogHome.pet.legs);
show("a spider moved in: legs * 2", () => dogHome.pet.legs * 2);
show("a spider moved in: tag length", () => dogHome.pet.tag.length);
show("legs seen", () => dogHome.legsSeen.map(n => typeof n + " " + n).join());
show("tags seen", () => dogHome.tagsSeen.map(s => typeof s + " " + s).join());

show("field: start", () => fieldHome.pet.legs);
move(fieldHome, new Cat("tom"));
show("field: a cat moved in: legs", () => fieldHome.pet.legs);
show("field: a cat moved in: tag", () => fieldHome.pet.tag);
show("field: a cat moved in: tricks", () => fieldHome.pet.tricks);
show("field: a cat moved in: bark", () => fieldHome.pet.bark());
show("field: the store of a dog-only field", () => {
  fieldHome.pet.legs = 2;
  return fieldHome.pet;
});
move(fieldHome, new Dog("back"));
show("field: a dog moved back: legs", () => fieldHome.pet.legs);
show("field: a dog moved back: bark", () => fieldHome.pet.bark());

let sum = 0;
const loopDog = new Dog("loop");
const late = new Cat("late");
for (let i = 0; i < 2000; i++) {
  move(fieldHome, i === 1990 ? late : loopDog);
  const legs = fieldHome.pet.legs;
  sum += legs === undefined ? 1000000 : legs;
}
show("a cat moves in once in 2000 rounds", () => sum);
