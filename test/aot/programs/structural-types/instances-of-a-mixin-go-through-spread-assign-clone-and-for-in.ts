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

function Tagged(Base: new () => object) {
  return class extends Base {
    tag = "tagged";
  };
}

const made = new (Tagged(Point))();
const names: string[] = [];
for (const name in made) names.push(name);
console.log("for-in: " + names.join(" "));
console.log("spread: " + JSON.stringify({ ...made }));
console.log("assign: " + JSON.stringify(Object.assign({}, made)));
console.log("clone: " + JSON.stringify(structuredClone(made)));
console.log("entries: " + Object.entries(made).map(([k, v]) => k + "=" + v).join(" "));
console.log("values: " + Object.values(made).join(" "));
console.log("names: " + Object.getOwnPropertyNames(made).join(" "));
console.log("descriptors: " + Object.keys(Object.getOwnPropertyDescriptors(made)).join(" "));
console.log("has: " + ("x" in made) + " " + Object.hasOwn(made, "x") + " " + Object.hasOwn(made, "tag") + " " + Object.hasOwn(made, "sum"));
