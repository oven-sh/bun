function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Order {
  id: number;
  note: string;
  lines: { count: number }[];
}

function total(order: Order): number {
  let sum = order.id;
  for (const line of order.lines) sum += line.count;
  return sum;
}

const log: string[] = [];
function logged(this: unknown, key: string, value: unknown): unknown {
  log.push(key + "=" + (typeof value === "object" ? (Array.isArray(value) ? "list" : value === null ? "null" : "object") : String(value)));
  return value;
}

attempt("a reviver that changes nothing", () => {
  log.length = 0;
  const order = JSON.parse<Order>('{"id":1,"note":"n","lines":[{"count":2},{"count":3}]}', logged);
  return [order, total(order), log.join(" ")];
});
attempt("a reviver that turns texts into numbers", () => {
  const order = JSON.parse<Order>('{"id":"7","note":"n","lines":[{"count":"8"}]}', (key, value) => (key === "id" || key === "count" ? Number(value) : value));
  return [order, total(order), typeof order.id];
});
attempt("a reviver that fills in a member", () => {
  const order = JSON.parse<Order>('{"id":1,"lines":[]}', (key, value) => (key === "" ? { ...value, note: "added" } : value));
  return [order, Object.keys(order), order.note.length];
});
attempt("a reviver that removes an undeclared member", () => {
  const order = JSON.parse<Order>('{"id":1,"secret":"x","note":"n","lines":[]}', (key, value) => (key === "secret" ? undefined : value));
  return [order, Object.keys(order), "secret" in order];
});
attempt("a reviver that replaces the whole value", () => {
  const order = JSON.parse<Order>("[1,2,3]", (key, value) => (key === "" ? { id: value.length, note: "from a list", lines: [] } : value));
  return [order, total(order)];
});
attempt("a reviver that returns the same object for every line", () => {
  const shared = { count: 5 };
  const order = JSON.parse<Order>('{"id":0,"note":"","lines":[{"count":1},{"count":2}]}', (key, value) => (typeof value === "object" && value !== null && "count" in value ? shared : value));
  return [order, total(order), order.lines[0] === order.lines[1], order.lines[0] === shared];
});
attempt("a reviver that sees the text of a number", () => {
  const seen: string[] = [];
  const order = JSON.parse<Order>('{"id":1.0,"note":"n","lines":[]}', function (key, value) {
    if (key === "id") seen.push(String(arguments.length), typeof arguments[2]);
    return value;
  });
  return [order.id, seen];
});
attempt("a reviver that throws", () =>
  JSON.parse<Order>('{"id":1,"note":"n","lines":[]}', key => {
    if (key === "note") throw new RangeError("stop");
    return 1;
  }),
);
