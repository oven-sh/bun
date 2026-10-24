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

class Row {
  id = 7;
  ratio = 0.5;
  title = "row";
  done = false;
  next(): number {
    return this.id + 1;
  }
  half(): number {
    return this.ratio / 2;
  }
  shout(): string {
    return this.title.toUpperCase();
  }
}

function swap<T, K extends keyof T>(target: T, a: K, b: K): void {
  const kept = target[a];
  target[a] = target[b];
  target[b] = kept;
}

function move<T, K extends keyof T>(target: T, from: K, to: K): void {
  target[to] = target[from];
}

function rotate<T, K extends keyof T>(target: T, keys: K[]): void {
  const first = target[keys[0]];
  for (let i = 0; i + 1 < keys.length; i++) target[keys[i]] = target[keys[i + 1]];
  target[keys[keys.length - 1]] = first;
}

function report(title: string, row: Row): void {
  console.log(title + ": " + typeof row.id + " " + show(row.id) + ", " + typeof row.ratio + " " + show(row.ratio) + ", " + typeof row.title + " " + show(row.title) + ", " + typeof row.done + " " + show(row.done) + ", " + JSON.stringify(row));
  attempt("  next", () => row.next());
  attempt("  half", () => row.half());
  attempt("  shout", () => row.shout());
  attempt("  done ? 1 : 2", () => (row.done ? 1 : 2));
  attempt("  !done", () => !row.done);
}

const a = new Row();
report("before", a);
swap(a, "id", "ratio");
report("two numbers change places", a);
swap(a, "id", "title");
report("a number and a string change places", a);
swap(a, "id", "title");
swap(a, "id", "ratio");
report("put back", a);

const b = new Row();
move(b, "title", "id");
report("the title is moved into the id", b);
move(b, "ratio", "title");
report("the ratio is moved into the title", b);
move(b, "done", "ratio");
report("the flag is moved into the ratio", b);

const c = new Row();
rotate(c, ["id", "ratio", "title", "done"]);
report("all four rotate once", c);
rotate(c, ["id", "ratio", "title", "done"]);
report("twice", c);
rotate(c, ["id", "ratio", "title", "done"]);
rotate(c, ["id", "ratio", "title", "done"]);
report("four times", c);

export {};
