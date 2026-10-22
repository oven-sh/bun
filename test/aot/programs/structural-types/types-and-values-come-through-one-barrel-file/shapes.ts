console.log("shapes ran");

export interface Shape {
  sides: number;
}

export type Name = string;

export class Square implements Shape {
  sides = 4;
}

export enum Color {
  Red,
  Green,
}

export const enum Level {
  Low = 1,
  High = 2,
}

export namespace OnlyTypes {
  export interface Inner {
    depth: number;
  }
}

export namespace WithValues {
  export const depth = 3;
}
