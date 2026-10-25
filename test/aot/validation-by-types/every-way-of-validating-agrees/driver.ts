// Gives each validator values and texts made from its samples, and prints one line per answer.
type Reviver = (this: any, key: string, value: any) => any;
type Validate = (value: unknown) => unknown;
type Parse = (text: string) => unknown;
type Revive = (text: string, reviver: Reviver) => unknown;
type Key = string | number;

const lines: string[] = [];
let count = 0;

function render(value: unknown): string {
  const text = JSON.stringify(value, (_, item) => {
    if (item === undefined) return "<undefined>";
    if (typeof item === "bigint") return `<${item}n>`;
    if (typeof item === "symbol" || typeof item === "function") return `<${typeof item}>`;
    if (typeof item === "number" && (item !== item || item === Infinity || item === -Infinity)) return `<${item}>`;
    if (item === 0 && 1 / item < 0) return "<-0>";
    return item;
  });
  return text ?? "undefined";
}

/** "ok" for a result that holds the same data as `given`, "ok" and the result for another one, or the error. */
function answer(call: () => unknown, given: unknown): string {
  try {
    const result = render(call());
    return result === render(given) ? "ok" : "ok " + result;
  } catch (error: any) {
    const issues = error?.issues;
    const mark = Array.isArray(issues) ? ` [${issues.length} ${Bun.hash.crc32(JSON.stringify(issues)).toString(16)}]` : "";
    return `${error?.name}: ${error?.message}${mark}`;
  }
}

function placesOf(value: any, path: Key[], into: Key[][]) {
  into.push(path);
  if (Array.isArray(value)) for (let i = 0; i < value.length; i++) placesOf(value[i], [...path, i], into);
  else if (value !== null && typeof value === "object")
    for (const key of Object.keys(value)) placesOf(value[key], [...path, key], into);
}

const nameOf = (path: Key[]) => (path.length ? path.map(key => JSON.stringify(key)).join(".") : "value");

/** A new copy of the sample with one place changed. */
function change(sample: string, path: Key[], edit: (holder: any, key: Key) => void): unknown {
  const root = { value: JSON.parse(sample) };
  let holder: any = root;
  let key: Key = "value";
  for (const next of path) {
    holder = holder[key];
    key = next;
  }
  edit(holder, key);
  return root.value;
}

type Edit = [string, (holder: any, key: Key) => void];
const set = (value: () => unknown): Edit[1] => (holder, key) => void (holder[key] = value()); // prettier-ignore

function editsOfJSON(present: unknown, isRoot: boolean, turn: number): Edit[] {
  const edits: Edit[] = [];
  const others: [string, () => unknown][] = [
    ["null", () => null],
    ["true", () => true],
    ["0", () => 0],
    ['""', () => ""],
    ["[]", () => []],
    ["{}", () => ({})],
  ];
  for (let i = 0; i < 2; i++) {
    const [name, make] = others[(turn + i * 3) % others.length];
    if (render(make()) !== render(present)) edits.push(["= " + name, set(make)]);
  }
  if (!isRoot)
    edits.push(["removed", (holder, key) => void (Array.isArray(holder) ? holder.splice(key as number, 1) : delete holder[key])]); // prettier-ignore
  if (typeof present === "number") {
    edits.push(["+ 1", set(() => present + 1)], ["- 1", set(() => present - 1)], ["+ 0.5", set(() => present + 0.5)]);
    edits.push(["negated", set(() => -present)], ["= 1e400", set(() => Infinity)], ["as a string", set(() => String(present))]); // prettier-ignore
  } else if (typeof present === "string") {
    edits.push(["+ !", set(() => present + "!")], ["without its first character", set(() => present.slice(1))]);
    edits.push(["twice", set(() => present + present)], ["in capitals", set(() => present.toUpperCase())]);
  } else if (typeof present === "boolean") {
    edits.push(["negated", set(() => !present)], ["as a string", set(() => String(present))]);
  } else if (Array.isArray(present)) {
    edits.push(["+ null", (holder, key) => void holder[key].push(null)]);
    if (present.length) {
      edits.push(["without its last element", (holder, key) => void holder[key].pop()]);
      edits.push(["+ its first element", (holder, key) => void holder[key].push(holder[key][0])]);
      edits.push(["as an object", (holder, key) => void (holder[key] = { ...holder[key] })]);
    }
  } else if (present !== null && typeof present === "object") {
    edits.push(["+ extra", (holder, key) => void (holder[key].extra = null)]);
    edits.push(["+ __proto__", (holder, key) => void Object.defineProperty(holder[key], "__proto__", { value: { extra: 1 }, enumerable: true, writable: true, configurable: true })]); // prettier-ignore
    edits.push(["in an array", (holder, key) => void (holder[key] = [holder[key]])]);
  }
  return edits;
}

class Instance {}
class List extends Array {}
const others: [string, () => unknown][] = [
  ["undefined", () => undefined],
  ["NaN", () => NaN],
  ["-0", () => -0],
  ["1n", () => 1n],
  ["a symbol", () => Symbol("a")],
  ["a function", () => () => 1],
  ["a Date", () => new Date(0)],
  ["a Map", () => new Map([["a", 1]])],
  ["a RegExp", () => /a/],
  ["a String", () => new String("a")],
  ["a Number", () => new Number(1)],
  ["an array with a hole", () => [, 1]],
  ["an instance", () => new Instance()],
  ["a Uint8Array", () => new Uint8Array(2)],
  ["-Infinity", () => -Infinity],
  ["an Error", () => new Error("a")],
];

