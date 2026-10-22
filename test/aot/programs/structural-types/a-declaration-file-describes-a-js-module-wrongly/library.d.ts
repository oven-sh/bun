export declare function count(): number;
export declare function label(): string;
export declare function list(): number[];
export declare function point(): { x: number; y: number };
export declare function step(): (n: number) => number;
export declare function maybe(): number;
export declare const limit: number;
export declare const version: 3;
export declare const names: readonly string[];
export declare let mutable: number;
export declare function spoil(): void;
export declare class Dog {
  legs: number;
  name: string;
  static kinds: number;
  constructor(name: string);
  bark(): number;
  wag(): number;
}
export declare function takes(n: number, s: string): string;
export declare enum Color {
  Red = 0,
  Green = 1,
}
export declare const enum Level {
  Low = 1,
  High = 2,
}
export declare function callBack(f: (n: number) => number): number[];
export default function main(): number;
