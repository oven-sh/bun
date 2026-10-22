function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function kind(error: unknown): string {
  return error instanceof ReferenceError ? "a ReferenceError" : error instanceof TypeError ? "a TypeError" : "something else";
}

class Base {
  static count = 0;
  static label = "label of the base";
  static create<T>(this: new () => T): T {
    return new this();
  }
  static bump(): number {
    return ++this.count;
  }
  x = 1;
}

function Tagged(Parent: typeof Base) {
  return class extends Parent {
    static own = "own static";
    tag = "tagged";
  };
}

const Made = Tagged(Base);
console.log("inherited: " + Made.label + " " + Made.count + " own: " + Made.own + " own keys: " + Object.keys(Made).join(" "));
console.log("created: " + describe(Made.create()) + " " + (Made.create() instanceof Made));
console.log("bump: " + Made.bump() + " " + Made.bump() + " base " + Base.count + " made " + Made.count + " own keys: " + Object.keys(Made).join(" "));
console.log("base bump: " + Base.bump() + " made still " + Made.count);
