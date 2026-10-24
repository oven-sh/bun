// A static generator or accessor named `constructor` is valid JavaScript. TypeScript's errors (1368, 1341) are its own there: below a `@ts-ignore` the program builds and runs as in plain Bun.
class A {
  // @ts-ignore
  static *constructor() { yield 1; }
}
class B {
  // @ts-ignore
  static get constructor() { return 2; }
}
console.log([...A.constructor()], B.constructor);
