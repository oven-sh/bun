function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

const seen: string[] = [];

class Store {
  level = 1;
  constructor() {
    this.level = 2;
  }
}

function Guarded(Base: new () => Store) {
  return class extends Base {
    get doubled(): number {
      seen.push("get doubled");
      return this.level * 2;
    }
    set doubled(value: number) {
      seen.push("set doubled");
      this.level = value / 2;
    }
    static get kind(): string {
      return "guarded kind";
    }
  };
}

const Made = Guarded(Store);
const made = new Made();
console.log(describe(made));
console.log("doubled: " + made.doubled);
made.doubled = 10;
console.log("level: " + made.level + " doubled: " + made.doubled);
console.log("static: " + Made.kind);
console.log("own doubled: " + Object.hasOwn(made, "doubled") + " in: " + ("doubled" in made));
console.log("seen: " + seen.join(", "));
