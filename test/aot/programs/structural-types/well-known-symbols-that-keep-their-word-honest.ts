class Animal {
  name = "animal";
}

class Dog extends Animal {
  legs = 4;
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives = 9;
}

class Money {
  constructor(public amount: number) {}
  [Symbol.toPrimitive](hint: string): string | number {
    return hint === "string" ? "$" + this.amount : this.amount;
  }
}

class Bag {
  items: number[];
  constructor(...items: number[]) {
    this.items = items;
  }
  *[Symbol.iterator](): Generator<number, void, unknown> {
    yield* this.items;
  }
}

class Stack extends Array<number> {}

function legs(a: Animal): string {
  return a instanceof Dog ? "dog " + a.legs + " " + a.bark() : "no dog: " + a.name;
}

function countDogs(list: Animal[]): number {
  let dogs = 0;
  for (const a of list) if (a instanceof Dog) dogs++;
  return dogs;
}

function text(m: Money): string {
  return `${m}` + " " + ("" + m) + " " + +m;
}

function sumOfBag(b: Bag): number {
  let total = 0;
  for (const n of b) total += n;
  return total;
}

function sumOfList(list: number[]): number {
  let total = 0;
  for (const n of list) total += n;
  return total;
}

function copy(list: number[]): number[] {
  return list.map(n => n * 2).concat([1]).slice(0, 3);
}

const animals: Animal[] = [new Dog(), new Cat(), new Animal(), new Dog()];
const stack = new Stack();
stack.push(1, 2, 3);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += legs(animals[i % 4]).length + countDogs(animals) + text(new Money(i)).length + sumOfBag(new Bag(1, 2, i)) + sumOfList([1, 2, i]) + copy([i, 1]).length;
console.log("2000 rounds: " + warm);
console.log("instanceof: " + animals.map(legs).join(" | ") + " | " + countDogs(animals));
console.log("to a primitive: " + text(new Money(5)));
console.log("iteration: " + sumOfBag(new Bag(1, 2, 3)) + " " + [...new Bag(4, 5)].join() + " " + sumOfList([1, 2, 3]) + " " + Math.max(...[1, 2, 3]));
console.log("what the array methods make: " + copy([1, 2, 3]).join() + " " + copy([1, 2, 3]).constructor.name + " | " + copy(stack).join() + " " + copy(stack).constructor.name);

export {};
