function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Point {
  x: number = 1;
  y: number = 2;
  same(other: this): boolean {
    return this.x === other.x && this.y === other.y;
  }
  distance(other: this): number {
    return Math.abs(this.x - other.x) + Math.abs(this.y - other.y);
  }
  take(other: this): void {
    this.x = other.x;
  }
}

class Point3 extends Point {
  z: number = 3;
  label: string = "three";
  same(other: this): boolean {
    return super.same(other) && this.z === other.z;
  }
  distance(other: this): number {
    return super.distance(other) + Math.abs(this.z - other.z);
  }
  take(other: this): void {
    super.take(other);
    this.z = other.z;
    this.label = other.label;
  }
}

const flat = new Point();
const deep = new Point3();
const seenAsFlat: Point = deep;

show("flat and flat", () => flat.same(new Point()));
show("deep and deep", () => deep.same(new Point3()));
show("deep, seen as flat, and flat", () => seenAsFlat.same(flat));
show("flat and deep", () => flat.same(deep));
show("distance: deep and deep", () => deep.distance(new Point3()));
show("distance: deep, seen as flat, and flat", () => seenAsFlat.distance(flat));
show("distance: flat and deep", () => flat.distance(deep));

let total = 0;
const other = new Point3();
other.z = 5;
for (let i = 0; i < 2000; i++) total += deep.distance(other);
show("2000 honest distances", () => total);
show("then the base class", () => seenAsFlat.distance(flat));

seenAsFlat.take(flat);
show("after taking from the base class: z", () => deep.z);
show("typeof z", () => typeof deep.z);
show("z + 1", () => deep.z + 1);
show("label", () => deep.label);
show("label length", () => deep.label.length);
show("whole", () => deep);
show("keys", () => Object.keys(deep).join());
deep.take(other);
show("after an honest take", () => deep);
