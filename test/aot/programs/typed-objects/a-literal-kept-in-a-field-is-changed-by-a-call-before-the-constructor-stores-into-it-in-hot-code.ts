// A constructor keeps a literal in a field, hands it to a function that changes it in eleven ways, and stores one of the fields that the literal lists.
type Flat = { x: number; y: number };
function show(o: unknown): string {
  if (o === null || typeof o !== "object") return String(o);
  const above = Object.getPrototypeOf(o);
  let all = above === Object.prototype ? "{" : (above?.constructor?.name ?? "none") + "{";
  for (const key of Object.keys(o)) all += key + ":" + show((o as Record<string, unknown>)[key]) + ";";
  return all + "}";
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}
const log: string[] = [];
const names: string[] = JSON.parse('["y","x"]');
function change(o: any, kind: number): void {
  const y = names[0];
  switch (kind) {
    case 1:
      delete o[y];
      break;
    case 2:
      delete o[y];
      Reflect.setPrototypeOf(o, {
        set y(v: number) {
          log.push("set y " + v);
        },
        get y() {
          return 5;
        },
      });
      break;
    case 3:
      Object.freeze(o);
      break;
    case 4:
      Reflect.defineProperty(o, y, {
        get() {
          return 9;
        },
        set(v: number) {
          log.push("own set y " + v);
        },
        configurable: true,
        enumerable: true,
      });
      break;
    case 5:
      Reflect.defineProperty(o, y, { value: 3, writable: false });
      break;
    case 6:
      delete o[y];
      Reflect.setPrototypeOf(o, Object.create(null, { y: { value: 7, writable: false } }));
      break;
    case 7:
      delete o[names[1]];
      o[names[1]] = 1;
      break;
    case 8:
      delete o[y];
      Object.preventExtensions(o);
      break;
    case 9:
      delete o[y];
      Reflect.setPrototypeOf(o, new Point(1, 2));
      break;
    case 10:
      delete o[y];
      o.w = 1;
      break;
    case 11:
      Object.seal(o);
      break;
  }
}
function three(x: number): [Flat, Flat, Flat] {
  return [{ x, y: x + 1 }, new Point(x + 2, x + 3), new Point3(x, x, x)];
}
class Holder {
  inner: Flat;
  tag = "t";
  constructor(x: number, kind: number) {
    this.inner = { x, y: x };
    change(this.inner, kind);
    this.inner.y = x + 1;
  }
  total(): number {
    return this.inner.x + this.inner.y;
  }
}
function run(p: number, kind: number): string {
  const o = three(p)[p % 3];
  o.y += 1;
  const box = new Holder(p * 2, kind);
  return show(o) + show(box) + box.total();
}
for (let round = 0; round < 3; round++) console.log(run(round, 0));
for (let kind = 0; kind < 12; kind++) {
  let line = "";
  try {
    line = run(kind, kind);
  } catch (error) {
    line = "threw " + (error as Error).constructor.name;
  }
  console.log(kind + ": " + line + " | " + log.join());
}
