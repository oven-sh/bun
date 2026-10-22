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

class Dog {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

function numberOrText(change: boolean): number {
  let v: number | string = 1;
  const spoil = () => {
    v = "text";
  };
  if (typeof v === "number") {
    if (change) spoil();
    return v + 1;
  }
  return -1;
}

function dogOrNull(change: boolean): number {
  let d: Dog | null = new Dog();
  const clear = () => {
    d = null;
  };
  if (d !== null) {
    if (change) clear();
    return d.legs;
  }
  return -1;
}

function dogOrNullCalled(change: boolean): number {
  let d: Dog | null = new Dog();
  const clear = () => {
    d = null;
  };
  if (d) {
    if (change) clear();
    return d.bark();
  }
  return -1;
}

function listOrNothing(change: boolean): number {
  let list: number[] | undefined = [1, 2, 3];
  const drop = () => {
    list = undefined;
  };
  if (list !== undefined) {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      if (change && i === 1) drop();
      sum += list[i];
    }
    return sum;
  }
  return -1;
}

function functionOrNothing(change: boolean): number {
  let f: (() => number) | undefined = () => 5;
  const drop = () => {
    f = undefined;
  };
  if (f) {
    if (change) drop();
    return f() + 1;
  }
  return -1;
}

function assignedLater(read: boolean): number {
  let n: number;
  const peek = () => n + 1;
  const early = read ? peek() : 0;
  n = 1;
  return early + peek();
}

let moduleValue: number | string = 1;
function spoilModule(): void {
  moduleValue = "module text";
}
function readModule(change: boolean): number {
  moduleValue = 1;
  if (typeof moduleValue === "number") {
    if (change) spoilModule();
    return moduleValue + 1;
  }
  return -1;
}

function everything(label: string, change: boolean): void {
  attempt(label + " number or text", () => numberOrText(change));
  attempt(label + " dog or null: field", () => dogOrNull(change));
  attempt(label + " dog or null: method", () => dogOrNullCalled(change));
  attempt(label + " list or nothing", () => listOrNothing(change));
  attempt(label + " function or nothing", () => functionOrNothing(change));
  attempt(label + " assigned later", () => assignedLater(change));
  attempt(label + " module variable", () => readModule(change));
}

everything("honest", false);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += numberOrText(false) + dogOrNull(false) + dogOrNullCalled(false) + listOrNothing(false) + functionOrNothing(false) + assignedLater(false) + readModule(false);
console.log("2000 honest rounds", warm);
everything("changed", true);
everything("honest again", false);
