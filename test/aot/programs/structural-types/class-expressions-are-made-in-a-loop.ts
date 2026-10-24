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

class Other {
  first = "f";
  second = "s";
  third = "t";
}

const classes: (new () => { index: number })[] = [];
for (let i = 0; i < 6; i++) {
  const Base: new () => object = i % 2 === 0 ? Point : Other;
  classes.push(
    class extends Base {
      index = i;
    },
  );
}

for (const Made of classes) console.log(describe(new Made()));
console.log("all different: " + (new Set(classes).size === classes.length));
let total = 0;
for (let round = 0; round < 2000; round++) total += new classes[round % classes.length]().index;
console.log("2000 constructions: " + total);
for (const Made of classes) console.log("again " + describe(new Made()));
