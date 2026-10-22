interface Runner {
  run(a?: number, b?: number, c?: number): string;
}

class None implements Runner {
  run(): string {
    return "none";
  }
}

class One implements Runner {
  run(a?: number): string {
    return "one " + a;
  }
}

class Two implements Runner {
  run(a?: number, b: number = 20): string {
    return "two " + a + " " + b;
  }
}

class Three implements Runner {
  run(a?: number, b?: number, c?: number): string {
    return "three " + a + " " + b + " " + c;
  }
}

class Rest implements Runner {
  run(...all: (number | undefined)[]): string {
    return "rest " + all.length + " " + all.join();
  }
}

class Counted implements Runner {
  run(a?: number): string {
    return "counted " + arguments.length + " " + a;
  }
}

class Capturing implements Runner {
  run: (a?: number, b?: number) => string = (a, b) => "field of " + this.constructor.name + " " + a + " " + b;
}

abstract class Base {
  abstract run(a?: number, b?: number, c?: number): string;
}

class BelowOne extends Base {
  run(a?: number): string {
    return "below one " + a;
  }
}

class BelowRest extends Base {
  run(...all: (number | undefined)[]): string {
    return "below rest " + all.length;
  }
}

function calls(r: Runner): string {
  const pair: [number, number] = [8, 9];
  return [r.run(), r.run(1), r.run(1, 2), r.run(1, 2, 3), r.run(undefined, 2), r.run(...pair)].join(" | ");
}

function baseCalls(b: Base): string {
  return [b.run(), b.run(1), b.run(1, 2, 3)].join(" | ");
}

const runners: Runner[] = [new None(), new One(), new Two(), new Three(), new Rest(), new Counted(), new Capturing()];
const bases: Base[] = [new BelowOne(), new BelowRest()];

function round(label: string): void {
  for (const r of runners) console.log(label + ", " + r.constructor.name + ": " + calls(r));
  for (const b of bases) console.log(label + ", " + b.constructor.name + ": " + baseCalls(b));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += calls(runners[i % 7]).length + baseCalls(bases[i % 2]).length;
console.log("2000 honest: " + warm);
round("as written");
One.prototype.run = Rest.prototype.run;
Three.prototype.run = None.prototype.run;
None.prototype.run = Counted.prototype.run;
BelowOne.prototype.run = BelowRest.prototype.run;
round("exchanged");

export {};
