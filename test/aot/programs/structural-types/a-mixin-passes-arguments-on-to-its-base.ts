function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Base {
  given: string;
  count: number;
  constructor(first: string, ...rest: number[]) {
    this.given = first;
    this.count = rest.length;
  }
}

function Tagged(Parent: new (first: string, ...rest: number[]) => Base) {
  return class extends Parent {
    tag = "tagged";
  };
}

function Fixed(Parent: new (first: string, ...rest: number[]) => Base) {
  return class extends Parent {
    fixed: boolean;
    constructor() {
      super("fixed by the mixin", 1, 2, 3);
      this.fixed = true;
    }
  };
}

console.log(describe(new (Tagged(Base))("one")));
console.log(describe(new (Tagged(Base))("two", 1, 2)));
console.log(describe(new (Fixed(Base))()));
console.log(describe(new (Fixed(Tagged(Base)))()));