function deep(value: any, wrap: (copy: any) => any): any {
  if (value === null || typeof value !== "object") return value;
  const copy: any = Array.isArray(value) ? [] : {};
  for (const key of Object.keys(value))
    Object.defineProperty(copy, key, { value: deep(value[key], wrap), writable: true, enumerable: true, configurable: true }); // prettier-ignore
  return wrap(copy);
}
function withGetters(copy: any) {
  for (const key of Object.keys(copy)) {
    const held = copy[key];
    Object.defineProperty(copy, key, { get: () => held, enumerable: true, configurable: true });
  }
  return copy;
}
const forms: [string, (value: unknown) => unknown][] = [
  ["frozen", value => deep(value, copy => Object.freeze(copy))],
  ["without prototypes", value => deep(value, copy => (Array.isArray(copy) ? copy : Object.setPrototypeOf(copy, null)))],
  ["with getters", value => deep(value, withGetters)],
  ["behind proxies", value => deep(value, copy => new Proxy(copy, {}))],
  ["as instances", value => deep(value, copy => Object.setPrototypeOf(copy, Array.isArray(copy) ? List.prototype : Instance.prototype))], // prettier-ignore
  ["with a symbol key", value => deep(value, copy => (Array.isArray(copy) ? copy : Object.assign(copy, { [Symbol("a")]: 1 })))], // prettier-ignore
  ["with a hidden property", value => deep(value, copy => Object.defineProperty(copy, "hidden", { value: 1, enumerable: false }))], // prettier-ignore
];
const spellings: [string, (text: string) => string][] = [
  ["with blanks", text => " \n" + text.replace(/([,:])(?=["\d\[{tfn-])/g, "$1 ") + "\t\r\n"],
  ["with an escaped name", text => text.replace(/"([A-Za-z])/, (_, letter) => '"\\u00' + letter.charCodeAt(0).toString(16))],
];

/** At most `most` of the items, spread evenly. */
function spread<T>(items: T[], most: number): T[] {
  if (items.length <= most) return items;
  const taken: T[] = [];
  for (let i = 0; i < most; i++) taken.push(items[Math.floor((i * items.length) / most)]);
  return taken;
}

export function add(samples: string[], validate: Validate, parse: Parse, revive: Revive | undefined) {
  const say = (line: string) => void lines.push(line);
  say(`# ${count++}`);
  /** Both functions get the same data. One line when they agree. */
  const both = (name: string, value: unknown): [string, string] => {
    const text = JSON.stringify(value, (_, item) => (item === Infinity ? "<1e400>" : item)).replaceAll('"<1e400>"', "1e400");
    const byValue = answer(() => validate(value), value);
    const byText = answer(() => parse(text), value);
    if (byValue === byText) say(`${name}: ${byValue}`);
    else say(`${name}: validate ${byValue}`), say(`${name}: parse ${byText}`);
    return [byValue, text];
  };

  // The first sample, and the first changed sample that is refused, are tried in other forms below.
  const data: [unknown, string][] = [];
  for (const [index, sample] of samples.entries()) {
    both(`sample ${index}`, JSON.parse(sample));
    if (!index) data.push([JSON.parse(sample), sample]);
    const places: Key[][] = [];
    placesOf(JSON.parse(sample), [], places);
    const edits: [Key[], Edit][] = [];
    for (const [turn, path] of places.entries()) {
      let present: any = JSON.parse(sample);
      for (const key of path) present = present[key];
      for (const edit of editsOfJSON(present, path.length === 0, turn + index)) edits.push([path, edit]);
    }
    for (const [path, [name, edit]] of spread(edits, index ? 4 : 8)) {
      const value = change(sample, path, edit);
      const [got, text] = both(`${nameOf(path)} ${name}`, value);
      if (!got.startsWith("ok") && data.length === 1) data.push([value, text]);
    }
    if (index) continue;
    for (const [turn, path] of spread(places, 4).entries()) {
      const [name, make] = others[(count * 4 + turn) % others.length];
      const value = change(sample, path, set(make));
      say(`${nameOf(path)} = ${name}: ${answer(() => validate(value), value)}`);
    }
  }
  if (!samples.length) for (const text of ["null", "0", '""', "[]", "{}"]) both(text, JSON.parse(text));

  // The same data in another form gets the same answer. Only the forms that don't are printed.
  let same = 0;
  for (const [value, text] of data) {
    const expected = answer(() => validate(value), value);
    for (const [name, form] of forms) {
      const got = answer(() => validate(form(value)), value);
      if (got === expected) same++;
      else say(`${text} ${name}: ${got}`);
    }
    const expectedOfText = answer(() => parse(text), value);
    for (const [name, spell] of spellings) {
      const got = answer(() => parse(spell(text)), value);
      if (got === expectedOfText) same++;
      else say(`${text} ${name}: ${got}`);
    }
    const got = revive ? answer(() => revive(text, (_, item) => item), value) : expectedOfText;
    if (got === expectedOfText) same++;
    else say(`${text} with a reviver: ${got}`);
    if (value === data[0][0]) say(`cut short: ${answer(() => parse(text.slice(0, -1)), value)}`);
  }
  say(`${same} other forms: same`);
}

export function print() {
  console.log(lines.join("\n"));
}
