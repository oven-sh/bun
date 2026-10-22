interface Point {
  x: number;
  y: number;
}

function listings(p: Point): string[] {
  const seen: string[] = [];
  for (const key in p) seen.push(key);
  return [
    "keys " + Object.keys(p).join(),
    "for-in " + seen.join(),
    "json " + JSON.stringify(p),
    "spread " + JSON.stringify({ ...p }),
    "entries " + Object.entries(p).join("|"),
    "values " + Object.values(p).join(),
    "assign " + JSON.stringify(Object.assign({}, p)),
    "names " + Object.getOwnPropertyNames(p).join(),
    "own keys " + Reflect.ownKeys(p).map(String).join(),
    "clone " + JSON.stringify(structuredClone(p)),
    "descriptors " + Object.keys(Object.getOwnPropertyDescriptors(p)).join(),
  ];
}

function print(label: string, p: Point): void {
  for (const line of listings(p)) console.log(label + ": " + line);
}

class Holder {
  constructor(public point: Point) {}
  keys(): string {
    return Object.keys(this.point).join();
  }
  json(): string {
    return JSON.stringify(this.point);
  }
  copy(): Point {
    return { ...this.point };
  }
}

function make(flipped: boolean): Point {
  return flipped ? { y: 20, x: 10 } : { x: 1, y: 2 };
}

const xy: Point = { x: 1, y: 2 };
const yx: Point = { y: 20, x: 10 };
const withExtras = { z: 300, y: 200, w: 400, x: 100 };
const narrowed: Point = withExtras;

print("x then y", xy);
print("y then x", yx);
print("z y w x", narrowed);
print("result, x then y", make(false));
print("result, y then x", make(true));

console.log("local keys: " + Object.keys(yx).join());
console.log("local json: " + JSON.stringify(yx));
console.log("local spread: " + JSON.stringify({ ...yx }));

for (const p of [xy, yx, narrowed]) {
  const holder = new Holder(p);
  console.log("field keys: " + holder.keys());
  console.log("field json: " + holder.json());
  console.log("field copy: " + JSON.stringify(holder.copy()));
  const captured = () => Object.keys(p).join() + " " + JSON.stringify(p);
  console.log("captured: " + captured());
}

const zero = { x: 0 };
const list: Point[] = [xy, yx, narrowed, make(true), make(false)];
console.log("array json: " + JSON.stringify(list));
console.log("array keys: " + list.map(p => Object.keys(p).join("")).join());
console.log("array copies: " + JSON.stringify(list.map(p => ({ ...p }))));
console.log("array with a member replaced: " + JSON.stringify(list.map(p => ({ ...p, x: 0 }))));
console.log("array with a member first: " + JSON.stringify(list.map(p => ({ ...zero, ...p }))));
