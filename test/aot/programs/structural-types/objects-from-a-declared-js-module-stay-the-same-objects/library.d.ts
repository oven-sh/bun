export interface Point {
  x: number;
  y: number;
}
export declare function makePoint(): Point;
export declare function makeWide(): Point;
export declare function makeList(): number[];
export declare function makeLine(): { from: Point; to: Point };
export declare function isLast(value: unknown): boolean;
export declare function lastAsText(): string;
export declare function changeLast(): void;
export declare function identity<T>(value: T): T;
export declare function remember(value: object): void;
export declare function remembers(value: object): boolean;
export declare function scribble(value: Point): void;
export declare class Tracked {
  static all: Tracked[];
  name: string;
  constructor(name: string);
  secret(): number;
  isFirst(): boolean;
}
