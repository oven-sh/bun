function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Point {
  x = 1;
  y = 2;
}

class Name {
  first = "f";
}

function Tagged(Base: new () => object): new () => { tag: string } {
  return class extends Base {
    tag = "over " + Base.name;
  };
}

function make(Kind: new () => { tag: string }): { tag: string } {
  return new Kind();
}

const A = Tagged(Point);
const B = Tagged(Name);
let letters = 0;
for (let i = 0; i < 2000; i++) letters += make(A).tag.length;
console.log("2000 of one class: " + letters);
console.log(describe(make(A)));
console.log(describe(make(B)));
console.log(describe(make(Tagged(A))));
console.log(describe(make(class { tag = "no base at all"; other = 1; })));
console.log(describe(make(A)));
