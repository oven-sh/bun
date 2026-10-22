function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const seen: string[] = [];

class Base {
  set tag(value: string) {
    seen.push("the setter of the base got " + value);
  }
  get tag(): string {
    return "from the getter of the base";
  }
}

function Declares(Parent: new () => Base) {
  return class extends Parent {
    constructor() {
      super();
      this.tag = "stored in the constructor";
    }
  };
}

const stored = new (Declares(Base))();
console.log(describe(stored) + " tag: " + stored.tag + " seen: " + seen.join(", "));
