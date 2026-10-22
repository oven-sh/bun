class Gauge {
  reads = 0;
  level(): string {
    return "method";
  }
  get tick(): number {
    this.reads++;
    if (this.reads === 3) this.level = () => "own";
    if (this.reads === 5) Reflect.deleteProperty(this, "level");
    if (this.reads === 7) Gauge.prototype.level = () => "patched";
    if (this.reads === 9) Gauge.prototype.level = original;
    return this.reads;
  }
}

const original = Gauge.prototype.level;

function walk(g: Gauge, rounds: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < rounds; i++) seen.push(g.level() + " " + g.tick + " " + g.level());
  return seen;
}

for (const line of walk(new Gauge(), 10)) console.log("in a function: " + line);

const direct = new Gauge();
for (let i = 0; i < 10; i++) console.log("at the top: " + direct.level() + " " + direct.tick + " " + direct.level());

class Late {
  reads = 0;
  level(): string {
    return "method";
  }
  get tick(): number {
    this.reads++;
    if (this.reads === 2001) this.level = () => "own";
    if (this.reads === 2003) Reflect.deleteProperty(this, "level");
    return this.reads;
  }
}

function walkLate(g: Late, rounds: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < rounds; i++) {
    const before = g.level();
    const at = g.tick;
    seen.push(before + " " + at + " " + g.level());
  }
  return seen;
}

for (const line of walkLate(new Late(), 2004).slice(-6)) console.log("after 2000 rounds: " + line);

class Lengths {
  items: number[] = [1, 2, 3, 4, 5, 6];
  at(i: number): number {
    return this.items[i];
  }
  get length(): number {
    if (this.items[0] === 1) {
      this.items[0] = 0;
      this.at = i => -this.items[i];
    }
    return this.items.length;
  }
}

function total(l: Lengths): string {
  const seen: number[] = [];
  for (let i = 0; i < l.length; i++) seen.push(l.at(i));
  return seen.map(n => (Object.is(n, -0) ? "-0" : String(n))).join(" ");
}

console.log("the getter in the loop's condition: " + total(new Lengths()));

export {};
