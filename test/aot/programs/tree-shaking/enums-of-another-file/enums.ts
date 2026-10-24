import { Base } from "./base";
export enum Color { Red, Green, Blue }
export enum Direction { Up = "up", Down = "down" }
export enum Size { Small = "s", Large = "l" }
export enum Shape { Circle, Square }
export enum Nobody { Imports = "this" }
export enum Level { Low = Base.Start, High = Base.Start + 10 }
export const enum Inlined { One = 1, Two = 2 }
