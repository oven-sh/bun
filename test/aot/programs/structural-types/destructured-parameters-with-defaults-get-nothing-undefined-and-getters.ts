function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];
function effect<T>(label: string, value: T): T {
  log.push(label);
  return value;
}

function attempt(label: string, run: () => unknown): void {
  log = [];
  let outcome: string;
  try {
    outcome = text(run());
  } catch (error) {
    outcome = failure(error);
  }
  console.log(label + ": " + outcome + (log.length ? " [" + log.join(", ") + "]" : ""));
}

interface Box {
  width?: number;
  height?: number;
  label?: string | null;
}

function area({ width = effect("default width", 1), height = effect("default height", width * 2), label = "none" }: Box = effect("default box", {})): string {
  return text(width) + " x " + text(height) + " " + text(label);
}

attempt("area()", () => area());
attempt("area(undefined)", () => area(undefined));
attempt("area({})", () => area({}));
attempt("area({ width: 3 })", () => area({ width: 3 }));
attempt("area({ width: undefined })", () => area({ width: undefined }));
attempt("area({ height: 5 })", () => area({ height: 5 }));
attempt("area({ label: null })", () => area({ label: null }));
attempt("area({ width: 0, height: -0 })", () => area({ width: 0, height: -0 }));

class Watched implements Box {
  get height(): number | undefined {
    return effect("get height", undefined);
  }
  get width(): number {
    return effect("get width", 4);
  }
  get label(): string {
    return effect("get label", "watched");
  }
}
attempt("getters are read in the order of the pattern", () => area(new Watched()));
attempt("members on the prototype", () => area(Object.create({ width: 7 })));

const extras = { width: 2, height: 3, depth: 4 };
attempt("more members than the type", () => area(extras));

function rest({ width, ...others }: Box & { depth?: number }): string {
  return text(width) + " others " + text(others) + " keys " + Object.keys(others).join();
}
attempt("a rest in the pattern takes the extras too", () => rest(extras));
attempt("a rest over getters", () => rest(new Watched()));

function pair([a = effect("default a", 1), b = effect("default b", a + 1)]: [number?, number?] = []): string {
  return text(a) + ", " + text(b);
}
attempt("pair()", () => pair());
attempt("pair([])", () => pair([]));
attempt("pair([5])", () => pair([5]));
attempt("pair([undefined, 5])", () => pair([undefined, 5]));
attempt("pair([, 5])", () => pair([, 5]));

function nested({ inner: { deep = effect("default deep", 1) } = effect("default inner", {}) }: { inner?: { deep?: number } } = {}): string {
  return text(deep);
}
attempt("nested()", () => nested());
attempt("nested({})", () => nested({}));
attempt("nested({ inner: {} })", () => nested({ inner: {} }));
attempt("nested({ inner: { deep: 9 } })", () => nested({ inner: { deep: 9 } }));

function required({ width }: { width: number }): string {
  return text(width);
}
const looseRequired: (box?: { width: number }) => string = (box = { width: -1 }) => required(box);
attempt("a wrapper gives the default", () => looseRequired());
interface Takes {
  take(box?: { width: number }): string;
}
const takes: Takes = {
  take({ width }: { width: number }): string {
    return text(width);
  },
};
attempt("a pattern gets nothing through a method type", () => takes.take());
attempt("the same, given", () => takes.take({ width: 1 }));

function computed({ [effect("key", "width")]: value = effect("default", 0) }: Box): string {
  return text(value);
}
attempt("a computed key in the pattern", () => computed({ width: 6 }));
attempt("a computed key, absent", () => computed({}));

let warm = 0;
for (let i = 0; i < 2000; i++) warm += area({ width: i & 3, height: 2 }).length;
log = [];
console.log("2000 honest calls: " + warm);
attempt("area() after them", () => area());
