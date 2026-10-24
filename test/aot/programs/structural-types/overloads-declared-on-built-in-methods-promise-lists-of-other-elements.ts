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
  interface String {
    split(separator: string): number[];
  }
  interface ObjectConstructor {
    keys(value: object): number[];
    values(value: object): number[];
  }
  interface ArrayConstructor {
    of(...items: number[]): string[];
  }
  interface Array<T> {
    slice(): string[];
    concat(other: string[]): T[];
  }
  interface JSON {
    parse(text: string): number[];
  }
  interface PromiseConstructor {
    resolve(value: number): Promise<string>;
  }
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function totalByOf(list: number[]): number {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}

function widths(list: string[]): unknown[] {
  return list.map(s => s.length);
}

function firstPlusOne(list: number[]): number {
  return list[0] + 1;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i, 0.5]) + totalByOf([i]) + firstPlusOne([i]) + widths(["ab"]).length;
show("2000 honest rounds", () => warm);

show("split is typed as numbers", () => ["1,2".split(","), total("1,2".split(",")), totalByOf("1,2".split(",")), firstPlusOne("1,2".split(","))]);
show("split: each times two", () => "1,x".split(",").map(n => n * 2));
show("split: the largest", () => Math.max(..."3,20".split(",")));
show("split: as doubles", () => Array.from(new Float64Array("1.5,x".split(","))));
show("split: a number pushed behind the strings", () => {
  const list = "a,b".split(",");
  list.push(3);
  return [list, total(list)];
});
show("Object.keys is typed as numbers", () => [Object.keys({ a: 1, b: 2 }), total(Object.keys({ a: 1, b: 2 })), firstPlusOne(Object.keys({ 7: 1 }))]);
show("Object.values is typed as numbers", () => [Object.values({ a: "x", b: true }), total(Object.values({ a: "x", b: true }))]);
show("Array.of is typed as strings", () => [Array.of(1, 22), widths(Array.of(1, 22)), Array.of(1, 22).join("")]);
show("Array.of: in capitals", () => Array.of(1)[0].toUpperCase());
show("slice is typed as strings", () => [[1.5, 2.5].slice(), widths([1.5, 2.5].slice())]);
show("concat takes strings into numbers", () => {
  const list: number[] = [1.5].concat(["two"]);
  return [list, total(list), firstPlusOne(list)];
});
show("JSON.parse is typed as numbers", () => [JSON.parse('["a", null, 3]'), total(JSON.parse('["a", null, 3]')), firstPlusOne(JSON.parse('["a"]'))]);
show("JSON.parse answers no list at all", () => [JSON.parse("5"), total(JSON.parse("5")), JSON.parse('{"length": 2}').length]);
show("JSON.parse answers null", () => total(JSON.parse("null")));

const settled: string = await Promise.resolve(5);
show("Promise.resolve is typed as a string", () => [settled, typeof settled, settled.length, settled + "!"]);
show("honest again", () => [total([1, 2]), totalByOf([1, 2]), firstPlusOne([1]), widths(["abc"])]);

export {};
