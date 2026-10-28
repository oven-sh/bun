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

declare const flickering: number;

function read(): number {
  return flickering;
}

function plusOne(): number {
  return flickering + 1;
}

function kind(): string {
  return typeof flickering;
}

function state(): string {
  const parts: string[] = [kind()];
  for (const use of [read, plusOne]) {
    try {
      const value = use();
      parts.push(typeof value + " " + String(value));
    } catch (error) {
      parts.push(error instanceof ReferenceError ? "ReferenceError" : "another error");
    }
  }
  return parts.join(", ");
}

show("at first", () => state());
Reflect.set(globalThis, "flickering", 1);
show("a whole number", () => state());
Reflect.set(globalThis, "flickering", 1.5);
show("a fraction", () => state());
Reflect.set(globalThis, "flickering", "text");
show("a string", () => state());
Reflect.set(globalThis, "flickering", undefined);
show("undefined, and there", () => state());
Reflect.set(globalThis, "flickering", null);
show("null", () => state());
Reflect.set(globalThis, "flickering", { valueOf: () => 40 });
show("an object with valueOf", () => state());
Reflect.set(globalThis, "flickering", 10n);
show("a bigint", () => state());
Reflect.deleteProperty(globalThis, "flickering");
show("deleted", () => state());

Reflect.set(globalThis, "flickering", 2);
let sum = 0;
for (let i = 0; i < 2000; i++) sum += read() + plusOne();
show("2000 honest reads", () => sum);

show("in a loop in which it changes", () => {
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    if (i === 2) Reflect.set(globalThis, "flickering", "two");
    if (i === 3) Reflect.deleteProperty(globalThis, "flickering");
    if (i === 5) Reflect.set(globalThis, "flickering", 5);
    seen.push(state());
  }
  return seen;
});

Object.defineProperty(globalThis, "flickering", { value: 9, writable: false, configurable: true });
show("not writable", () => state());
Reflect.deleteProperty(globalThis, "flickering");
show("deleted again", () => state());
