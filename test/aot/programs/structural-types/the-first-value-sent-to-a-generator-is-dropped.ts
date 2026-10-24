function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

class Order {
  id: number;
  note: string;
  constructor(id: number, note: string) {
    this.id = id;
    this.note = note;
  }
}

function* orders(start: number): Generator<string, number, Order> {
  console.log("body starts with " + start);
  let ids = start;
  let count = 0;
  while (count < 3) {
    const order: Order = yield "waiting " + count;
    count++;
    console.log("order " + count + ": " + text(order) + " id " + text(order.id) + " note " + text(order.note));
    ids += order.id;
  }
  return ids;
}

function feed(list: Order[]): string[] {
  const out: string[] = [];
  const generator = orders(1000);
  for (const order of list) out.push(text(generator.next(order)));
  out.push(text(generator.next(new Order(-1, "late"))));
  return out;
}

const list = [new Order(1, "first"), new Order(2, "second"), new Order(3, "third"), new Order(4, "fourth")];
for (const line of feed(list)) console.log(line);

function* echo(): Generator<number, void, number> {
  let last = 0;
  for (;;) {
    const sent: number = yield last;
    last = sent + 1;
  }
}

const echoing = echo();
console.log("first next(41): " + text(echoing.next(41)));
console.log("second next(41): " + text(echoing.next(41)));
let answer = 0;
for (let i = 0; i < 2000; i++) {
  const step = echoing.next(i);
  if (!step.done) answer += step.value;
}
console.log("after 2000: " + answer);

function* withDefault(first: number = 7): Generator<number, number, number> {
  const sent: number = yield first;
  return first + sent;
}

const a = withDefault();
console.log(text(a.next(1)) + " " + text(a.next(2)) + " " + text(a.next(3)));
const b = withDefault(undefined);
console.log(text(b.next(1)) + " " + text(b.next(2)) + " " + text(b.next(3)));
const c = withDefault(10);
console.log(text(c.next(1)) + " " + text(c.next()) + " " + text(c.next(3)));
