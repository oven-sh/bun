export interface Point {
  x: number;
  y: number;
}

export class Dog {
  legs = 4;
  name = "rex";
  bark(): number {
    return this.legs * 2;
  }
}

export class Kennel {
  dogs: Dog[] = [];
  at: Point = { x: 0, y: 0 };
  first(): Dog {
    return this.dogs[0];
  }
}

export type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

export enum Color {
  Red,
  Green,
}
