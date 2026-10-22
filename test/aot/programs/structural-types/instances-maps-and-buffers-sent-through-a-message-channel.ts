function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

class Order {
  id = 7;
  lines: { item: string; count: number }[] = [{ item: "pen", count: 2 }];
  placed = new Date(86400000);
  notes = new Map<string, string>([["gift", "yes"]]);
  total(): number {
    let sum = 0;
    for (const line of this.lines) sum += line.count;
    return sum;
  }
}

function send<T>(value: T, transfer: ArrayBuffer[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = event => {
      port1.close();
      port2.close();
      resolve(event.data);
    };
    try {
      port1.postMessage(value, transfer);
    } catch (error) {
      port1.close();
      port2.close();
      reject(error);
    }
  });
}

function count(order: Order): number {
  return order.lines[0].count + order.id;
}

function total(order: Order): number {
  return order.total();
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += count(new Order()) + total(new Order());
console.log("after 2000 honest orders", warm);

const source = new Order();
const arrived = await send(source);
attempt("fields", () => [count(arrived), arrived.id, arrived.lines, Object.keys(arrived)]);
attempt("its method", () => total(arrived));
attempt("what it is", () => [arrived instanceof Order, arrived === source, arrived.lines === source.lines, typeof arrived.total]);
attempt("the date and the map", () => [arrived.placed instanceof Date, arrived.placed.getTime(), arrived.notes instanceof Map, arrived.notes.get("gift")]);
attempt("a store leaves the source alone", () => {
  arrived.lines[0].count = 50;
  return [source.lines[0].count, count(arrived)];
});

const many = await send([new Order(), new Order()]);
attempt("an array of orders", () => many.map(count));
attempt("an array of orders, called", () => many.map(total));

const bytes = new Uint8Array([1, 2, 3]);
const moved = await send(bytes, [bytes.buffer]);
attempt("a transferred buffer", () => [moved.length, moved[0], bytes.length, bytes[0]]);

const primitives = await send([1, -0, NaN, "text", true, null, undefined, 5n]);
attempt("primitives", () => primitives);

for (const [name, value] of [["a function", count], ["a symbol", Symbol("s")], ["an order with a callback", Object.assign(new Order(), { callback: () => 1 })]] satisfies [string, unknown][]) {
  try {
    await send(value);
    console.log(name + " -> arrived");
  } catch (error) {
    console.log(name + " -> threw " + (error instanceof Error ? error.name : typeof error));
  }
}

const inOrder: number[] = [];
await new Promise<void>(resolve => {
  const { port1, port2 } = new MessageChannel();
  port2.onmessage = event => {
    const order: Order = event.data;
    inOrder.push(order.id);
    if (inOrder.length === 3) {
      port1.close();
      port2.close();
      resolve();
    }
  };
  for (let id = 1; id <= 3; id++) port1.postMessage(Object.assign(new Order(), { id }));
});
console.log("three in order -> " + inOrder.join());

export {};
