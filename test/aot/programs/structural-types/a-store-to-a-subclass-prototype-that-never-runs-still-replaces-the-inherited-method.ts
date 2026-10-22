class Base {
  kept = 0;
  set(value: number): this {
    this.kept = value;
    return this;
  }
  static make(): string {
    return "base make";
  }
  extra?(): number;
}

class Quiet extends Base {}

function put(b: Base): number {
  return b.set(1).kept;
}

console.log("before: " + put(new Quiet()));
if (process.argv.length > 99) {
  Quiet.prototype.set = function (value) {
    this.kept = value + 0.5;
    return this;
  };
}
console.log("the store never ran: " + put(new Quiet()));

export {};
