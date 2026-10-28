function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

const none: Record<string, number> = {};

function fresh(): Float64Array & Record<string, number> {
  return Object.assign(new Float64Array([0.5, 1.5, 2.5]), none);
}

function read(view: Float64Array & Record<string, number>, key: string): number {
  return view[key];
}

function write(view: Float64Array & Record<string, number>, key: string, value: number): void {
  view[key] = value;
}

function state(view: Float64Array): string {
  return "length " + view.length + ", keys " + Object.keys(view).join("|") + ", values " + Array.from(view).join();
}

let total = 0;
const warm = fresh();
for (let i = 0; i < 2000; i++) {
  write(warm, String(i % 3), i);
  total += read(warm, String(i % 3)) + warm[i % 3];
}
console.log("2000 honest rounds: " + total);

const keys = ["1", "01", "1.0", "+1", " 1", "1e0", "0x1", "-0", "-1", "1.5", "3", "99", "4294967296", "NaN", "Infinity", "-Infinity", "1e21", "1e+21", "0.1", ".1", "", "name"];
for (const key of keys) {
  attempt("read " + show(key), () => {
    const view = fresh();
    return [typeof read(view, key), read(view, key), key in view];
  });
  attempt("write " + show(key), () => {
    const view = fresh();
    write(view, key, 7);
    return [state(view), read(view, key), Object.hasOwn(view, key)];
  });
}

const view = fresh();
view["1"] = 9;
view["01"] = 1;
view["-0"] = 2;
view["1.5"] = 3;
view["NaN"] = 4;
view["3"] = 5;
view["1.0"] = 6;
console.log("written out: after seven stores: " + state(view));
attempt("written out: reads", () => [view["1"], view[1], view["01"], view["-0"], view["1.5"], view["NaN"], view["3"], view["1.0"]]);
attempt("defined as a property", () => [Reflect.defineProperty(fresh(), "-0", { value: 1 }), Reflect.defineProperty(fresh(), "01", { value: 1 }), Reflect.defineProperty(fresh(), "5", { value: 1 }), Reflect.defineProperty(fresh(), "1", { value: 1 })]);
attempt("deleted", () => [Reflect.deleteProperty(fresh(), "1"), Reflect.deleteProperty(fresh(), "5"), Reflect.deleteProperty(fresh(), "-0"), Reflect.deleteProperty(fresh(), "01")]);

export {};
