interface Pet {
  legs: number;
  sound: string;
}

interface Dog {
  legs: number;
}

class Dog {
  sound = "woof";
}

Dog.prototype.legs = 4;

class Puppy extends Dog {
  sound = "yip";
}

function describe(p: Pet): string {
  return p.legs + " " + p.sound;
}

function listing(p: Pet): string {
  const walked: string[] = [];
  for (const key in p) walked.push(key);
  return Object.keys(p).join() + " | " + walked.join() + " | " + JSON.stringify(p) + " | " + JSON.stringify({ ...p }) + " | " + Object.hasOwn(p, "legs");
}

function lose(p: Pet): number {
  p.legs--;
  return p.legs;
}

const rex = new Dog();
const bit = new Puppy();
const plain: Pet = { legs: 2, sound: "hello" };

console.log("a dog: " + describe(rex) + " / " + listing(rex));
console.log("a puppy: " + describe(bit) + " / " + listing(bit));
console.log("plain: " + describe(plain) + " / " + listing(plain));

console.log("one dog loses a leg: " + lose(rex) + " / " + listing(rex));
console.log("the others keep theirs: " + describe(new Dog()) + ", " + describe(bit));

Dog.prototype.legs = 6;
console.log("the prototype changed: " + describe(rex) + ", " + describe(new Dog()) + ", " + describe(bit));

let total = 0;
for (let i = 0; i < 2000; i++) total += plain.legs + describe(plain).length;
console.log("2000 honest: " + total);
const legsOf = (p: Pet) => p.legs;
for (let i = 0; i < 2000; i++) legsOf(plain);
console.log("then: " + legsOf(new Dog()) + " " + legsOf(bit) + " " + legsOf(rex) + " " + legsOf(plain));

class Kennel {
  pets: Pet[] = [new Dog(), plain, new Puppy()];
  favorite: Pet = new Puppy();
  legs(): number {
    let sum = this.favorite.legs;
    for (const pet of this.pets) sum += pet.legs;
    return sum;
  }
}
console.log("fields and elements: " + new Kennel().legs());

Reflect.deleteProperty(Dog.prototype, "legs");
console.log("the prototype's member deleted: " + describe(new Dog()) + ", " + describe(rex) + ", " + typeof legsOf(bit));
console.log("arithmetic on it: " + (legsOf(bit) + 1) + " " + (legsOf(bit) | 0));

Object.defineProperty(Dog.prototype, "legs", {
  get() {
    return 8;
  },
  configurable: true,
});
console.log("now a getter: " + describe(new Dog()) + ", " + describe(rex));

export {};
