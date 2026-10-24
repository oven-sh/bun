// TypeScript rejects these uses of `super` and `arguments`, JavaScript does not: below a `@ts-ignore` they build and run. Plain Bun refuses the last one, `arguments` in the parameters of a function that a field initializer creates, which the language allows: the output is stored.
class Base { name = "base"; }
class NoBase { describe() {
  // @ts-ignore
  return typeof super.toString;
} }
class InArrow extends Base {
  // @ts-ignore
  constructor() {
    // @ts-ignore
    const initialize = () => super();
    initialize();
  }
}
class InParameter extends Base {
  // @ts-ignore
  constructor(self = super()) {
    console.log(typeof self);
  }
}
class InNestedParameter {
  // @ts-ignore
  make = function (first = arguments.length) { return first; };
}
console.log(new NoBase().describe(), new InArrow().name, new InParameter().name, new InNestedParameter().make());
