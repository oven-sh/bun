function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

interface HasX {
  x: number;
}

class First implements HasX {
  x = 1;
}

class Third implements HasX {
  a = "a";
  b = "b";
  x = 3;
}

class Last implements HasX {
  a = 0.5;
  b = [1];
  c = { n: 1 };
  d = "d";
  e = true;
  x = 6;
}

class Computed implements HasX {
  hidden = 20;
  get x(): number {
    return this.hidden + 1;
  }
  set x(value: number) {
    this.hidden = value;
  }
}

class Inherited extends Third {
  own = "own";
}

class Fraction implements HasX {
  x = 0.5;
}

function Reader(Base: new () => HasX) {
  return class extends Base {
    mine = "mine";
    read(): number {
      return this.x + 1;
    }
    write(value: number): number {
      this.x = value;
      return this.x;
    }
    bump(): number {
      return ++this.x;
    }
  };
}

const bases: (new () => HasX)[] = [First, Third, Last, Computed, Inherited, Fraction];
for (const Base of bases) {
  const made = new (Reader(Base))();
  console.log(Base.name + ": read " + made.read() + " write " + made.write(50) + " bump " + made.bump() + " " + describe(made));
}
const OverFirst = Reader(First);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += new OverFirst().read();
console.log("2000 honest rounds over the first base: " + warm);
for (const Base of bases) console.log(Base.name + " again: " + new (Reader(Base))().read());
