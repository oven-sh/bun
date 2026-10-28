// Untyped code deletes names that the type of a record declares, from records that hold them and from records that do not, whatever the order in which a record got its properties: numbers of each kind, booleans, strings, objects; properties that were given a value of another kind, made accessors, made fixed; sealed and frozen records.
interface Row { id: number; whole?: number; fraction?: number; large?: number; flag?: boolean; text?: string; inner?: { v: number }; }
const names = ["whole", "fraction", "large", "flag", "text", "inner"] as const;
type Name = (typeof names)[number];
const valueOf = (name: Name, i: number): any => ({ whole: i, fraction: i + 0.5, large: 2 ** 40 + i, flag: (i & 1) === 0, text: "t" + (i % 3), inner: { v: i } })[name];
function fill(row: Row, name: Name, i: number): void {
  if (name === "whole") row.whole = i;
  else if (name === "fraction") row.fraction = i + 0.5;
  else if (name === "large") row.large = 2 ** 40 + i;
  else if (name === "flag") row.flag = (i & 1) === 0;
  else if (name === "text") row.text = "t" + (i % 3);
  else row.inner = { v: i };
}
const removeWhole: (row: any) => any = function (row: any): any { return delete row.whole; };
const removeFlag: (row: any) => any = function (row: any): any { return delete row.flag; };
const removeByKey: (row: any, key: any) => any = function (row: any, key: any): any { return delete row[key]; };
const attempt = (run: () => unknown): string => { try { return String(run()); } catch (error) { return (error as Error).name; } };
const show = (row: object): string => Object.keys(row).map(key => key + "=" + JSON.stringify((row as any)[key])).join();
const said = new Map<string, number>();
const say = (line: string): void => { said.set(line, (said.get(line) ?? 0) + 1); };

// Which of the six a record holds, and in which order it got them.
const orders: Name[][] = [[], ["whole"], ["flag", "whole"], ["whole", "flag"], ["text", "inner", "fraction"], ["large", "text"], [...names], [...names].reverse(), ["inner"], ["fraction", "large", "whole", "flag"]];
function make(order: Name[], i: number): Row {
  const row: Row = { id: i % 2 };
  for (const name of order) fill(row, name, i % 4);
  return row;
}
for (let round = 0; round < 60; round++) {
  for (const order of orders) {
    for (const name of names) {
      const row = make(order, round);
      const answer = name === "whole" ? removeWhole(row) : name === "flag" ? removeFlag(row) : removeByKey(row, name);
      say(order.join("+") + " without " + name + ": " + answer + " " + show(row) + " " + (name in row));
      fill(row, name, round % 4);
      say(order.join("+") + " with " + name + " again: " + show(row));
      say(order.join("+") + " twice: " + removeByKey(row, name) + removeByKey(row, name) + " " + show(row));
    }
  }
}
// What the slot of the field cannot hold lies elsewhere in the record.
for (let round = 0; round < 60; round++) {
  for (const order of orders) {
    for (const name of names) {
      const row = make(order, round), loose: any = row;
      loose[name] = round % 2 ? Symbol.for("other") : [round % 2];
      const before = Object.keys(row).join();
      say(order.join("+") + " another kind of " + name + ": " + removeByKey(row, name) + " " + before + " > " + Object.keys(row).join() + " " + (name in row) + " " + typeof loose[name]);
      say(order.join("+") + " and once more: " + removeByKey(row, name) + " " + removeWhole(row) + removeFlag(row) + " " + show(row));
    }
  }
}
const closers: [string, (row: Row) => Row][] = [["sealed", row => Object.seal(row)], ["frozen", row => Object.freeze(row)], ["closed", row => Object.preventExtensions(row)]];
for (let round = 0; round < 40; round++) {
  for (const order of orders) {
    for (const name of names) {
      const getter = make(order, round);
      Object.defineProperty(getter, name, { get() { return "got"; }, configurable: true, enumerable: true });
      say(order.join("+") + " a getter for " + name + ": " + attempt(() => removeByKey(getter, name)) + " " + show(getter));
      const fixed = make(order, round);
      Object.defineProperty(fixed, name, { value: valueOf(name, 1), configurable: false, enumerable: true, writable: true });
      say(order.join("+") + " fixed " + name + ": " + attempt(() => removeByKey(fixed, name)) + " " + attempt(() => removeWhole(fixed)) + " " + attempt(() => removeFlag(fixed)) + " " + show(fixed));
      for (const [word, close] of closers) {
        const row = close(make(order, round));
        say(order.join("+") + " " + word + " " + name + ": " + attempt(() => removeByKey(row, name)) + " " + attempt(() => removeWhole(row)) + " " + attempt(() => removeFlag(row)) + " " + show(row));
      }
      const heir = make(order, round);
      Object.setPrototypeOf(heir, { [name]: "above" });
      say(order.join("+") + " below " + name + ": " + removeByKey(heir, name) + " " + (heir as any)[name] + " " + show(heir));
      const more = make(order, round), looseMore: any = more;
      looseMore.beside = round % 2;
      say(order.join("+") + " beside " + name + ": " + removeByKey(more, name) + " " + show(more) + " " + removeByKey(more, "beside") + " " + show(more));
    }
  }
}
const lines = [...said].map(([line, times]) => times + " " + line);
let sum = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(lines.length, sum);
console.log(lines.filter((_, i) => i % 97 === 0).join("\n"));
