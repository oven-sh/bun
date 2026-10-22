function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  interface Math {
    floor(n: number): string;
    max(a: string, b: string): string;
  }
  interface Number {
    toFixed(): number;
  }
  interface String {
    charCodeAt(index: number): string;
    indexOf(part: string): boolean;
    toUpperCase(): number;
  }
  interface Array<T> {
    push(item: string): string;
    indexOf(item: T): string;
    join(): number;
  }
  interface JSON {
    stringify(value: number): number;
  }
  interface Map<K, V> {
    get(key: K): V;
  }
}

function lengthOf(s: string): number {
  return s.length;
}

function plusOne(n: number): number {
  return n + 1;
}

function word(flag: boolean): string {
  return flag === true ? "true" : flag === false ? "false" : "neither";
}

show("honest callers", () => [lengthOf("ab"), plusOne(1), word(true)]);
show("Math.floor is typed string", () => [Math.floor(1.5), typeof Math.floor(1.5), lengthOf(Math.floor(1.5)), Math.floor(1.5) + "1"]);
show("Math.floor in capitals", () => Math.floor(1.5).trim());
show("Math.max takes strings", () => [Math.max("3", "20"), typeof Math.max("3", "20"), lengthOf(Math.max("3", "20")), Math.max("a", "b")]);
show("toFixed is typed number", () => [(1.5).toFixed(), typeof (1.5).toFixed(), (1.5).toFixed() + 1, plusOne((1.5).toFixed()), (1.5).toFixed() * 2]);
show("charCodeAt is typed string", () => ["a".charCodeAt(0), lengthOf("a".charCodeAt(0)), "a".charCodeAt(0) + "1"]);
show("indexOf of a string is typed boolean", () => ["abc".indexOf("c"), word("abc".indexOf("c")), "abc".indexOf("a") ? "found" : "not found", "abc".indexOf("z") ? "found" : "not found"]);
show("toUpperCase is typed number", () => ["ab".toUpperCase(), "ab".toUpperCase() + 1, plusOne("ab".toUpperCase()), "12".toUpperCase() * 2]);
show("push takes a string into a list of numbers", () => {
  const list: number[] = [1.5, 2.5];
  const result = list.push("three");
  let sum = 0;
  for (const n of list) sum += n;
  return [result, typeof result, list, sum, list[2] + 1];
});
show("indexOf of a list is typed string", () => [[5, 6].indexOf(6), lengthOf([5, 6].indexOf(6)), [5, 6].indexOf(6) + "!"]);
show("join is typed number", () => [[1, 2].join(), [1, 2].join() + 1, plusOne([1, 2].join())]);
show("JSON.stringify is typed number", () => [JSON.stringify(5), JSON.stringify(5) + 1, plusOne(JSON.stringify(5)), typeof JSON.stringify(5)]);
show("Map.get never answers undefined by its type", () => {
  const map = new Map<string, number>([["k", 1]]);
  return [map.get("k") + 1, map.get("missing"), map.get("missing") + 1, plusOne(map.get("missing"))];
});

let sum = 0;
for (let i = 0; i < 2000; i++) sum += plusOne(i) + lengthOf("ab");
show("2000 honest rounds", () => sum);
show("then the odd ones again", () => [plusOne((2.5).toFixed()), lengthOf(Math.floor(2.5)), plusOne([3].join())]);

export {};
