function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Base {
  n = 2;
  twice(): number {
    return this.n * 2;
  }
  get label(): string {
    return "base " + this.n;
  }
  static kind(): string {
    return "base kind";
  }
}

function Louder(Parent: typeof Base) {
  return class extends Parent {
    extra = 1;
    twice(): number {
      return super.twice() + this.extra;
    }
    get label(): string {
      return super.label + " and more";
    }
    static kind(): string {
      return super.kind() + " and more";
    }
  };
}

const Made = Louder(Base);
const made = new Made();
console.log(describe(made));
console.log("twice " + made.twice() + " label [" + made.label + "] kind [" + Made.kind() + "]");
const Twice = Louder(Louder(Base));
console.log("applied twice: " + new Twice().twice() + " [" + new Twice().label + "] [" + Twice.kind() + "] " + describe(new Twice()));
