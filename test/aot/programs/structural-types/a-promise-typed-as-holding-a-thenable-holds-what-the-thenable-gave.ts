function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Ticket {
  label: string;
  price: number;
  constructor(label: string, price: number) {
    this.label = label;
    this.price = price;
  }
  then(resolve: (value: number) => void): void {
    resolve(this.price);
  }
  describe(): string {
    return this.label + " costs " + this.price;
  }
}

class Plain {
  label: string;
  price: number;
  constructor(label: string, price: number) {
    this.label = label;
    this.price = price;
  }
  describe(): string {
    return this.label + " costs " + this.price;
  }
}

async function identity<T>(value: T): Promise<T> {
  return value;
}

function wrap<T>(value: T): Promise<T> {
  return new Promise<T>(resolve => resolve(value));
}

function afterwards<T>(value: T): Promise<T> {
  return Promise.resolve(0).then((): T => value);
}

function look(item: { label: string; price: number; describe(): string }): string {
  let described: string;
  try {
    described = item.describe();
  } catch (error) {
    described = failure(error);
  }
  return text(item) + " | label " + text(item.label) + " | price + 1 " + text(item.price + 1) + " | " + described;
}

const ways: [string, <T>(value: T) => Promise<T>][] = [
  ["an async identity function", identity],
  ["a resolve function", wrap],
  ["a reaction's result", afterwards],
];

for (const [label, way] of ways) {
  console.log(label + ", plain: " + (await way(new Plain("seat", 5)).then(look)));
  console.log(label + ", thenable: " + (await way(new Ticket("seat", 5)).then(look)));
  console.log(label + ", a number: " + (await way(5).then(n => text(n + 1))));
}

const kept: Promise<Ticket>[] = [wrap(new Ticket("a", 1)), identity(new Ticket("b", 2))];
for (const promise of kept) console.log("kept in a list: " + (await promise.then(ticket => look(ticket))));

class Desk {
  pending: Promise<Ticket>;
  constructor(ticket: Ticket) {
    this.pending = identity(ticket);
  }
  label(): Promise<string> {
    return this.pending.then(ticket => ticket.label);
  }
  total(): Promise<number> {
    return this.pending.then(ticket => ticket.price * 2);
  }
}
const desk = new Desk(new Ticket("desk", 3));
console.log("in a field: " + text(await desk.label()) + ", " + text(await desk.total()));

let warm = 0;
for (let i = 0; i < 2000; i++) warm += await identity(new Plain("p", 1)).then(item => item.price);
console.log("2000 plain ones: " + warm);
console.log("then a thenable at the same place: " + text(await identity(new Ticket("t", 1)).then(item => item.price)));

export {};
