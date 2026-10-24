function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const seen: string[] = [];

class Base {
  ready = "base field";
  constructor() {
    seen.push("base constructor sees " + this.name());
  }
  name(): string {
    return "base";
  }
}

function Named(Parent: new () => Base) {
  return class extends Parent {
    label = "mixin field";
    name(): string {
      return "mixin with label " + this.label + " and ready " + this.ready;
    }
  };
}

const made = new (Named(Base))();
console.log(seen.join(" | "));
console.log(describe(made) + " " + made.name());
