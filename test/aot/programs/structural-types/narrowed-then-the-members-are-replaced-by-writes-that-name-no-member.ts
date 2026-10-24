function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
  corner = 90;
}

class Holder {
  shape: Shape = new Square();
  value: number | string = 1;
  leaf: Square | null = new Square();
  mode: "on" | "off" = "on";
}

function put<T, K extends keyof T>(o: T, k: K, v: T[K]): void {
  o[k] = v;
}

type Between = (h: Holder) => void;

const ways: [string, Between][] = [
  ["nothing", () => {}],
  ["Object.assign", h => {
    Object.assign(h, { shape: new Shape(), value: "text", leaf: null, mode: "off" });
  }],
  ["Reflect.set", h => {
    Reflect.set(h, "shape", new Shape());
    Reflect.set(h, "value", "text");
    Reflect.set(h, "leaf", null);
    Reflect.set(h, "mode", "off");
  }],
  ["Object.defineProperty with a value", h => {
    Object.defineProperty(h, "shape", { value: new Shape() });
    Object.defineProperty(h, "value", { value: "text" });
    Object.defineProperty(h, "leaf", { value: null });
    Object.defineProperty(h, "mode", { value: "off" });
  }],
  ["Object.defineProperty with a getter", h => {
    Object.defineProperty(h, "shape", { get: () => new Shape() });
    Object.defineProperty(h, "value", { get: () => "text" });
    Object.defineProperty(h, "leaf", { get: () => null });
    Object.defineProperty(h, "mode", { get: () => "off" });
  }],
  ["a generic store under a key", h => {
    put(h, "shape", new Shape());
    put(h, "value", "text");
    put(h, "leaf", null);
    put(h, "mode", "off");
  }],
  ["a destructuring assignment", h => {
    const source: Holder = { shape: new Shape(), value: "text", leaf: null, mode: "off" };
    ({ shape: h.shape, value: h.value, leaf: h.leaf, mode: h.mode } = source);
  }],
  ["an array pattern", h => {
    [h.shape, h.value, h.leaf] = [new Shape(), "text", null];
    const modes: "off"[] = ["off"];
    for (h.mode of modes) {
    }
  }],
  ["a loop over the keys of another holder", h => {
    const source: Holder = { shape: new Shape(), value: "text", leaf: null, mode: "off" };
    const copy = <K extends keyof Holder>(k: K): void => {
      h[k] = source[k];
    };
    copy("shape");
    copy("value");
    copy("leaf");
    copy("mode");
  }],
];

function read(h: Holder, between: Between): unknown {
  if (h.shape instanceof Square && typeof h.value === "number" && h.leaf !== null && h.mode === "on") {
    between(h);
    return [h.shape.edge, h.shape.corner, h.shape.sides, h.value, h.value + 1, h.value * 2, h.leaf, h.mode, h.mode === "on"];
  }
  return "other";
}

function readALeaf(h: Holder, between: Between): unknown {
  if (h.leaf !== null) {
    between(h);
    return h.leaf.edge;
  }
  return "other";
}

for (let i = 0; i < 2000; i++) {
  read(new Holder(), ways[0][1]);
  readALeaf(new Holder(), ways[0][1]);
}
for (const [name, way] of ways) {
  attempt(name, () => read(new Holder(), way));
  attempt(name + ", a member of what was cleared", () => readALeaf(new Holder(), way));
}
attempt("nothing again", () => read(new Holder(), ways[0][1]));
