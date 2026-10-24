function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const seen: string[] = [];

class Base {
  made: string;
  constructor() {
    this.made = "for " + new.target.name;
    seen.push("base sees " + new.target.name);
  }
}

function Named(Parent: new () => Base) {
  return class Middle extends Parent {
    middle: string;
    constructor() {
      super();
      this.middle = "for " + new.target.name;
      seen.push("middle sees " + new.target.name);
    }
  };
}

class Top extends Named(Base) {
  top = "top field";
}

console.log(describe(new Top()));
console.log(describe(new (Named(Base))()));
console.log(seen.join(", "));
