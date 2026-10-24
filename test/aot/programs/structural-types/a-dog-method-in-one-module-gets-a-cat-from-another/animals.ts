export class Person {
  first: string;
  constructor(first: string) {
    this.first = first;
  }
}

export class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

export class Dog extends Animal {
  legs: number = 4;
  tag: string = "rex-tag";
  owner: Person = new Person("ann");
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

export class Cat extends Animal {
  lives: string = "nine";
  weight: number = 3.5;
  toys: number[] = [7, 8, 9];
}
