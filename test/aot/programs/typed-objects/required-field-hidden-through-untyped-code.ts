// A required field of a typed object is made not enumerable through an untyped function. The definition succeeds, and keys, loops, JSON, spreads and copies leave the field out as in plain Bun.
class Point {
  x = 1;
  y = 2;
  label?: string;
  sum(): number {
    return this.x + this.y;
  }
}
interface Row {
  id: number;
  name: string;
  note?: string;
}
function makeRow(id: number): Row {
  return { id, name: "row" + id };
}
function attempt(name: string, run: () => unknown): void {
  try {
    console.log(name + ":", run());
  } catch (error) {
    console.log(name + ":", "throws", (error as Error).name);
  }
}
function define(target: any, key: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, key, descriptor);
}
function describe(target: any, key: string): string {
  const found = Object.getOwnPropertyDescriptor(target, key);
  return found ? [found.value, found.writable, found.enumerable, found.configurable].join("|") : "none";
}
function keysByLoop(target: object): string {
  const keys: string[] = [];
  for (const key in target) keys.push(key);
  return keys.join();
}
function seen(target: Point | Row): string {
  return [
    Object.keys(target).join(),
    keysByLoop(target),
    JSON.stringify(target),
    Object.keys({ ...target }).join(),
    Object.keys(Object.assign({}, target)).join(),
    Object.entries(target).join(";"),
    Object.values(target).join(),
    Object.getOwnPropertyNames(target).join(),
    Reflect.ownKeys(target).join(),
  ].join(" / ");
}

attempt("a hidden field of a class", () => {
  const point = new Point();
  define(point, "x", { enumerable: false });
  return seen(point) + " / " + describe(point, "x") + " / " + point.sum() + " / " + Object.prototype.propertyIsEnumerable.call(point, "x") + " / " + ("x" in point);
});
attempt("a hidden field of a literal", () => {
  const row = makeRow(1);
  define(row, "name", { enumerable: false });
  return seen(row) + " / " + describe(row, "name") + " / " + row.name;
});
attempt("a hidden field is stored to", () => {
  const point = new Point();
  define(point, "y", { enumerable: false });
  point.y = 9;
  return seen(point) + " / " + describe(point, "y") + " / " + point.sum();
});
attempt("a hidden field is shown again", () => {
  const point = new Point();
  define(point, "x", { enumerable: false });
  define(point, "x", { enumerable: true });
  return seen(point) + " / " + describe(point, "x");
});
attempt("hidden and not configurable", () => {
  const point = new Point();
  define(point, "x", { enumerable: false, configurable: false });
  point.x = 3;
  return seen(point) + " / " + describe(point, "x") + " / " + point.sum();
});
attempt("a copy does not inherit the attributes", () => {
  const row = makeRow(6);
  define(row, "id", { enumerable: false, configurable: false });
  const copy = { ...row, id: row.id };
  return seen(copy) + " / " + describe(copy, "id") + " / " + structuredClone(row).name;
});
attempt("one object of many", () => {
  const points = [new Point(), new Point(), new Point()];
  define(points[1], "y", { enumerable: false });
  return points.map((point) => Object.keys(point).join("") + JSON.stringify(point) + point.sum()).join(" ");
});
attempt("in a loop that is hot", () => {
  const point = new Point();
  let total = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) define(point, "x", { enumerable: false });
    total += Object.keys(point).length + point.x;
  }
  return total;
});
attempt("a copy by spread lacks the field", () => {
  const row = makeRow(10);
  define(row, "id", { enumerable: false });
  const copy: Row = { ...row };
  return seen(copy) + " / " + describe(copy, "id") + " / " + copy.id + " / " + copy.name;
});
