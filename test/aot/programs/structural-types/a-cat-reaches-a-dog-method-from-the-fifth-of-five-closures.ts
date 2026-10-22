class Person {
  first: string = "ann";
}
class Animal {}
class Dog extends Animal {
  owner: Person = new Person();
}
class Cat extends Animal {}
interface Keeper {
  ownerName(a: Animal): string;
}
const keeper: Keeper = { ownerName: (d: Dog) => d.owner.first };
function tryAll(a: Animal): string {
  let out = "";
  const uses: (() => unknown)[] = [() => 1, () => 2, () => 3, () => 4, () => keeper.ownerName(a)];
  for (const use of uses) {
    try {
      out += String(use()) + ";";
    } catch (error) {
      out += "threw;";
    }
  }
  return out;
}
console.log("cat " + tryAll(new Cat()));
console.log("dog " + tryAll(new Dog()));
