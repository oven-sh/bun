console.log("dog ran");

export class Dog {
  legs = 4;
  constructor(public name: string) {}
  bark(): string {
    return this.name + " barks";
  }
}

export function adopt(name: string): Dog {
  return new Dog(name);
}
