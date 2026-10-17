// One site reads, stores or adds a property that the type of the object does not declare, over and over: whatever the site has learnt from the objects before, the next object may differ.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
const show = (label: string, value: unknown) => console.log(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));

class Request {
  url: unknown = "/";
  method: unknown = "GET";
  next: Request | null = null;
  complete: unknown = false;
  describe(): string {
    return "Request " + this.url;
  }
}
class Upgrade extends Request {
  protocol: unknown = "ws";
}
class Full {
  a: unknown = 1;
  b: unknown = 2;
}
interface Point {
  x: number;
  y: number;
}
interface Shape {
  kind: string;
  size: number;
}
function Made(this: Shape, size: number) {
  this.kind = "made";
  this.size = size;
}
Made.prototype.area = function (this: Shape) {
  return this.size * this.size;
};

const makers: [string, () => any][] = [
  ["Request", () => new Request()],
  ["Upgrade", () => new Upgrade()],
  ["Full", () => new Full()],
  ["Point", (): Point => ({ x: 1, y: 2 })],
  ["Made", () => new (Made as any)(3)],
  ["plain", () => ({ plain: true })],
];

function addThree(object: any, value: unknown) {
  object.params = value;
  object.query = value;
  object.route = value;
}
function addTen(object: any, value: unknown) {
  object.res = value;
  object.nextStep = value;
  object.baseUrl = value;
  object.originalUrl = value;
  object.parsedUrl = value;
  object.params = value;
  object.query = value;
  object.route = value;
  object.body = value;
  object.cookies = value;
}
function readParams(object: any): unknown {
  return object.params;
}
function storeParams(object: any, value: unknown) {
  object.params = value;
}
function hasParams(object: any): boolean {
  return "params" in object;
}
function callDescribe(object: any): unknown {
  return typeof object.describe === "function" ? object.describe() : "no method";
}
function attempt(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

console.log("== the same three, object after object");
for (const [label, make] of makers) {
  let sum = 0;
  let last: any = null;
  for (let i = 0; i < 300; i++) {
    const object = make();
    addThree(object, i);
    sum += object.params + object.query + object.route + (readParams(object) as number);
    last = object;
  }
  show(label, [sum, Object.keys(last).slice(-3), JSON.stringify(last)]);
}

console.log("== ten, which is more than is kept at hand");
for (const [label, make] of makers) {
  let sum = 0;
  let last: any = null;
  for (let i = 0; i < 300; i++) {
    const object = make();
    addTen(object, i);
    sum += object.res + object.cookies + object.parsedUrl + (readParams(object) as number);
    last = object;
  }
  show(label, [sum, Object.keys(last).slice(-10).join()]);
}

console.log("== in another order the keys are in another order");
for (const [label, make] of makers) {
  const first = make();
  addThree(first, 1);
  const second = make();
  second.route = 2;
  addThree(second, 3);
  const third = make();
  third.query = 4;
  third.other = 5;
  addThree(third, 6);
  show(label, [Object.keys(first).slice(-3), Object.keys(second).slice(-3), Object.keys(third).slice(-4), third.other]);
}

console.log("== an object that takes no more");
function closed(level: number): unknown[] {
  const results: unknown[] = [];
  for (let i = 0; i < 6; i++) {
    const point: Point = { x: i, y: i };
    if (i === 3 || i === 4) {
      if (i === 4) (point as any).params = "before";
      if (level === 0) Object.preventExtensions(point);
      else if (level === 1) Object.seal(point);
      else Object.freeze(point);
    }
    results.push(attempt(() => (addThree(point, i), "added")), Object.keys(point).length, String(readParams(point)));
  }
  return results;
}
show("not extensible", closed(0));
show("sealed", closed(1));
show("frozen", closed(2));

console.log("== read where it is, is not, was, and is computed");
for (const [label, make] of makers) {
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    const object = make();
    seen.push(String(readParams(object)) + hasParams(object));
    if (i % 2) storeParams(object, i);
    seen.push(String(readParams(object)) + hasParams(object));
    if (i % 4 === 3) delete object.params;
    seen.push(String(readParams(object)) + hasParams(object));
    if (i % 8 === 5) Object.defineProperty(object, "params", { get: () => "got " + i, configurable: true });
    seen.push(String(readParams(object)) + hasParams(object));
    if (i % 8 === 1) Object.defineProperty(object, "params", { value: "fixed " + i, writable: false, configurable: true });
    seen.push(String(attempt(() => (storeParams(object, "again"), readParams(object)))));
  }
  show(label, seen.slice(-45).join(" "));
}

