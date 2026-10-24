class Animal {
  name = "animal";
}

class Dog extends Animal {
  legs = 4;
}

class Cat extends Animal {
  lives = 9;
}

function isDog(a: Animal): boolean {
  return a instanceof Dog;
}

function legs(a: Animal): string {
  return a instanceof Dog ? typeof a.legs + " " + a.legs : "none";
}

function count(list: Animal[]): number {
  let dogs = 0;
  for (const a of list) if (a instanceof Dog) dogs++;
  return dogs;
}

const list: Animal[] = [new Dog(), new Cat(), new Animal(), new Dog()];

function round(label: string): void {
  console.log(label + ": " + list.map(isDog).join() + " | " + list.map(legs).join() + " | " + count(list) + " | " + (new Dog() instanceof Dog) + " " + (new Cat() instanceof Dog) + " | as animals " + list.map(a => a instanceof Animal).join());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += count(list) + (isDog(list[i % 4]) ? 1 : 0) + legs(list[i % 4]).length;
console.log("2000 honest: " + warm);
round("before");

Object.defineProperty(Dog, Symbol.hasInstance, { value: (value: unknown) => value instanceof Cat, configurable: true });
round("the dog class claims the cats");

Object.defineProperty(Dog, Symbol.hasInstance, { value: () => true, configurable: true });
round("everything");

Object.defineProperty(Dog, Symbol.hasInstance, { value: () => 0, configurable: true });
round("a falsy number");

Object.defineProperty(Dog, Symbol.hasInstance, { value: () => "yes", configurable: true });
round("a truthy string");

Object.defineProperty(Dog, Symbol.hasInstance, { value: undefined, configurable: true });
round("undefined falls back to the chain");

Object.defineProperty(Dog, Symbol.hasInstance, {
  get() {
    return () => false;
  },
  configurable: true,
});
round("a getter that hands out a no");

Reflect.deleteProperty(Dog, Symbol.hasInstance);
round("removed");

Object.defineProperty(Animal, Symbol.hasInstance, { value: () => false, configurable: true });
round("the base class denies everything, and the dog class inherits that");

Reflect.deleteProperty(Animal, Symbol.hasInstance);
round("restored");

export {};
