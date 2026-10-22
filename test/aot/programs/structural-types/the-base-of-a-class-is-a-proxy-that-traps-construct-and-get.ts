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

const seen: string[] = [];
const Wrapped = new Proxy(Point, {
  construct(target, args, newTarget) {
    seen.push("construct for " + newTarget.name);
    return Reflect.construct(target, args, newTarget);
  },
  get(target, key, receiver) {
    seen.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
});

class Derived extends Wrapped {
  extra = "dq";
}

console.log("while defining: " + seen.join(", "));
seen.length = 0;
const made = new Derived();
console.log("while constructing: " + seen.join(", "));
console.log(describe(made) + " " + made.sum() + " " + (made instanceof Point));