console.log("== a setter among them");
for (const [label, make] of makers) {
  const results: unknown[] = [];
  for (let i = 0; i < 8; i++) {
    const object = make();
    if (i >= 4) {
      Object.defineProperty(object, "params", {
        get() {
          return this.held;
        },
        set(value) {
          this.held = "set " + value;
        },
        enumerable: true,
        configurable: true,
      });
    }
    storeParams(object, i);
    results.push(readParams(object), Object.keys(object).slice(-2).join());
  }
  show(label, results);
}

console.log("== the prototype of a function gets a setter, a value, and loses them");
{
  const results: unknown[] = [];
  const step = () => {
    const object = new (Made as any)(2);
    const read = String(readParams(object));
    storeParams(object, "stored");
    results.push(read, String(readParams(object)), Object.hasOwn(object, "params"), String(object.caught));
  };
  step();
  step();
  step();
  Object.defineProperty(Made.prototype, "params", {
    set(value) {
      this.caught = value;
    },
    get() {
      return "from the prototype";
    },
    configurable: true,
  });
  step();
  step();
  delete (Made.prototype as any).params;
  step();
  step();
  (Made.prototype as any).params = "a value above";
  step();
  step();
  Object.defineProperty(Made.prototype, "params", { value: "read only above", writable: false, configurable: true });
  results.push(attempt(() => (step(), "went on")));
  delete (Made.prototype as any).params;
  step();
  show("Made", results);
}

console.log("== what is inherited, with and without them");
for (const [label, make] of makers) {
  const results: unknown[] = [];
  for (let i = 0; i < 6; i++) {
    const object = make();
    if (i % 2) addThree(object, i);
    results.push(callDescribe(object), typeof object.toString, String(object.missing), typeof object.area === "function" ? object.area() : "-");
    if (i === 4) {
      object.toString = () => "own toString";
      results.push(String(object));
    }
  }
  show(label, results);
}

console.log("== old objects, young values");
for (const [label, make] of makers) {
  const old: any[] = [];
  for (let i = 0; i < 20; i++) old.push(make());
  collect(true);
  collect(true);
  for (let i = 0; i < old.length; i++) addThree(old[i], { number: i });
  collect(false);
  for (let i = 0; i < old.length; i++) storeParams(old[i], { number: i * 2, before: old[i].params });
  collect(false);
  for (let i = 0; i < old.length; i++) addTen(old[i], { number: i * 3, before: old[i].params });
  collect(false);
  collect(true);
  let sum = 0;
  for (const object of old) sum += object.params.number + object.params.before.number + object.params.before.before.number + object.cookies.number + object.route.number;
  show(label, sum);
}

console.log("== while the collector runs");
for (const [label, make] of makers) {
  const kept: any[] = [];
  for (let round = 0; round < 30; round++) {
    for (let i = 0; i < 400; i++) {
      const object = make();
      addThree(object, { round, i });
      if (i % 3 === 0) addTen(object, [round, i]);
      if (i % 100 === 7) kept.push(object);
    }
    if (round % 10 === 9) collect(round === 19);
  }
  let sum = 0;
  for (const object of kept) sum += Array.isArray(object.params) ? object.params[0] + object.cookies[1] : object.params.round + object.route.i;
  show(label, [kept.length, sum]);
}

console.log("== as a prototype");
for (const [label, make] of makers) {
  const results: unknown[] = [];
  const parent = make();
  const heir = Object.create(parent);
  for (let i = 0; i < 3; i++) results.push(String(readParams(heir)), hasParams(heir));
  storeParams(parent, "of the parent");
  for (let i = 0; i < 3; i++) results.push(String(readParams(heir)), hasParams(heir));
  delete parent.params;
  results.push(String(readParams(heir)), hasParams(heir));
  storeParams(parent, "again");
  storeParams(heir, "own");
  results.push(String(readParams(heir)), String(readParams(parent)));
  show(label, results);
}

console.log("== copies have them, and are their own");
for (const [label, make] of makers) {
  const object = make();
  addThree(object, 1);
  const copy = { ...object };
  const assigned = Object.assign(make(), object);
  storeParams(object, 2);
  show(label, [copy.params, assigned.params, object.params, Object.keys(assigned).slice(-3)]);
}
