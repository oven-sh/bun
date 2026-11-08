interface Wrapper<T> { map<R>(f: (value: T, index: number) => R): Wrapper<R>; filter(f: (value: T) => boolean): Wrapper<T>; value(): T[]; }
declare function lodashish<T>(value: T[]): Wrapper<T>;
declare namespace lodashish {
  function get(object: unknown, path: string | string[], fallback?: unknown): any;
  function set<T extends object>(object: T, path: string, value: unknown): T;
  function cloneDeep<T>(value: T): T;
  function merge<T extends object>(target: T, ...sources: object[]): any;
  function isEqual(a: unknown, b: unknown): boolean;
  function groupBy<T>(list: T[], f: ((each: T) => PropertyKey) | keyof T): Record<string, T[]>;
  function pick<T extends object>(object: T, ...keys: string[]): Partial<T>;
  function memoize<A, R>(f: (key: A) => R): ((key: A) => R) & { cache: Map<A, R> };
  function debounce<A extends unknown[]>(f: (...args: A) => void, ms: number): (...args: A) => void;
  function isPlain(value: unknown): boolean;
  const VERSION: string;
  const Wrapper: new (value: unknown) => unknown;
  const loads: number;
}
export = lodashish;
