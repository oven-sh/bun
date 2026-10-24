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

interface Line {
  sku: string;
  count: number;
  price: number;
}
interface Order {
  id: number;
  customer: { name: string; vip: boolean };
  lines: Line[];
  note: string | null;
}

function total(order: Order): number {
  let sum = 0;
  for (const line of order.lines) sum += line.count * line.price;
  return order.customer.vip ? sum * 0.9 : sum;
}
function skus(order: Order): string {
  return order.lines.map(line => line.sku).join("+");
}

function textOf(i: number): string {
  return '{"id":' + i + ',"customer":{"name":"c' + (i % 5) + '","vip":' + (i % 2 === 0) + '},"lines":[{"sku":"a","count":' + (i % 3) + ',"price":2.5},{"sku":"b","count":1,"price":' + i + '}],"note":' + (i % 4 === 0 ? "null" : '"n"') + "}";
}

let sum = 0;
let names = 0;
for (let i = 0; i < 2000; i++) {
  const order = JSON.parse<Order>(textOf(i));
  sum += total(order) + order.id;
  names += order.customer.name.length + skus(order).length + (order.note === null ? 0 : order.note.length);
}
attempt("totals", () => [sum, names]);
attempt("one order", () => {
  const order = JSON.parse<Order>(textOf(7));
  return [order, total(order), skus(order), Object.keys(order), JSON.stringify(order) === textOf(7)];
});
