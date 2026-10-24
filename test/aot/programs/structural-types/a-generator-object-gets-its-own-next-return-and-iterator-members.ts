function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

type Numbers = Generator<number, void, void>;

let log: string[] = [];

function* upTo(limit: number): Numbers {
  try {
    for (let i = 1; i <= limit; i++) yield i;
  } finally {
    log.push("finally");
  }
}

function sum(g: Numbers): number {
  let total = 0;
  for (const n of g) total += n;
  return total;
}

function firstOf(g: Numbers): number {
  for (const n of g) return n;
  return -1;
}

function byHand(g: Numbers): number {
  let total = 0;
  for (let r = g.next(); !r.done; r = g.next()) total += r.value;
  return total;
}

function* relay(g: Numbers): Numbers {
  yield* g;
}

function ownNext(): Numbers {
  const g = upTo(3);
  let calls = 0;
  g.next = () => {
    log.push("own next");
    return ++calls > 2 ? { done: true, value: undefined } : { done: false, value: calls * 100 };
  };
  return g;
}

function ownReturn(): Numbers {
  const g = upTo(3);
  g.return = () => {
    log.push("own return");
    return { done: true, value: undefined };
  };
  return g;
}

function ownIterator(): Numbers {
  const g = upTo(3);
  g[Symbol.iterator] = () => {
    log.push("own iterator");
    return upTo(1);
  };
  return g;
}

function nextChangesInTheMiddle(): Numbers {
  const g = upTo(3);
  const original = g.next;
  g.next = function (this: Numbers) {
    log.push("first own next");
    g.next = () => {
      log.push("second own next");
      return { done: true, value: undefined };
    };
    return original.call(g);
  };
  return g;
}

const makers: [string, () => Numbers][] = [
  ["untouched", () => upTo(3)],
  ["own next", ownNext],
  ["own return", ownReturn],
  ["own iterator", ownIterator],
  ["next replaces itself", nextChangesInTheMiddle],
];

const uses: [string, (g: Numbers) => unknown][] = [
  ["for-of", sum],
  ["for-of left early", firstOf],
  ["by hand", byHand],
  ["spread", g => [...g]],
  ["destructuring", g => {
    const [a] = g;
    return a;
  }],
  ["Array.from", g => Array.from(g)],
  ["yield*", g => [...relay(g)]],
  ["yield* left early", g => firstOf(relay(g))],
  ["a helper", g => g.map(n => n + 1).toArray()],
  ["keys", g => Object.keys(g).join()],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(upTo(3)) + byHand(upTo(2)) + firstOf(upTo(1));
console.log("2000 untouched ones: " + warm);

for (const [name, use] of uses) {
  for (const [label, make] of makers) {
    log = [];
    let outcome: string;
    try {
      outcome = text(use(make()));
    } catch (error) {
      outcome = failure(error);
    }
    console.log(name + ", " + label + ": " + outcome + " [" + log.join(", ") + "]");
  }
}
