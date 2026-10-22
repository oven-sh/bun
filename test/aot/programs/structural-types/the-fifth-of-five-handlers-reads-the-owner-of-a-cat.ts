class Person {
  first: string = "ann";
}
class Animal {}
class Dog extends Animal {
  owner: Person = new Person();
}
class Cat extends Animal {}
interface Handler {
  handle(a: Animal): string;
}
const handlers: Handler[] = [
  { handle: () => "one" },
  { handle: () => "two" },
  { handle: () => "three" },
  { handle: () => "four" },
  { handle: (d: Dog) => d.owner.first },
];
for (const handler of handlers) {
  for (const animal of [new Dog(), new Cat()]) {
    try {
      console.log("gives " + handler.handle(animal));
    } catch (error) {
      console.log("threw");
    }
  }
}
