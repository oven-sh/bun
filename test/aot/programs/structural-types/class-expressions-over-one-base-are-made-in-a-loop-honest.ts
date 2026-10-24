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

const classes: (new () => Point & { index: number })[] = [];
for (let i = 0; i < 6; i++) {
  classes.push(
    class extends Point {
      index = i;
    },
  );
}

for (const Made of classes) console.log(describe(new Made()) + " sum " + new Made().sum());
console.log("all different: " + (new Set(classes).size === classes.length));
let total = 0;
for (let round = 0; round < 2000; round++) total += new classes[round % classes.length]().index;
console.log("2000 constructions: " + total);
