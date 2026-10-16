export const KEY: unique symbol = Symbol.for("key");
export const OTHER = Symbol("other");
export const NAME = "name";
export const COUNT = -3;
export const NIL = void 0;
export const NOTHING = null;
export const enum Kind { Leaf, Branch }
export enum Color { Red = "red", Blue = "blue" }
export abstract class Unused { abstract run(): void }
export function used(): number { return COUNT; }
