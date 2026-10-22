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

interface Dog {
  roll(times: number): number;
  sit(): string;
  beg(): string;
  weight: number;
}
class Dog {
  legs: number = 4;
  rollTwice(): number {
    return this.roll(1) + this.roll(2);
  }
}

class Puppy extends Dog {
  small: boolean = true;
}

function neverCalled(): void {
  Dog.prototype.roll = function (this: Dog, times: number): number {
    return this.legs * times;
  };
  Dog.prototype.weight = 30;
}

function installIf(wanted: boolean): void {
  if (wanted) {
    Dog.prototype.sit = function (this: Dog): string {
      return "sits on " + this.legs;
    };
  }
}

function installOnPuppies(): void {
  Puppy.prototype.beg = function (this: Dog): string {
    return "begs";
  };
}

function rollOf(dog: Dog, times: number): number {
  return dog.roll(times);
}

const dog = new Dog();
const puppy = new Puppy();
installIf(false);
installOnPuppies();

show("the installer exists", () => typeof neverCalled);
show("stored by a function nobody calls: typeof", () => [typeof dog.roll, typeof puppy.roll]);
show("stored by a function nobody calls: read", () => dog.roll);
show("stored by a function nobody calls: called", () => dog.roll(2));
show("stored by a function nobody calls: through a function", () => rollOf(dog, 2));
show("stored by a function nobody calls: on the subclass", () => rollOf(puppy, 2));
show("stored by a function nobody calls: in a method", () => dog.rollTwice());
show("stored by a function nobody calls: in", () => "roll" in dog);
show("the number stored there", () => [dog.weight, dog.weight + 1, "weight" in dog]);
show("stored behind a condition that was false: typeof", () => typeof dog.sit);
show("stored behind a condition that was false: called", () => dog.sit());
show("stored on the subclass only: the subclass", () => puppy.beg());
show("stored on the subclass only: typeof on the base class", () => typeof dog.beg);
show("stored on the subclass only: the base class", () => dog.beg());
show("names of the prototypes", () => [Object.getOwnPropertyNames(Dog.prototype), Object.getOwnPropertyNames(Puppy.prototype)]);

let failures = 0;
for (let i = 0; i < 2000; i++) {
  try {
    rollOf(i % 2 === 0 ? dog : puppy, i);
  } catch (error) {
    if (error instanceof TypeError) failures++;
  }
}
show("2000 calls", () => failures);

installIf(true);
show("after the condition was true", () => [dog.sit(), puppy.sit()]);
