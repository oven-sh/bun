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

class Plain {
  n: number = 1;
}
class WithStatic {
  static call(): string {
    return "the static method named call";
  }
  static apply(): string {
    return "the static method named apply";
  }
}

function callFunction(f: Function): unknown {
  return f();
}
function callUnknown(f: unknown): unknown {
  if (typeof f === "function") return f();
  return "not a function";
}
function callByCall(f: Function): unknown {
  return f.call(undefined);
}
function callByApply(f: Function): unknown {
  return f.apply(undefined, []);
}
function callByReflect(f: Function): unknown {
  return Reflect.apply(f, undefined, []);
}
function callBound(f: Function): unknown {
  return f.bind(undefined)();
}
function construct(f: Function): unknown {
  return Reflect.construct(f, []);
}

function seven(): number {
  return 7;
}
const arrow = (): number => 8;
async function later(): Promise<number> {
  return 9;
}
function* steps(): Generator<number> {
  yield 1;
}
const method = {
  m(): number {
    return 10;
  },
}.m;

const values: [string, Function][] = [
  ["function", seven],
  ["arrow", arrow],
  ["class", Plain],
  ["class with statics", WithStatic],
  ["async function", later],
  ["generator function", steps],
  ["method", method],
  ["bound function", seven.bind(null)],
  ["bound class", Plain.bind(null)],
  ["Map", Map],
  ["Promise", Promise],
  ["Symbol", Symbol],
  ["Number", Number],
  ["proxy of a function", new Proxy(seven, {})],
  ["proxy of a class", new Proxy(Plain, {})],
  ["function again", seven],
];

function short(value: unknown): string {
  if (typeof value === "object" && value !== null) return "object " + Object.prototype.toString.call(value);
  if (typeof value === "symbol") return "symbol";
  return typeof value + " " + String(value);
}

for (const [label, f] of values) {
  show(label + " called", () => short(callFunction(f)));
  show(label + " called after typeof", () => short(callUnknown(f)));
  show(label + " by call", () => short(callByCall(f)));
  show(label + " by apply", () => short(callByApply(f)));
  show(label + " by Reflect.apply", () => short(callByReflect(f)));
  show(label + " bound", () => short(callBound(f)));
  show(label + " constructed", () => short(construct(f)));
}
show("not a function", () => callUnknown(5));
show("an object with call", () => callUnknown({ call: () => 1 }));
