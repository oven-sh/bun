function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

const registered: (() => string)[] = [];

class Report {
  factor: number = 10;
  rows: number[] = [1, 2, 3];
  title: string = "report";
  constructor() {
    registered.push(this.heading);
    registered.push(() => this.heading());
  }
  scale(n: number): number {
    return n * this.factor;
  }
  keep(n: number): boolean {
    return n * this.factor > 10;
  }
  add(sum: number, n: number): number {
    return sum + n * this.factor;
  }
  heading(): string {
    return this.title.toUpperCase();
  }
  scaledWrong(): number[] {
    return this.rows.map(this.scale);
  }
  scaledWithThis(): number[] {
    return this.rows.map(this.scale, this);
  }
  scaledByArrow(): number[] {
    return this.rows.map(n => this.scale(n));
  }
  keptWrong(): number[] {
    return this.rows.filter(this.keep);
  }
  keptWithThis(): number[] {
    return this.rows.filter(this.keep, this);
  }
  totalWrong(): number {
    return this.rows.reduce(this.add, 0);
  }
  totalBound(): number {
    return this.rows.reduce(this.add.bind(this), 0);
  }
  localCopy(): number {
    const scale = this.scale;
    return scale(2);
  }
  localPair(): number {
    const { scale, factor } = this;
    return factor + scale(2);
  }
}

const report = new Report();
show("scaledWrong", () => report.scaledWrong().join());
show("scaledWithThis", () => report.scaledWithThis().join());
show("scaledByArrow", () => report.scaledByArrow().join());
show("keptWrong", () => report.keptWrong().join());
show("keptWithThis", () => report.keptWithThis().join());
show("totalWrong", () => report.totalWrong());
show("totalBound", () => report.totalBound());
show("localCopy", () => report.localCopy());
show("localPair", () => report.localPair());
show("registered in the constructor, bare", () => registered[0].call(undefined));
show("registered in the constructor, as an element", () => registered[0]());
show("registered in the constructor, an arrow", () => registered[1]());
report.rows = [];
show("no rows: scaledWrong", () => report.scaledWrong().length);
show("no rows: totalWrong", () => report.totalWrong());
