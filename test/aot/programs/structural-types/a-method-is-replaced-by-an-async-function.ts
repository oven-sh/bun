const log: string[] = [];

class Store {
  items: string[] = [];
  save(item: string): void {
    this.items.push(item);
    log.push("saved " + item);
  }
  load(): Promise<number> {
    log.push("load");
    return Promise.resolve(this.items.length);
  }
  size(): number | Promise<number> {
    return this.items.length;
  }
  fail(): Promise<string> {
    throw new RangeError("thrown at once");
  }
}

function describe(value: unknown): string {
  return value instanceof Promise ? "a promise" : typeof value + " " + String(value);
}

function saveTo(s: Store, item: string): string {
  const result: unknown = s.save(item);
  return describe(result);
}

function sizeOf(s: Store): string {
  return describe(s.size());
}

async function failOf(s: Store): Promise<string> {
  let made = "nothing";
  try {
    const promise = s.fail();
    made = "a promise came back";
    return made + ", " + (await promise);
  } catch (error) {
    return made + ", caught " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

async function round(label: string, s: Store): Promise<void> {
  console.log(label + ", save: " + saveTo(s, "a"));
  console.log(label + ", size: " + sizeOf(s) + ", awaited " + (await s.size()));
  console.log(label + ", load: " + describe(s.load()) + ", awaited " + (await s.load()));
  console.log(label + ", fail: " + (await failOf(s)));
  await null;
  console.log(label + ", log: " + log.join(", "));
  log.length = 0;
}

const s = new Store();
for (let i = 0; i < 2000; i++) {
  saveTo(s, "w");
  sizeOf(s);
}
s.items.length = 0;
log.length = 0;
await round("methods", s);

s.save = async function (item) {
  await null;
  log.push("saved later " + item);
};
s.size = async () => -1;
s.load = async () => {
  log.push("own load");
  return -2;
};
s.fail = async () => {
  throw new TypeError("rejected");
};
await round("own async functions", s);

for (const name of ["save", "size", "load", "fail"]) Reflect.deleteProperty(s, name);
await round("uncovered", s);

const originalSave = Store.prototype.save;
const originalFail = Store.prototype.fail;
Store.prototype.save = async function (item) {
  this.items.push(item + "!");
  log.push("prototype saved " + item);
};
Store.prototype.fail = async function () {
  return "no failure, " + this.items.length + " items";
};
await round("async functions on the prototype", s);

Store.prototype.save = originalSave;
Store.prototype.fail = originalFail;
await round("put back", s);

export {};
