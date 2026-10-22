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
  sound(): string {
    return "...";
  }
}

class Dog extends Animal {
  tricks: number = 3;
  sound(): string {
    return "woof";
  }
  fetch(): string {
    return "fetched " + this.tricks;
  }
}

class Cat extends Animal {
  lives: number = 9;
  sound(): string {
    return "meow";
  }
}

class Kennel {
  guest: Animal = new Cat();
  admit(guest: Animal): void {
    this.guest = guest;
  }
}

class DogKennel extends Kennel {
  declare guest: Dog;
  play(): string {
    return this.guest.fetch();
  }
  tricks(): number {
    return this.guest.tricks + 1;
  }
}

function guestTricks(kennel: DogKennel): number {
  return kennel.guest.tricks;
}

function all(label: string, kennel: DogKennel): void {
  show(label + ": who", () => kennel.guest.constructor.name);
  show(label + ": sound", () => kennel.guest.sound());
  show(label + ": tricks", () => guestTricks(kennel));
  show(label + ": tricks plus one", () => kennel.tricks());
  show(label + ": play", () => kennel.play());
  show(label + ": keys of the guest", () => Object.keys(kennel.guest));
  show(label + ": instanceof", () => kennel.guest instanceof Dog);
}

all("as the base class made it", new DogKennel());

const kennel = new DogKennel();
kennel.guest = new Dog();
all("after an honest store", kennel);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += guestTricks(kennel) + kennel.tricks() + kennel.play().length;
show("2000 honest rounds", () => sum);

kennel.admit(new Cat());
all("after the base class admitted a cat", kennel);
kennel.admit(new Animal());
all("after the base class admitted an animal", kennel);
kennel.admit(new Dog());
all("after the base class admitted a dog", kennel);
