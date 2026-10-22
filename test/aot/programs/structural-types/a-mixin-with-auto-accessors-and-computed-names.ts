function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

const computedName = "computed1";

function Fancy(Base: new () => object) {
  return class extends Base {
    accessor level = 1;
    static accessor shared = "shared";
    [computedName] = "under a computed name";
    ["quoted key"] = true;
    7 = "seven";
  };
}

const Made = Fancy(Point);
const made = new Made();
console.log(describe(made));
console.log("level: " + made.level + " own: " + Object.hasOwn(made, "level") + " shared: " + Made.shared);
made.level = 5;
Made.shared = "stored";
console.log("level: " + made.level + " shared: " + Made.shared + " another: " + new Made().level);
