function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

class Point {
  x = 1;
  y = 0.5;
  sum(): number {
    return this.x + this.y;
  }
}

class Sized {
  constructor(
    public width: number,
    public height: number = 2,
  ) {}
  area(): number {
    return this.width * this.height;
  }
}

class Derived extends Sized {
  depth: number;
  constructor(sizes: number[]) {
    super(sizes[0], sizes[1]);
    this.depth = sizes[2];
  }
  volume(): number {
    return this.area() * this.depth;
  }
}

class Initialized {
  static source: number[] = [1];
  first = Initialized.source[0];
  second = Initialized.source[1];
  both(): number {
    return this.first + this.second;
  }
}

function state(o: object): string {
  return JSON.stringify(o) + " " + Object.keys(o).join();
}

function byForOf(): string {
  const p = new Point();
  for (p.x of new Array<number>(2));
  return typeof p.x + " " + show(p.x + 1) + " " + show(p.sum()) + " " + state(p);
}

function byForOfOverAShortList(): string {
  const p = new Point();
  const list = [5, 6];
  list.length = 3;
  for (p.y of list);
  return typeof p.y + " " + show(p.y * 2) + " " + show(p.sum()) + " " + state(p);
}

function byAListPattern(): string {
  const p = new Point();
  const list = [5];
  [p.x, p.y] = list;
  return typeof p.x + " " + typeof p.y + " " + show(p.sum()) + " " + state(p);
}

function byAnObjectPattern(): string {
  const p = new Point();
  const ages: Record<string, number> = { ann: 30 };
  ({ ann: p.x, bob: p.y } = ages);
  return typeof p.x + " " + typeof p.y + " " + show(p.sum()) + " " + state(p);
}

function byParameterProperties(): string {
  const list = [3];
  const s = new Sized(list[0], list[1]);
  const t = new Sized(list[1], list[0]);
  return show(s.area()) + " " + state(s) + " | " + typeof t.width + " " + show(t.area()) + " " + state(t);
}

function bySuper(): string {
  const d = new Derived([2]);
  const e = new Derived([2, 3, 4]);
  return typeof d.height + " " + typeof d.depth + " " + show(d.area()) + " " + show(d.volume()) + " " + state(d) + " | " + show(e.volume());
}

function byInitializers(): string {
  const i = new Initialized();
  return typeof i.first + " " + typeof i.second + " " + show(i.both()) + " " + state(i);
}

function byIncrement(): string {
  const p = new Point();
  const list = [1];
  p.x = list[3];
  p.x++;
  p.y = list[3];
  p.y += 1;
  return show(p.x) + " " + show(p.y) + " " + state(p);
}

function byAChain(): string {
  const p = new Point();
  const q = new Point();
  const list = [1];
  p.x = q.y = list[3];
  return typeof p.x + " " + typeof q.y + " " + show(p.sum()) + " " + show(q.sum());
}

function byAConditional(pick: boolean): string {
  const p = new Point();
  const list = [1];
  p.x = pick ? list[0] : list[3];
  return typeof p.x + " " + show(p.sum());
}

function honest(i: number): number {
  const p = new Point();
  for (p.x of [i, i + 1]);
  [p.x, p.y] = [p.y, p.x];
  return p.sum() + new Sized(i).area() + new Derived([i, 1, 1]).volume();
}

let total = 0;
for (let i = 0; i < 2000; i++) total += honest(i);
console.log("2000 honest rounds: " + total);
console.log("the target of for of over holes: " + byForOf());
console.log("the target of for of over a list made longer: " + byForOfOverAShortList());
console.log("a list pattern: " + byAListPattern());
console.log("an object pattern: " + byAnObjectPattern());
console.log("parameter properties: " + byParameterProperties());
console.log("arguments of super: " + bySuper());
console.log("initializers: " + byInitializers());
console.log("increments: " + byIncrement());
console.log("a chain: " + byAChain());
console.log("a conditional: " + byAConditional(true) + " | " + byAConditional(false));

export {};
