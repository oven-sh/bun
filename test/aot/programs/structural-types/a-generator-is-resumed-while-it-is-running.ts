function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

type Numbers = Generator<number, string, number>;

const holder: { current?: Numbers } = {};

function poke(how: string): string {
  const g = holder.current;
  if (g === undefined) return "nobody";
  try {
    if (how === "next") return text(g.next(1));
    if (how === "return") return text(g.return("poked"));
    return text(g.throw(new Error("poked")));
  } catch (error) {
    return failure(error);
  }
}

function* selfish(): Numbers {
  let total = 10;
  console.log("before the first yield, next: " + poke("next"));
  console.log("before the first yield, return: " + poke("return"));
  console.log("before the first yield, throw: " + poke("throw"));
  const a: number = yield total;
  total += a;
  console.log("after the first yield, next: " + poke("next") + ", total " + total);
  const b: number = yield total;
  total += b;
  try {
    console.log("in a try, return: " + poke("return"));
    return "total " + total;
  } finally {
    console.log("in a finally, next: " + poke("next"));
  }
}

holder.current = selfish();
console.log(text(holder.current.next(0)));
console.log(text(holder.current.next(1)));
console.log(text(holder.current.next(2)));
console.log(text(holder.current.next(3)));

function* throughSpread(): Generator<number, void, void> {
  yield 1;
  const me: Iterable<number> | undefined = spreadHolder.current;
  try {
    console.log("spread of itself: " + text(me === undefined ? [] : [...me]));
  } catch (error) {
    console.log("spread of itself: " + failure(error));
  }
  yield 2;
}

const spreadHolder: { current?: Generator<number, void, void> } = {};
spreadHolder.current = throughSpread();
console.log("outer spread: " + text([...spreadHolder.current]));

function* pingPong(name: string, other: () => Numbers | undefined): Numbers {
  let got = 0;
  for (let i = 0; i < 2; i++) {
    const partner = other();
    try {
      const reply = partner === undefined ? "nobody" : text(partner.next(i));
      console.log(name + " asked its partner: " + reply);
    } catch (error) {
      console.log(name + " asked its partner: " + failure(error));
    }
    got += yield i;
  }
  return name + " got " + got;
}

const table: { ping?: Numbers; pong?: Numbers } = {};
table.ping = pingPong("ping", () => table.pong);
table.pong = pingPong("pong", () => table.ping);
console.log(text(table.ping.next(0)));
console.log(text(table.ping.next(5)));
console.log(text(table.ping.next(6)));
console.log(text(table.pong.next(7)));
console.log(text(table.pong.next(8)));
