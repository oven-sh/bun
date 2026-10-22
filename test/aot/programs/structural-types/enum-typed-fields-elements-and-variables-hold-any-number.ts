function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

enum Color {
  Red,
  Green,
  Blue,
}

enum Flag {
  Off = 0,
  On = 1,
}

class Pixel {
  color: Color = Color.Red;
  flag: Flag = Flag.Off;
  level: 1 | 2 | 3 = 1;
  read(): string {
    return show(this.color) + " " + show(this.flag) + " " + show(this.level);
  }
  sum(): number {
    return this.color + this.flag + this.level;
  }
  isRed(): boolean {
    return this.color === Color.Red;
  }
}

function paint(p: Pixel, color: Color, flag: Flag): void {
  p.color = color;
  p.flag = flag;
}

function total(colors: Color[]): number {
  let sum = 0;
  for (let i = 0; i < colors.length; i++) sum += colors[i];
  return sum;
}

attempt("honest", () => {
  const p = new Pixel();
  paint(p, Color.Blue, Flag.On);
  return [p.read(), p.sum(), p.isRed(), total([Color.Red, Color.Blue])];
});
let warm = 0;
const busy = new Pixel();
for (let i = 0; i < 2000; i++) {
  const n: number = i % 3;
  paint(busy, n, i & 1);
  warm += busy.sum() + total([n, Color.Green]);
}
console.log("2000 honest rounds", warm);

const numbers: number[] = [3, 255, 256, 65536, -1, -129, 0.5, -0, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483649, 4294967296, 1e21, 5e-324];
for (const n of numbers) {
  attempt("a field holds " + show(n), () => {
    const p = new Pixel();
    paint(p, n, n);
    return [p.read(), p.sum(), p.isRed(), JSON.stringify(p)];
  });
  attempt("an element holds " + show(n), () => {
    const list: Color[] = [Color.Red, Color.Green];
    list[1] = n;
    list.push(n);
    return [list, total(list), list.indexOf(n), list.includes(n)];
  });
  attempt("a local and a captured variable hold " + show(n), () => {
    let c: Color = Color.Red;
    const set = (v: Color) => {
      c = v;
    };
    const get = () => c;
    set(n);
    const local: Color = get();
    return [local, local + 1, local === Color.Red, typeof local];
  });
}

attempt("a literal union is stored to through a wider view", () => {
  const p = new Pixel();
  const open: { level: number } = p;
  const seen: string[] = [];
  for (const n of [1.5, 300, -0, NaN, 2147483648]) {
    open.level = n;
    seen.push(p.read() + "/" + show(p.sum()));
  }
  return seen;
});
attempt("incremented past its members", () => {
  const p = new Pixel();
  for (let i = 0; i < 300; i++) p.color++;
  p.flag--;
  p.flag--;
  return [p.read(), Color[p.color]];
});
attempt("many pixels in a list", () => {
  const pixels: Pixel[] = [];
  for (const n of numbers) {
    const p = new Pixel();
    paint(p, n, Flag.On);
    pixels.push(p);
  }
  return pixels.map(p => p.color);
});
attempt("honest again", () => {
  const p = new Pixel();
  paint(p, Color.Green, Flag.Off);
  return [p.read(), p.sum(), p.isRed()];
});
