interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function flush(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join(", ") + "]");
  log.length = 0;
}

function json(p: Point): string {
  return JSON.stringify(p);
}

function jsonInside(p: Point): string {
  return JSON.stringify({ inner: p, list: [p] });
}

function concatenate(p: Point): string {
  return "<" + p + ">";
}

function tagOf(p: Point): string {
  return Object.prototype.toString.call(p);
}

function intoAList(p: Point): number {
  const empty: Point[] = [];
  return empty.concat(p).length;
}

async function passThrough(p: Point): Promise<Point> {
  return p;
}

async function awaited(p: Point): Promise<string> {
  const result = await p;
  return typeof result + " " + JSON.stringify(result);
}

const plain: Point = { x: 1, y: 2 };

const withToJSON = {
  x: 1,
  y: 2,
  toJSON(key: string) {
    log.push("toJSON " + JSON.stringify(key));
    return "replaced by toJSON";
  },
};

const withToString = {
  x: 1,
  y: 2,
  toString() {
    log.push("toString");
    return "own toString";
  },
};

const withValueOf = {
  x: 1,
  y: 2,
  valueOf() {
    log.push("valueOf");
    return 42;
  },
};

const withToPrimitive = {
  x: 1,
  y: 2,
  [Symbol.toPrimitive](hint: string) {
    log.push("toPrimitive " + hint);
    return "primitive";
  },
};

const withTag = { x: 1, y: 2, [Symbol.toStringTag]: "Tagged" };

const spreadable = { x: 1, y: 2, length: 3, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true };

const thenable = {
  x: 1,
  y: 2,
  then(resolve: (value: string) => void) {
    log.push("then");
    resolve("what then gave");
  },
};

const table: [string, Point][] = [
  ["plain", plain],
  ["toJSON", withToJSON],
  ["toString", withToString],
  ["valueOf", withValueOf],
  ["Symbol.toPrimitive", withToPrimitive],
  ["Symbol.toStringTag", withTag],
  ["Symbol.isConcatSpreadable", spreadable],
  ["then", thenable],
];

let length = 0;
for (let i = 0; i < 2000; i++) length += json(plain).length + concatenate(plain).length + intoAList(plain);
flush("2000 plain", length);

for (const [label, p] of table) {
  flush(label + ", json", json(p));
  flush(label + ", json inside", jsonInside(p));
  flush(label + ", concatenated", concatenate(p));
  flush(label + ", template", `${p}`);
  flush(label + ", tag", tagOf(p));
  flush(label + ", concat", intoAList(p));
  flush(label + ", awaited", await awaited(p));
  const through = await passThrough(p);
  flush(label + ", returned by an async function", typeof through + " " + JSON.stringify(through));
  const resolved = await Promise.resolve(p);
  flush(label + ", Promise.resolve", typeof resolved);
  const all = await Promise.all([p, plain]);
  flush(label + ", Promise.all", all.map(v => typeof v).join());
  flush(label + ", members", p.x + p.y);
}

export {};
