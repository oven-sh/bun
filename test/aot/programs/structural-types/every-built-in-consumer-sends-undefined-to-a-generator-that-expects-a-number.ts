function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

let received: string[] = [];

function* doubles(): Generator<number, number, number> {
  let total = 0;
  let whole = 0;
  try {
    for (let i = 1; i <= 3; i++) {
      const sent: number = yield i * 10;
      received.push(text(sent));
      total += sent;
      whole = (whole + sent) | 0;
      received.push("total " + text(total) + " whole " + text(whole) + " twice " + text(sent * 2));
    }
    return total;
  } finally {
    received.push("closed");
  }
}

function* pairs(): Generator<[string, number], void, number> {
  const first: number = yield ["first", 1];
  received.push(text(first));
  const second: number = yield ["second", 2];
  received.push(text(second));
}

const consumers: [string, (numbers: Iterable<number>) => unknown][] = [
  ["spread", numbers => [...numbers]],
  ["spread into a call", numbers => Math.max(...numbers)],
  ["Array.from", numbers => Array.from(numbers)],
  ["Array.from with a function", numbers => Array.from(numbers, n => n + 1)],
  ["new Set", numbers => new Set(numbers).size],
  ["a typed array", numbers => Array.from(new Int32Array(numbers))],
  ["destructuring two", numbers => {
    const [a, b] = numbers;
    return [a, b];
  }],
  ["destructuring with a rest", numbers => {
    const [a, ...others] = numbers;
    return [a, others];
  }],
  ["destructuring five", numbers => {
    const [a, b, c, d, e] = numbers;
    return [a, b, c, text(d), text(e)];
  }],
  ["an empty pattern", numbers => {
    const [] = numbers;
    return "nothing";
  }],
  ["for-of with a break", numbers => {
    for (const n of numbers) if (n === 20) return n;
    return -1;
  }],
];

for (const [label, consume] of consumers) {
  received = [];
  console.log(label + ": " + text(consume(doubles())));
  console.log(label + " received: " + received.join(" | "));
  console.log(label + " over an array: " + text(consume([10, 20, 30])));
}

received = [];
console.log("new Map: " + text([...new Map(pairs())]));
console.log("new Map received: " + received.join(" | "));
received = [];
console.log("Object.fromEntries: " + text(Object.fromEntries(pairs())));
console.log("Object.fromEntries received: " + received.join(" | "));

received = [];
const settled = await Promise.all(doubles());
console.log("Promise.all: " + text(settled));
console.log("Promise.all received: " + received.join(" | "));

export {};
