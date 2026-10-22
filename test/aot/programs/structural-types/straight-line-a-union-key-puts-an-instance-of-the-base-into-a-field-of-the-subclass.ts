class Animal {
  name = "animal";
}

class Dog extends Animal {
  legs = 4;
  bark(): string {
    return this.name + " barks";
  }
}

interface Zoo {
  dog: Dog;
  animal: Animal;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

const yes: boolean = process.argv.length > 0;
const zoo: Zoo = { dog: new Dog(), animal: new Animal() };
console.log(zoo.dog.legs * 2);
set(zoo, yes ? "dog" : "animal", new Animal());
console.log(zoo.dog instanceof Dog);
console.log(typeof zoo.dog.legs);
console.log(zoo.dog.legs * 2);
console.log(zoo.dog.name);
console.log(Object.keys(zoo.dog).join());
console.log(JSON.stringify(zoo));
try {
  console.log(zoo.dog.bark());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
