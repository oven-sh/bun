export {};

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

function Streaming(Base: new () => Point) {
  return class extends Base {
    step = 10;
    async later(): Promise<number> {
      await null;
      return this.x + this.step;
    }
    *each(): Generator<number> {
      yield this.x;
      yield this.y;
      yield this.step;
    }
    async *slowly(): AsyncGenerator<number> {
      yield this.sum();
      yield this.step;
    }
  };
}

const made = new (Streaming(Point))();
console.log(describe(made));
console.log("later: " + (await made.later()));
console.log("each: " + [...made.each()].join(" "));
const slow: number[] = [];
for await (const n of made.slowly()) slow.push(n);
console.log("slowly: " + slow.join(" "));
