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

const seen: string[] = [];

class Theme {
  static baseNow(): number {
    return Theme.base;
  }
  static kindsNow(): string {
    return typeof Theme.base + " " + typeof Theme.names + " " + typeof Theme.make + " " + Object.keys(Theme).join();
  }
  static early: number = Theme.baseNow() + 1;
  static earlyCopy: number = Theme.baseNow();
  static earlyKinds: string = Theme.kindsNow();
  static {
    seen.push("in the static block: " + Theme.kindsNow());
  }
  shade: number;
  constructor() {
    this.shade = Theme.base * 2;
  }
  static viaThis(): number {
    return this.base + 1;
  }
}

const first = new Theme();
show("made before the namespace ran: shade", () => first.shade);
show("before: the number", () => [Theme.base, Theme.viaThis()]);
show("before: the list", () => Theme.names);
show("before: the helper called", () => Theme.make());
show("before: keys", () => Object.keys(Theme));

namespace Theme {
  export const base: number = 8;
  export const names: string[] = ["dark", "light"];
  export function make(): Theme {
    return new Theme();
  }
  export interface Options {
    depth: number;
  }
  export enum Mode {
    Dark,
    Light,
  }
}

show("what the static initializers saw", () => [Theme.early, Theme.earlyCopy, Theme.earlyCopy + 1, Theme.earlyKinds]);
show("what the static block saw", () => seen.join());
show("after: the number", () => [Theme.base, Theme.viaThis()]);
show("after: the list", () => Theme.names);
show("after: the helper called", () => Theme.make().shade);
show("after: the enum inside", () => [Theme.Mode.Light, Theme.Mode[0]]);
show("after: keys", () => Object.keys(Theme));
show("the early instance keeps what it got", () => [first.shade, JSON.stringify(first)]);
show("a late instance", () => [new Theme().shade, JSON.stringify(new Theme())]);

class Sub extends Theme {}
show("through a subclass", () => [Sub.base, Sub.viaThis(), Sub.names.length, Object.keys(Sub)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += new Theme().shade + Theme.viaThis();
show("2000 more", () => sum);
