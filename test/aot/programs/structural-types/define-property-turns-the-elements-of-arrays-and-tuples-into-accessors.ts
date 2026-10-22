interface Inner {
  depth: number;
}

function numbers(): number[] {
  return [1, 2, 3];
}

function pair(): [number, string] {
  return [1, "one"];
}

function parts(): Inner[] {
  return [{ depth: 1 }, { depth: 2 }, { depth: 3 }];
}

function sum(list: number[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function sumOf(list: number[]): number {
  let total = 0;
  for (const n of list) total += n;
  return total;
}

function depths(list: Inner[]): number {
  let total = 0;
  for (const part of list) total += part.depth;
  return total;
}

let quiet = false;
const log: string[] = [];

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line + (log.length > 0 ? " [" + log.join() + "]" : ""));
  log.length = 0;
}

function useNumbers(label: string, list: number[]): void {
  attempt(label + ", the first", () => list[0]);
  attempt(label + ", typeof the first", () => typeof list[0]);
  attempt(label + ", the first plus one", () => list[0] + 1);
  attempt(label + ", the second doubled", () => list[1] * 2);
  attempt(label + ", its length", () => list.length);
  attempt(label + ", summed by index", () => sum(list));
  attempt(label + ", summed by for-of", () => sumOf(list));
  attempt(label + ", reduced", () => list.reduce((a, b) => a + b, 0));
  attempt(label + ", mapped", () => list.map(n => n + 1).join());
  attempt(label + ", joined", () => list.join());
  attempt(label + ", json", () => JSON.stringify(list));
  attempt(label + ", spread", () => JSON.stringify([...list]));
  attempt(label + ", keys", () => Object.keys(list).join());
  attempt(label + ", has the second", () => 1 in list);
  attempt(label + ", index of 2", () => list.indexOf(2));
  attempt(label + ", a callback finds undefined", () => list.findIndex(n => n === undefined));
  attempt(label + ", a callback counts numbers", () => list.filter(n => typeof n === "number").length);
  attempt(label + ", kinds", () => list.map(n => typeof n).join());
  attempt(label + ", the first is undefined", () => list[0] === undefined);
  attempt(label + ", the second is a number", () => typeof list[1] === "number");
  attempt(label + ", a pattern", () => (([a, b]: number[]) => a + b)(list));
  attempt(label + ", the largest", () => Math.max(...list));
  attempt(label + ", is an array", () => Array.isArray(list) + " " + (list instanceof Array));
  attempt(label + ", the first stored", () => (list[0] = 10));
  attempt(label + ", the first after the store", () => list[0]);
  attempt(label + ", pushed", () => list.push(4));
  attempt(label + ", popped", () => list.pop());
  attempt(label + ", shortened", () => (list.length = 1));
  attempt(label + ", json after all that", () => JSON.stringify(list));
}

function usePair(label: string, p: [number, string]): void {
  attempt(label + ", the number plus one", () => p[0] + 1);
  attempt(label + ", the length of the string", () => p[1].length);
  attempt(label + ", its length", () => p.length);
  attempt(label + ", a pattern", () => (([n, s]: [number, string]) => s + n)(p));
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", the number stored", () => (p[0] = 10));
  attempt(label + ", the string stored", () => (p[1] = "ten"));
  attempt(label + ", json after the stores", () => JSON.stringify(p));
}

function useParts(label: string, list: Inner[]): void {
  attempt(label + ", the depth of the first", () => list[0].depth);
  attempt(label + ", a callback finds what is no object", () => list.findIndex(part => typeof part !== "object" || part === null));
  attempt(label + ", the first is undefined", () => list[0] === undefined);
  attempt(label + ", all depths", () => depths(list));
  attempt(label + ", json", () => JSON.stringify(list));
}

class Holder {
  list: number[];
  constructor(list: number[]) {
    this.list = list;
  }
}

function inPlaces(label: string, make: () => number[]): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.list[0] + holder.list.length);
  const lists: number[][] = [numbers(), make()];
  attempt(label + ", an element", () => lists[1][0] + lists[1].length);
  attempt(label + ", a result", () => make()[0] + make().length);
}

function inALoop(label: string, write: (list: number[]) => void): void {
  const list = numbers();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(list);
      const value = list[0] + list[1] + list.length;
      if (typeof value === "number" && value === value) honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds that gave a number: " + honest + ", the last value: " + text(last));
}

const numberWrites: [string, (list: number[]) => void][] = [
  ["the first becomes a getter", list => { Object.defineProperty(list, 0, { get: () => (log.push("get 0"), 100), enumerable: true, configurable: true }); }],
  ["the first becomes a getter of a string", list => { Object.defineProperty(list, 0, { get: () => (log.push("get 0"), "text"), enumerable: true, configurable: true }); }],
  [
    "the last becomes a getter and a setter",
    list => {
      let held: unknown = 300;
      Object.defineProperty(list, 2, {
        get: () => (log.push("get 2"), held),
        set: (value: unknown) => {
          log.push("set 2");
          held = value;
        },
        enumerable: true,
        configurable: true,
      });
    },
  ],
  ["a getter behind the end", list => { Object.defineProperty(list, 4, { get: () => (log.push("get 4"), 500), enumerable: true, configurable: true }); }],
  [
    "the second becomes a getter that throws",
    list => {
      Object.defineProperty(list, 1, {
        get: () => {
          throw new RangeError("second");
        },
        enumerable: true,
        configurable: true,
      });
    },
  ],
  ["the first becomes a getter that shortens the list", list => { Object.defineProperty(list, 0, { get: () => ((list.length = 1), 100), enumerable: true, configurable: true }); }],
];

const pairWrites: [string, (p: [number, string]) => void][] = [
  ["the number becomes a getter", p => { Object.defineProperty(p, 0, { get: () => (log.push("get 0"), 100), enumerable: true, configurable: true }); }],
  ["the string becomes a getter of a number", p => { Object.defineProperty(p, 1, { get: () => (log.push("get 1"), 7), enumerable: true, configurable: true }); }],
];

const partsWrites: [string, (list: Inner[]) => void][] = [
  ["the first becomes a getter", list => { Object.defineProperty(list, 0, { get: () => (log.push("get 0"), { depth: 100 }), enumerable: true, configurable: true }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useNumbers("", numbers());
  usePair("", pair());
  useParts("", parts());
}
inPlaces("", numbers);
inALoop("", () => {});
quiet = false;

useNumbers("untouched", numbers());
usePair("untouched", pair());
useParts("untouched", parts());

for (const [label, write] of numberWrites) {
  const list = numbers();
  attempt(label + ", the write itself", () => write(list));
  useNumbers(label, list);
  inPlaces(label, () => {
    const made = numbers();
    write(made);
    return made;
  });
  inALoop(label, write);
}

for (const [label, write] of pairWrites) {
  const p = pair();
  attempt(label + ", the write itself", () => write(p));
  usePair(label, p);
}

for (const [label, write] of partsWrites) {
  const list = parts();
  attempt(label + ", the write itself", () => write(list));
  useParts(label, list);
}

useNumbers("untouched afterwards", numbers());

export {};
