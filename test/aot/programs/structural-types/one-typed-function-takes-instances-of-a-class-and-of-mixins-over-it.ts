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

function Tagged(Base: new () => Point) {
  return class extends Base {
    tag = "tagged";
  };
}

function Moved(Base: new () => Point) {
  return class extends Base {
    x = 100;
    sum(): number {
      return -super.sum();
    }
  };
}

function total(p: Point): number {
  return p.x + p.y + p.sum();
}

const kinds: (new () => Point)[] = [Point, Tagged(Point), Moved(Point), Moved(Tagged(Point)), Tagged(Moved(Point))];
for (const Kind of kinds) console.log(total(new Kind()) + " " + describe(new Kind()));
let warm = 0;
for (let i = 0; i < 2000; i++) warm += total(new Point());
console.log("2000 honest rounds: " + warm);
for (const Kind of kinds) console.log("again " + total(new Kind()));
