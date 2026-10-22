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

declare global {
  interface ArrayConstructor {
    range(n: number): number[];
    limit: number;
  }
  interface ObjectConstructor {
    size(value: object): number;
  }
  interface NumberConstructor {
    TAU: number;
    clamp(n: number, low: number, high: number): number;
  }
  interface StringConstructor {
    EMPTY: string;
  }
  interface Math {
    TAU: number;
    half(n: number): number;
  }
  interface JSON {
    version: number;
    clone<T>(value: T): T;
  }
  interface PromiseConstructor {
    delay(ms: number): Promise<void>;
  }
  interface DateConstructor {
    EPOCH: number;
  }
  interface Console {
    level: number;
    shout(text: string): void;
  }
}

function circle(radius: number): number {
  return Math.TAU * radius;
}

function honestCircle(radius: number): number {
  return Math.PI * 2 * radius;
}

show("Array.range", () => Array.range(3));
show("typeof Array.range", () => typeof Array.range);
show("Array.limit", () => [Array.limit, Array.limit + 1]);
show("Object.size", () => Object.size({ a: 1 }));
show("Number.TAU", () => [Number.TAU, Number.TAU * 2, typeof Number.TAU]);
show("Number.clamp", () => Number.clamp(5, 0, 1));
show("String.EMPTY", () => [String.EMPTY, String.EMPTY + "x", String.EMPTY === ""]);
show("the length of String.EMPTY", () => String.EMPTY.length);
show("Math.TAU", () => [Math.TAU, Math.TAU * 2, Math.TAU > 6, typeof Math.TAU]);
show("Math.TAU in a function", () => circle(1));
show("Math.half", () => Math.half(4));
show("JSON.version", () => [JSON.version, JSON.version + 1]);
show("JSON.clone", () => JSON.clone({ a: 1 }));
show("Promise.delay", () => Promise.delay(1));
show("Date.EPOCH", () => [Date.EPOCH, Date.EPOCH + 1]);
show("console.level", () => [console.level, console.level + 1]);
show("console.shout", () => console.shout("x"));
show("in", () => ["TAU" in Math, "PI" in Math, "range" in Array, "from" in Array]);
show("the real ones still work", () => [Array.from({ length: 2 }, (_, i) => i), Number.MAX_SAFE_INTEGER, Math.max(1, 2), JSON.stringify([1]), honestCircle(1) > 6]);

let nans = 0;
for (let i = 0; i < 2000; i++) if (Number.isNaN(circle(i)) && !Number.isNaN(honestCircle(i))) nans++;
show("2000 rounds", () => nans);

export {};
