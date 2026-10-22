console.log("copy/dog ran");

export class Dog {
  legs = 4;
  tail = true;
  constructor(public name: string) {}
  bark(): string {
    return this.name + " barks in the copy";
  }
}
