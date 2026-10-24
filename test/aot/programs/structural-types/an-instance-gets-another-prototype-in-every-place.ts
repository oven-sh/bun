class Cat {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  speak(): string {
    return this.name + " meows";
  }
  get mood(): string {
    return "calm";
  }
}

class Robot {
  name = "robot";
  speak(): string {
    return this.name + " beeps";
  }
  get mood(): string {
    return "none";
  }
}

class Holder {
  constructor(public cat: Cat) {}
  ask(): string {
    return this.cat.speak() + ", " + this.cat.mood;
  }
}

function byParameter(c: Cat): string {
  return c.speak() + ", " + c.mood;
}

function byElement(list: Cat[]): string {
  return list.map(c => c.speak()).join("; ");
}

const changed = new Cat("tom");
const honest = new Cat("kit");
const holder = new Holder(changed);
const list = [honest, changed, honest];
const captured = (): string => changed.speak() + ", " + changed.mood;

function everywhere(label: string): void {
  const local = changed;
  try {
    console.log(label + ", directly: " + changed.speak() + ", " + changed.mood);
    console.log(label + ", a local: " + local.speak() + ", " + local.mood);
    console.log(label + ", a parameter: " + byParameter(changed));
    console.log(label + ", a field: " + holder.ask());
    console.log(label + ", elements: " + byElement(list));
    console.log(label + ", captured: " + captured());
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
  console.log(label + ", the honest one: " + byParameter(honest) + ", instanceof " + (changed instanceof Cat) + " " + (changed instanceof Robot) + ", keys " + Object.keys(changed).join());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += byParameter(changed).length + holder.ask().length + byElement(list).length + captured().length + byParameter(honest).length;
console.log("2000 honest: " + warm);
everywhere("before");

Object.setPrototypeOf(changed, Robot.prototype);
everywhere("a robot's prototype");

Object.setPrototypeOf(changed, Cat.prototype);
everywhere("back");

Object.setPrototypeOf(
  changed,
  Object.create(Cat.prototype, {
    speak: { value: () => "purrs", configurable: true },
  }),
);
everywhere("an object that inherits from the class");

Object.setPrototypeOf(changed, {
  speak(): string {
    return "a literal speaks";
  },
  mood: "a plain member",
});
everywhere("a literal");

Object.setPrototypeOf(changed, honest);
everywhere("another instance as the prototype");

Object.setPrototypeOf(changed, new Proxy(Cat.prototype, {}));
everywhere("a proxy of the class's prototype");

Object.setPrototypeOf(changed, null);
everywhere("nothing");

Object.setPrototypeOf(changed, Cat.prototype);
everywhere("restored");

export {};
