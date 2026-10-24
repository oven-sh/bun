class Base {
  kept = 0;
  set(value: number): this {
    this.kept = value;
    return this;
  }
}

class Quiet extends Base {}

function put(b: Base): number {
  return b.set(1).kept;
}

console.log("before the store: " + put(new Quiet()));
Quiet.prototype.set = function (value) {
  this.kept = value + 0.5;
  return this;
};
console.log("after the store: " + put(new Quiet()));

export {};
