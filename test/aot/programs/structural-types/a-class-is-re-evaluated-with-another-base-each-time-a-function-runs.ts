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
  sum(): number {
    return -1;
  }
}

function build(flag: boolean): { sum(): number; extra: string } {
  const Parent: new () => { sum(): number } = flag ? Point : Other;
  class Local extends Parent {
    extra = flag ? "over point" : "over other";
  }
  return new Local();
}

for (const flag of [true, false, true, false]) {
  const made = build(flag);
  console.log(describe(made) + " sum " + made.sum());
}
let warm = 0;
for (let i = 0; i < 2000; i++) warm += build(i % 2 === 0).sum();
console.log("2000 rounds: " + warm);
console.log(describe(build(true)) + " | " + describe(build(false)));
