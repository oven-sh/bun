// A static generator or accessor named `constructor` is valid JavaScript. TypeScript reports it (1368, 1341), and the build accepts it.
class A { static *constructor() { yield 1; } }
class B { static get constructor() { return 2; } }
class C {
  static stored = 0;
  static set constructor(value) { C.stored = value; }
}
console.log([...A.constructor()], B.constructor);
C.constructor = 3;
console.log(C.stored, C.constructor);
console.log(new A().constructor === A, new B().constructor === B, new C().constructor === C);
