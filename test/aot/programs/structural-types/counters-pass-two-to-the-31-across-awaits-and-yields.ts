function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

async function climbs(start: number, step: number, rounds: number): Promise<string> {
  let n = start;
  const trail: string[] = [];
  for (let i = 0; i < rounds; i++) {
    n += step;
    await null;
    trail.push(text(n));
  }
  return trail.join(", ");
}

async function increments(start: number): Promise<string> {
  let n = start;
  n++;
  await null;
  n++;
  await null;
  n++;
  return text(n) + " " + text(n | 0) + " " + text(n >>> 0);
}

async function multiplies(start: number): Promise<string> {
  let n = start;
  const trail: string[] = [];
  for (let i = 0; i < 4; i++) {
    n *= await Promise.resolve(65536);
    trail.push(text(n));
  }
  return trail.join(", ");
}

async function signs(): Promise<string> {
  let zero = 0;
  await null;
  zero *= -1;
  await null;
  const remainder = -4 % (await Promise.resolve(2));
  const rounded = Math.round(await Promise.resolve(-0.2));
  return [zero, remainder, rounded, zero + 0, 1 / zero].map(text).join(", ");
}

function* climbing(start: number): Generator<number, number, number> {
  let n = start;
  for (let i = 0; i < 4; i++) n += yield n;
  return n;
}

function* dividing(): Generator<number, void, number> {
  let n = 12;
  for (;;) n = n / (yield n);
}

console.log("near the top: " + (await climbs(2147483645, 1, 5)));
console.log("near the bottom: " + (await climbs(-2147483646, -1, 5)));
console.log("a fraction arrives: " + (await climbs(1, 0.5, 3)));
console.log("small: " + (await climbs(1, 1, 3)));
console.log("increments: " + (await increments(2147483646)));
console.log("increments, small: " + (await increments(1)));
console.log("multiplies: " + (await multiplies(3)));
console.log("signs: " + (await signs()));

const c = climbing(2147483646);
console.log("yielded: " + [c.next(0), c.next(1), c.next(1), c.next(-3), c.next(0.5)].map(text).join(" "));

const d = dividing();
console.log("divided: " + [d.next(1), d.next(2), d.next(4), d.next(4), d.next(0), d.next(-1), d.next(Infinity), d.next(-1)].map(r => text(r.value)).join(", "));

let shared = 2147483640;
async function bump(times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    shared++;
    await null;
  }
}
await Promise.all([bump(5), bump(5)]);
console.log("a shared counter: " + text(shared));

class Meter {
  ticks: number = 2147483646;
  async tick(): Promise<number> {
    const before = this.ticks;
    await null;
    this.ticks = before + 1;
    return this.ticks;
  }
}
const meter = new Meter();
console.log("a field: " + [await meter.tick(), await meter.tick(), await meter.tick()].map(text).join(", "));

const cells: number[] = [2147483647, 1, 2];
async function bumpCells(): Promise<void> {
  for (let i = 0; i < cells.length; i++) {
    cells[i] += await Promise.resolve(1);
  }
}
await bumpCells();
console.log("elements: " + text(cells));

export {};
