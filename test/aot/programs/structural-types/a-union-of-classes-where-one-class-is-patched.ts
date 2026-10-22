class Cat {
  kind: "cat" = "cat";
  speak(): string {
    return "meow";
  }
  lives(): number {
    return 9;
  }
}

class Dog {
  kind: "dog" = "dog";
  speak(): string {
    return "woof";
  }
  tricks(): number {
    return 3;
  }
}

type Pet = Cat | Dog;

function speak(p: Pet): string {
  return p.speak();
}

function byTag(p: Pet): string {
  return p.kind === "cat" ? p.speak() + " " + p.lives() : p.speak() + " " + p.tricks();
}

function byClass(p: Pet): string {
  if (p instanceof Cat) return "cat " + p.speak() + " " + p.lives();
  return "dog " + p.speak() + " " + p.tricks();
}

function byMember(p: Pet): string {
  return "lives" in p ? "has lives " + p.lives() : "has tricks " + p.tricks();
}

const pets: Pet[] = [new Cat(), new Dog(), new Cat()];

function round(label: string): void {
  console.log(label + ": " + pets.map(speak).join() + " | " + pets.map(byTag).join() + " | " + pets.map(byClass).join() + " | " + pets.map(byMember).join());
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += speak(pets[i % 3]).length + byTag(pets[i % 3]).length + byClass(pets[i % 3]).length;
console.log("2000 honest: " + warm);
round("before");

const catSpeak = Cat.prototype.speak;
Cat.prototype.speak = () => "purr";
round("the cat's speak replaced");

Cat.prototype.speak = Dog.prototype.speak;
round("the cat speaks with the dog's method");

const lives = Cat.prototype.lives;
Cat.prototype.lives = function () {
  return this.kind.length;
};
round("lives replaced");

pets[2].speak = () => "own";
round("one cat covers speak");

Cat.prototype.speak = catSpeak;
Cat.prototype.lives = lives;
round("the class restored, the own member stays");

Reflect.deleteProperty(pets[2], "speak");
round("all restored");

export {};
