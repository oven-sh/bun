export declare function get(key: "count"): number;
export declare function get(key: "name"): string;
export declare function get(key: "list"): number[];
export declare function identity<T>(value: T): T;
export declare function first<T>(list: T[]): T;
export declare function mapAll<T, U>(list: T[], f: (item: T, index: number) => U): U[];
export declare function make(kind: "dog"): { legs: number };
export declare function make(kind: "cat"): { lives: number };
export declare function isNumber(value: unknown): value is number;
export declare function assertText(value: unknown): asserts value is string;
export declare function pair<A, B>(a: A, b: B): [A, B];
export declare class Store<K, V> {
  set(key: K, value: V): this;
  get(key: K): V;
  readonly size: number;
}
