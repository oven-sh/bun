declare interface Dictionary<T> {
  [index: string]: T
}

declare interface B {
  foo([]?): void;
  bar({}, []?): any;
  baz(a: string, b: number, []?): void;
}
