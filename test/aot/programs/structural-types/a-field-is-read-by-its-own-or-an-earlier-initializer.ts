function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Order {
  first: number = this.readSecond();
  second: number = 2;
  third: number = this.readSecond();
  self: number = this.readSelf();
  text: string = this.readLabel();
  label: string = "label";
  viaArrow: number = (() => this.last)();
  viaArrowPlus: number = (() => this.last + 1)();
  keysSoFar: string = Object.keys(this).join("+");
  lazy: () => number = () => this.last;
  list: number[] = [this.readLast(), this.readSecond()];
  last: number = 9;
  readSecond(): number {
    return this.second;
  }
  readSelf(): number {
    return this.self;
  }
  readLabel(): string {
    return this.label;
  }
  readLast(): number {
    return this.last;
  }
}

const order = new Order();
show("first", () => order.first);
show("first + 1", () => order.first + 1);
show("second", () => order.second);
show("third", () => order.third);
show("self", () => order.self);
show("text", () => order.text);
show("text.length", () => order.text.length);
show("label", () => order.label);
show("viaArrow", () => order.viaArrow);
show("viaArrowPlus", () => order.viaArrowPlus);
show("keysSoFar", () => order.keysSoFar);
show("lazy()", () => order.lazy());
show("list", () => order.list.map(n => typeof n + " " + n).join());
show("0 in list", () => 0 in order.list);
show("list summed", () => order.list[0] + order.list[1]);
show("last", () => order.last);
show("keys", () => Object.keys(order).join());
show("JSON", () => JSON.stringify(order));

function firstOf(o: Order): number {
  return o.first;
}
function thirdOf(o: Order): number {
  return o.third;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += thirdOf(order);
show("2000 reads of a field that is set", () => sum);
show("one read of the field that is not", () => firstOf(order));
show("as a whole number", () => firstOf(order) | 0);
order.first = 1;
show("after a store", () => firstOf(order));
