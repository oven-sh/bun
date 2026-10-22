function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare function lateTwice(n: number): number;
declare class LateBox {
  value: number;
  constructor(value: number);
  get(): number;
}
declare namespace LateTools {
  const scale: number;
  function grow(n: number): number;
}
declare enum LateMode {
  Off,
  On,
}
declare const lateFlag: false;

const everything: Record<string, unknown> = globalThis;

function twiceOf(n: number): number {
  return lateTwice(n);
}

function boxValue(n: number): number {
  return new LateBox(n).value;
}

function boxGet(n: number): number {
  return new LateBox(n).get();
}

function scaleOf(): number {
  return LateTools.scale;
}

function onValue(): LateMode {
  return LateMode.On;
}

function flagWord(): string {
  return lateFlag ? "set" : "clear";
}

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value + " " + String(value);
  } catch (error) {
    return error instanceof ReferenceError ? "ReferenceError" : error instanceof TypeError ? "TypeError" : "another error";
  }
}

function all(label: string): void {
  show(label + ": typeof", () => [typeof lateTwice, typeof LateBox, typeof LateTools, typeof LateMode, typeof lateFlag]);
  show(label + ": the function", () => [attempt(() => twiceOf(2)), attempt(() => twiceOf(2) + 1)]);
  show(label + ": the class", () => [attempt(() => boxValue(3)), attempt(() => boxValue(3) + 1), attempt(() => boxGet(3)), attempt(() => boxGet(3) + 1), attempt(() => Object.keys(new LateBox(3)).join())]);
  show(label + ": the namespace", () => [attempt(scaleOf), attempt(() => scaleOf() + 1), attempt(() => LateTools.grow(1))]);
  show(label + ": the enum", () => [attempt(onValue), attempt(() => onValue() + 1), attempt(() => LateMode[1]), attempt(() => LateMode.Off)]);
  show(label + ": the constant typed false", () => [attempt(() => lateFlag), attempt(flagWord)]);
}

all("before");

everything["lateTwice"] = (n: number): number => n * 2;
everything["LateBox"] = class LateBox {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  get(): number {
    return this.value + 1;
  }
};
everything["LateTools"] = { scale: 2, grow: (n: number): number => n + 1 };
everything["LateMode"] = { Off: 0, On: 1, 0: "Off", 1: "On" };
everything["lateFlag"] = false;
all("honest");

let sum = 0;
for (let i = 0; i < 2000; i++) sum += twiceOf(i) + boxValue(i) + boxGet(i) + scaleOf() + onValue() + flagWord().length;
show("2000 honest rounds", () => sum);

everything["lateTwice"] = (n: number): string => "text " + n;
everything["LateBox"] = class Other {
  held: string;
  constructor(value: number) {
    this.held = "held " + value;
  }
  get(): string {
    return this.held;
  }
};
everything["LateTools"] = { scale: "two" };
everything["LateMode"] = { Off: "off", On: "on" };
everything["lateFlag"] = true;
all("other types");

delete everything["lateTwice"];
delete everything["LateBox"];
delete everything["LateTools"];
delete everything["LateMode"];
delete everything["lateFlag"];
all("deleted");

export {};
