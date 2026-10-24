interface Pair {
  0: string;
  1: string;
}

interface Quoted {
  "0": string;
  "1": string;
}

interface Mixed {
  b: number;
  2: number;
  a: number;
  1: number;
  "-1": number;
  "01": number;
  1.5: number;
}

function both(p: Pair): string {
  return p[0] + p[1];
}

function bothQuoted(q: Quoted): string {
  return q["0"] + q["1"];
}

function listing(o: object): string {
  const walked: string[] = [];
  for (const key in o) walked.push(key);
  return Object.keys(o).join() + " | " + walked.join() + " | " + JSON.stringify(o) + " | " + Object.keys({ ...o }).join();
}

const numbers: Pair = { 0: "a", 1: "b" };
const strings: Pair = { "1": "d", "0": "c" };
const quoted: Quoted = numbers;
const unquoted: Pair = quoted;
const tuple: Pair = ["e", "f"];
const longer: Pair = ["g", "h", "i"];
const computed: Pair = { [0]: "l", ["1"]: "m" };
const padded = { z: 0, 1: "o", y: 0, 0: "n" };

const pairs: [string, Pair][] = [
  ["number keys", numbers],
  ["string keys, other order", strings],
  ["through the quoted type", unquoted],
  ["an array", tuple],
  ["a longer array", longer],
  ["computed keys", computed],
  ["with named extras", padded],
];

for (const [label, p] of pairs) {
  console.log(label + ": " + both(p) + " " + bothQuoted(p) + " " + typeof p + " " + Array.isArray(p));
  console.log(label + ", has: " + Object.hasOwn(p, 0) + " " + Object.hasOwn(p, "0") + " " + Object.hasOwn(p, "1"));
  console.log(label + ", listing: " + listing(p));
}

const mixed: Mixed = { b: 1, 2: 2, a: 3, 1: 4, "-1": 5, "01": 6, 1.5: 7 };
console.log("index keys come first, in number order: " + listing(mixed));
console.log("reads: " + [mixed.b, mixed[2], mixed["2"], mixed.a, mixed[1], mixed["-1"], mixed["01"], mixed[1.5], mixed["1.5"]].join());

const sameMembers: Mixed = { 1.5: 70, "01": 60, "-1": 50, 1: 40, a: 30, 2: 20, b: 10 };
console.log("written backwards: " + listing(sameMembers));

function store(p: Pair, value: string): string {
  p[0] = value;
  p["1"] = value + value;
  return both(p);
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

for (const [label, p] of pairs) attempt(label + ", stored", () => store(p, "x") + " " + JSON.stringify(p));

interface Big {
  4294967294: string;
  4294967295: string;
  4294967296: string;
  first: string;
}
const big: Big = { first: "f", 4294967296: "c", 4294967295: "b", 4294967294: "a" };
console.log("around the largest index: " + listing(big) + " " + big[4294967294] + big[4294967295] + big[4294967296]);

let length = 0;
for (let i = 0; i < 2000; i++) length += both(numbers).length;
console.log("2000 honest: " + length);
console.log("then: " + pairs.map(row => both(row[1])).join());

const index: number = pairs.length - 7;
const key: string = String(index);
const record: Record<number, string> = { ...numbers };
const byString: Record<string, string> = { ...numbers };
console.log("by a number and by its text: " + record[index] + " " + byString[key] + " " + byString[index]);

export {};
