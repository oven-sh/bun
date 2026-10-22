// TypeScript's fields are covariant: an object with `pet: Dog` is also a `{ pet: Animal }`, and through that view any Animal is stored. No cast, no any in the stores.
// Every later look, typed or not, finds the value that was stored.
class Animal {
  title: string = "animal";
}
class Dog extends Animal {
  legs: number = 4;
}
class Cat extends Animal {
  lives: string = "nine";
}
class Puppy extends Dog {
  age: number = 1;
}
class Home {
  pet: Dog = new Dog();
}
class Kennel extends Home {
  size: number = 2;
}
class Shelter {
  pet: Animal = new Dog();
}
interface Keeper {
  pet: Animal;
}
const unseen = eval;

function look(home: Home): string {
  const pet = home.pet;
  return [pet.legs, pet.title, pet instanceof Dog, pet instanceof Cat, Object.keys(pet).join(), Object.keys(home).join(), typeof home.pet.legs].join(" ");
}
function put(keeper: Keeper, animal: Animal): void {
  keeper.pet = animal;
}
function sumOfLegs(homes: Home[]): string {
  let sum = 0;
  let missing = 0;
  for (const home of homes) {
    const legs = home.pet.legs;
    if (legs === undefined) missing++;
    else sum += legs;
  }
  return sum + " " + missing;
}

const first = new Home();
console.log("fresh", look(first));
const wide: { pet: Animal } = first;
wide.pet = new Cat();
console.log("a cat through a literal type", look(first));
first.pet = new Dog();
console.log("a dog again", look(first));
wide.pet = new Puppy();
console.log("a puppy through the view", look(first));
wide.pet = new Animal();
console.log("the base class through the view", look(first));

const second = new Home();
put(second, new Dog());
console.log("a dog through a parameter", look(second));
put(second, new Cat());
console.log("a cat through a parameter", look(second));

const homes: Home[] = [];
for (let i = 0; i < 20; i++) homes.push(new Home());
console.log("twenty homes", sumOfLegs(homes));
for (let i = 0; i < 20; i++) put(homes[i], i === 13 ? new Cat() : new Dog());
console.log("one cat among them", sumOfLegs(homes));

const third = new Home();
const returned: Animal = unseen("x => x")(new Cat());
put(third, returned);
console.log("a cat that unseen code handed back", look(third));

const fourth = new Kennel();
put(fourth, new Cat());
console.log("a subclass of the holder", look(fourth), fourth.size);

const fifth = new Shelter();
put(fifth, new Cat());
console.log("a field of the base class", fifth.pet.title, fifth.pet instanceof Cat, Object.keys(fifth.pet).join());

const sixth = new Home();
unseen("(home, cat) => { home.pet = cat; }")(sixth, new Cat());
console.log("stored by unseen code", look(sixth));

class Box {
  count: number = 1;
  label: string = "one";
}
const box = new Box();
const loose: { count: number | string; label: string | undefined } = box;
loose.count = "two";
loose.label = undefined;
console.log("primitives through a view", box.count + 1, typeof box.count, box.label, typeof box.label, Object.keys(box).join());
box.count = 3;
box.label = "three";
console.log("and back", box.count + 1, typeof box.count, box.label.length);

const literal = { pet: new Dog(), name: "literal" };
const looser: { pet: Animal; name: string } = literal;
looser.pet = new Cat();
console.log("a literal holder", literal.pet.legs, literal.pet.title, literal.name, Object.keys(literal).join());
