function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Label {
  id = 1;
  text = "label";
  weight = 0.5;
  size(): number {
    return this.text.length;
  }
  shout(): string {
    return this.text.toUpperCase();
  }
  suffixed(): string {
    return this.text + "!";
  }
}

function put<T>(box: { text: string | T }, value: T): void {
  box.text = value;
}

function sizeOf(box: { text: string }): number {
  return box.text.length;
}

function suffixed(box: { text: string }): string {
  return box.text + "!";
}

function inATemplate(box: { text: string }): string {
  return `<${box.text}>`;
}

function firstCode(box: { text: string }): number {
  return box.text.charCodeAt(0);
}

function firstLetter(box: { text: string }): string {
  return box.text[0];
}

function isEmpty(box: { text: string }): boolean[] {
  return [box.text === "", box.text == "", !box.text];
}

function isFive(box: { text: string }): boolean[] {
  return [box.text === "5", box.text == "5"];
}

function kind(box: { text: string }): string {
  return typeof box.text;
}

function appended(box: { text: string }): string {
  box.text += "x";
  return box.text;
}

const ways: [string, (box: { text: string }) => void][] = [
  ["5", box => put(box, 5)],
  ["0", box => put(box, 0)],
  ["0.5", box => put(box, 0.5)],
  ["undefined", box => put(box, undefined)],
  ["null", box => put(box, null)],
  ["false", box => put(box, false)],
  ["a symbol", box => put(box, Symbol("s"))],
  ["a bigint", box => put(box, 5n)],
  ["an array of strings", box => put(box, ["a", "b"])],
  ["a String object", box => put(box, new String("boxed"))],
  ["an object with toString", box => put(box, { toString: () => "made" })],
  ["an honest string", box => put(box, "honest")],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const literal = { text: "t" + i };
  const label = new Label();
  warm += sizeOf(literal) + suffixed(literal).length + inATemplate(literal).length + firstCode(literal) + firstLetter(literal).length + isEmpty(literal).length + isFive(literal).length;
  warm += kind(literal).length + appended(literal).length + label.size() + label.shout().length + label.suffixed().length + sizeOf(label);
}
console.log("after 2000 honest boxes", warm);

for (const [name, store] of ways) {
  const stored = (): Label => {
    const label = new Label();
    store(label);
    return label;
  };
  attempt(name + ": typeof", () => kind(stored()));
  attempt(name + ": length", () => sizeOf(stored()));
  attempt(name + ": with a suffix", () => suffixed(stored()));
  attempt(name + ": in a template", () => inATemplate(stored()));
  attempt(name + ": first code", () => firstCode(stored()));
  attempt(name + ": first letter", () => firstLetter(stored()));
  attempt(name + ": empty", () => isEmpty(stored()));
  attempt(name + ": the text 5", () => isFive(stored()));
  attempt(name + ": +=", () => appended(stored()));
  attempt(name + ": its own size", () => stored().size());
  attempt(name + ": its own shout", () => stored().shout());
  attempt(name + ": its own suffix", () => stored().suffixed());
  attempt(name + ": the other fields", () => [stored().id, stored().weight, Object.keys(stored())]);
  attempt(name + ": in a literal", () => {
    const literal = { a: 1, text: "t", b: 2 };
    store(literal);
    return [literal.a, kind(literal), literal.b];
  });
}
