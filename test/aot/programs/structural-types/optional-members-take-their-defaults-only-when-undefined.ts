interface Request {
  path: string;
  retries?: number;
  verbose?: boolean;
  tag?: string | null;
  nested?: { depth?: number };
}

const log: string[] = [];

function fallback(name: string, value: number): number {
  log.push("default for " + name);
  return value;
}

function inParameter({ path, retries = fallback("retries", 3), verbose = false, tag = "none" }: Request): string {
  return [path, retries, verbose, tag].join(" ");
}

function inBody(r: Request): string {
  const { retries = fallback("retries", 3), nested: { depth = fallback("depth", 1) } = {} } = r;
  return retries + " " + depth;
}

function byOperators(r: Request): string {
  return [r.retries ?? 3, r.retries || 3, r.verbose ?? "unset", r.tag ?? "nullish", r.nested?.depth ?? "no depth"].join(" ");
}

function wholeDefault(r: Request = { path: "default request" }): string {
  return r.path + " " + Object.keys(r).join();
}

function flush(label: string, value: string): void {
  console.log(label + ": " + value + " [" + log.join() + "]");
  log.length = 0;
}

const getter: Request = {
  path: "getter",
  get retries() {
    log.push("get retries");
    return undefined;
  },
};

const table: [string, Request][] = [
  ["absent", { path: "a" }],
  ["undefined", { path: "b", retries: undefined, verbose: undefined, tag: undefined, nested: undefined }],
  ["zero, false, null", { path: "c", retries: 0, verbose: false, tag: null, nested: {} }],
  ["minus zero and empty", { path: "d", retries: -0, tag: "", nested: { depth: undefined } }],
  ["not a number", { path: "e", retries: NaN, nested: { depth: 0 } }],
  ["given", { nested: { depth: 5 }, tag: "t", verbose: true, retries: 9, path: "f" }],
  ["a getter that answers undefined", getter],
  ["inherited", Object.assign(Object.create({ retries: 7, tag: "proto" }), { path: "g" })],
];

for (const [label, r] of table) {
  flush(label + ", parameter pattern", inParameter(r));
  flush(label + ", pattern in the body", inBody(r));
  flush(label + ", operators", byOperators(r));
  flush(label + ", a default for the whole", wholeDefault(r));
}
flush("nothing passed", wholeDefault());
flush("undefined passed", wholeDefault(undefined));

const honest: Request = { path: "h", retries: 1, verbose: true, tag: "x", nested: { depth: 2 } };
let length = 0;
for (let i = 0; i < 2000; i++) length += inParameter(honest).length + inBody(honest).length;
flush("2000 that give everything", String(length));
flush("then absent", inParameter({ path: "a" }) + " | " + inBody({ path: "a" }));
flush("then undefined", inParameter(table[1][1]) + " | " + inBody(table[1][1]));
flush("then everything", inParameter(honest) + " | " + inBody(honest));

const zero: Request = { path: "z", retries: -0 };
const { retries: kept = 5 } = zero;
console.log("minus zero is kept: " + Object.is(kept, -0));

export {};
