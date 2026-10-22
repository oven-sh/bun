import type { Color, Dog, Kennel, Point, Shape } from "./shapes.ts";

export declare function count(kind: "point" | "dog" | "shape" | "color"): number;
export declare function makePoint(i: number): Point;
export declare function makeDog(i: number): Dog;
export declare function makeShape(i: number): Shape;
export declare function makeColor(i: number): Color;
export declare function makeDogs(): Dog[];
export declare const spoilerCount: number;
export declare function spoil(dog: Dog, i: number): void;
export declare function fillKennel(kennel: Kennel): void;
