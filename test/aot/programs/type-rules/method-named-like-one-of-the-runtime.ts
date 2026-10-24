// What a program does may not depend on what its methods are called. Both pairs of classes are the same but for the name of one method,
// and the modules that the runtime itself is written in have methods of the first name.
let seen: number = 0;
class Base { constructor() { seen = this.peek(); } peek(): number { return 1; } }
class Derived extends Base { n: number = 3; peek(): number { return this.n; } }
new Derived();
console.log(typeof seen, seen + 1);
let seenToo: number = 0;
class BaseToo { constructor() { seenToo = this.peekAtTheField(); } peekAtTheField(): number { return 1; } }
class DerivedToo extends BaseToo { n: number = 3; peekAtTheField(): number { return this.n; } }
new DerivedToo();
console.log(typeof seenToo, seenToo + 1);
