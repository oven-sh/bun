function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Base {
  n = 1;
  get label(): string {
    return "label " + this.n;
  }
  set label(value: string) {
    this.n = value.length;
  }
}

function Writer(Parent: typeof Base) {
  return class extends Parent {
    extra = "dq";
    write(): string {
      super.label = "four";
      return super.label;
    }
  };
}

const made = new (Writer(Base))();
console.log(describe(made));
console.log(made.write());
console.log(describe(made));
