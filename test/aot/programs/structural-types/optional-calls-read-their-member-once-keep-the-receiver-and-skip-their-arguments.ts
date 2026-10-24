function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

let log: string[] = [];
function effect<T>(label: string, value: T): T {
  log.push(label);
  return value;
}

interface Tool {
  label: string;
  use?(n: number): string;
  inner?: Tool;
}

class Watched implements Tool {
  label = "watched";
  reads = 0;
  present = true;
  get use(): ((n: number) => string) | undefined {
    this.reads++;
    log.push("get use");
    if (!this.present) return undefined;
    return function (this: Tool, n: number): string {
      return (this === undefined ? "no receiver" : this.label) + " used with " + n;
    };
  }
}

class Flickering implements Tool {
  label = "flickering";
  turn = 0;
  get use(): ((n: number) => string) | undefined {
    return this.turn++ % 2 === 0 ? n => "even turn " + n : undefined;
  }
}

const cases: [string, (tool: Tool | undefined) => unknown][] = [
  ["tool.use?.(n)", tool => (tool === undefined ? "no tool" : tool.use?.(effect("argument", 1)))],
  ["tool?.use?.(n)", tool => tool?.use?.(effect("argument", 1))],
  ["(tool?.use)?.(n)", tool => (tool?.use)?.(effect("argument", 1))],
  ['tool?.["use"]?.(n)', tool => tool?.["use"]?.(effect("argument", 1))],
  ["tool?.use?.call(other, n)", tool => tool?.use?.call({ label: "other" }, effect("argument", 1))],
  ["a copy, then copy?.(n)", tool => {
    const copy = tool?.use;
    return copy?.(effect("argument", 1));
  }],
  ["tool?.inner?.use?.(n)", tool => tool?.inner?.use?.(effect("argument", 1))],
  ["tool?.inner?.inner?.label.length", tool => tool?.inner?.inner?.label.length],
  ["a test and then a call", tool => (tool?.use ? tool.use(effect("argument", 1)) : "absent")],
  ["tool?.use?.(n).length", tool => tool?.use?.(effect("argument", 1)).length],
  ["tool?.use?.(n) ?? default", tool => tool?.use?.(effect("argument", 1)) ?? effect("default", "default")],
];

const absent = new Watched();
absent.present = false;
const nested: Tool = { label: "outer", inner: new Watched() };

const tools: [string, () => Tool | undefined][] = [
  ["no tool", () => undefined],
  ["a literal with the method", () => ({ label: "literal", use(n: number) { return this.label + " used with " + n; } })],
  ["a literal without", () => ({ label: "bare" })],
  ["a getter that gives a function", () => new Watched()],
  ["a getter that gives undefined", () => absent],
  ["a getter that flickers", () => new Flickering()],
  ["nested", () => nested],
];

for (const [form, run] of cases) {
  for (const [label, make] of tools) {
    log = [];
    let outcome: string;
    try {
      outcome = text(run(make()));
    } catch (error) {
      outcome = failure(error);
    }
    console.log(form + ", " + label + ": " + outcome + " [" + log.join(", ") + "]");
  }
}

interface Removable {
  label: string;
  extra?: number;
}
const removable: Removable | undefined = effect<Removable | undefined>("made", { label: "r", extra: 1 });
const nobody: Removable | undefined = effect<Removable | undefined>("made", undefined);
console.log("delete through a chain: " + delete removable?.extra + " " + text(removable));
console.log("delete through a chain that stops: " + delete nobody?.extra);

const tool: Tool = { label: "comes and goes" };
function useIt(t: Tool): string {
  return t.use?.(1) ?? "absent";
}
let present = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) tool.use = n => "first " + n;
  if (i === 1500) delete tool.use;
  if (i === 1800) tool.use = n => "second " + n;
  if (useIt(tool) !== "absent") present++;
}
console.log("the method comes and goes: " + present + ", at the end " + useIt(tool));
