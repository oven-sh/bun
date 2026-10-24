export class Dog {
  legs: number = 4;
  walk(): number {
    return this.legs;
  }
}

export class Puppy extends Dog {
  small: boolean = true;
}
