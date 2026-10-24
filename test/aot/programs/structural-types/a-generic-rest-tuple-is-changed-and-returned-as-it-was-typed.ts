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

function reversed<T extends unknown[]>(...all: T): T {
  all.reverse();
  return all;
}

function popped<T extends unknown[]>(...all: T): T {
  all.pop();
  return all;
}

function emptied<T extends unknown[]>(...all: T): T {
  all.length = 0;
  return all;
}

function sorted<T extends unknown[]>(...all: T): T {
  all.sort();
  return all;
}

function rotated<T extends unknown[]>(...all: T): T {
  all.push(all.shift());
  return all;
}

function filled<T extends unknown[]>(...all: T): T {
  all.fill(null);
  return all;
}

function untouched<T extends unknown[]>(...all: T): T {
  return all;
}

function inside(...all: [number, string]): string {
  all.reverse();
  const [count, name] = all;
  return typeof count + " " + typeof name + " " + show(count + 1) + " " + show(name + "!");
}

function insideThenAMethod(...all: [number, string]): string {
  all.reverse();
  return all[1].toUpperCase();
}

class Point {
  x = 2;
  twice(): number {
    return this.x * 2;
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const [count, name] = untouched(i, "n");
  total += count + name.length + reversed(i, i)[0];
}
console.log("2000 honest rounds: " + total);

attempt("untouched", () => {
  const [count, name] = untouched(1, "a");
  return [count + 1, name.toUpperCase()];
});
attempt("reversed", () => {
  const [count, name] = reversed(1, "a");
  return [typeof count, typeof name, count + 1, name + "!", name.length];
});
attempt("reversed: a method of the string", () => reversed(1, "a")[1].toUpperCase());
attempt("reversed: a method of the number", () => reversed(1, "a")[0].toFixed(1));
attempt("reversed: a point and a function", () => {
  const [point, run] = reversed(new Point(), () => 5);
  return [typeof point, typeof run, point.x];
});
attempt("reversed: the point's method", () => reversed(new Point(), () => 5)[0].twice());
attempt("reversed: the function is called", () => reversed(new Point(), () => 5)[1]());
attempt("popped", () => {
  const result = popped(1, "a");
  return [result.length, typeof result[1], result[1] + "!", show(result)];
});
attempt("popped: a method", () => popped(1, "a")[1].length);
attempt("emptied", () => {
  const result = emptied(1, 0.5);
  return [result.length, typeof result[0], result[0] + result[1], show(result)];
});
attempt("sorted", () => {
  const result = sorted(10, "1");
  return [typeof result[0], typeof result[1], result[0] + 1];
});
attempt("rotated", () => {
  const result = rotated(1, "a", true);
  return [typeof result[0], typeof result[1], typeof result[2], result[0] + 1, result[2] ? "truthy" : "falsy"];
});
attempt("filled with null", () => {
  const result = filled(1, "a");
  return [typeof result[0], result[0] + 1, result[1] + "!"];
});
attempt("filled with null: a method", () => filled(1, "a")[1].length);
attempt("inside the function", () => inside(1, "a"));
attempt("inside the function: a method", () => insideThenAMethod(1, "a"));
attempt("a tuple that is spread in is not changed", () => {
  const tuple: [number, string] = [1, "a"];
  const result = reversed(...tuple);
  return [show(tuple), show(result), Object.is(tuple, result)];
});

export {};
