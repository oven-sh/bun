export {};

declare global {
  interface Array<T> {
    last(): T;
    second: T;
  }
  interface String {
    shout(): string;
  }
  interface Number {
    doubled(): number;
  }
  interface Settings {
    depth: number;
  }
}
