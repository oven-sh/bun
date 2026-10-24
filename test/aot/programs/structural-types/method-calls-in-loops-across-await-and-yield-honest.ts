class Meter {
  reading = 1;
  read(): number {
    return this.reading;
  }
  each(count: number, visit: (i: number) => void): number[] {
    const seen: number[] = [];
    for (let i = 0; i < count; i++) {
      seen.push(this.read());
      visit(i);
      seen.push(this.read());
    }
    return seen;
  }
  down(n: number): number {
    return n <= 0 ? 0 : this.read() + this.down(n - 1);
  }
  async later(gate: Promise<void>): Promise<string> {
    const before = this.read();
    await gate;
    return before + " -> " + this.read();
  }
  *steps(): Generator<number, number, void> {
    yield this.read();
    yield this.read();
    return this.read();
  }
}

function loop(m: Meter, count: number, visit: (i: number) => void): number[] {
  const seen: number[] = [];
  for (let i = 0; i < count; i++) {
    seen.push(m.read());
    visit(i);
    seen.push(m.read());
  }
  return seen;
}

async function watch(m: Meter, gate: Promise<void>): Promise<string> {
  const before = m.read();
  await gate;
  return before + " -> " + m.read();
}

function* walk(m: Meter, rounds: number): Generator<number, void, void> {
  for (let i = 0; i < rounds; i++) yield m.read();
}

const m = new Meter();
let visits = 0;
console.log("a loop with a callback: " + loop(m, 3, () => visits++).join(" ") + " | " + m.each(3, () => visits++).join(" ") + " | " + visits);
console.log("a long loop: " + loop(m, 2004, () => {}).reduce((a, b) => a + b, 0));
console.log("recursion: " + m.down(5));
console.log("across an await: " + (await watch(m, Promise.resolve())) + " | " + (await m.later(Promise.resolve())));
let letters = 0;
for (let i = 0; i < 2000; i++) letters += (await watch(m, Promise.resolve())).length;
console.log("2000 awaits: " + letters);
console.log("across a yield: " + [...walk(m, 4)].join(" ") + " | " + [...m.steps()].join(" "));
let total = 0;
for (const n of walk(m, 2003)) total += n;
console.log("2003 yields: " + total);
m.reading = 7;
console.log("after a store to the field: " + loop(m, 1, () => {}).join(" ") + " | " + (await watch(m, Promise.resolve())) + " | " + [...walk(m, 2)].join(" "));

export {};
