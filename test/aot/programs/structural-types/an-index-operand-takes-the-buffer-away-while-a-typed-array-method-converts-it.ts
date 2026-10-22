function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

const log: string[] = [];

function oddNumber(value: number, change: () => void): number {
  const holder: number[] = [];
  const wide: unknown[] = holder;
  wide.push({
    valueOf(): number {
      log.push("valueOf");
      change();
      return value;
    },
  });
  return holder[0];
}

function state(view: Float64Array): string {
  return "length " + view.length + (view.length > 0 ? " values " + Array.from(view).join() : "");
}

function study(title: string, run: (view: Float64Array, odd: (value: number) => number) => unknown): void {
  const changes: [string, (buffer: ArrayBuffer) => void][] = [
    ["nothing", () => {}],
    ["made smaller", buffer => buffer.resize(8)],
    ["made empty", buffer => buffer.resize(0)],
    ["made larger", buffer => buffer.resize(48)],
    ["transferred away", buffer => {
      buffer.transfer();
    }],
  ];
  for (const [name, change] of changes) {
    log.length = 0;
    attempt(title + ", " + name, () => {
      const buffer = new ArrayBuffer(32, { maxByteLength: 64 });
      const view = new Float64Array(buffer);
      view.set([1, 2, 3, 4]);
      const result = run(view, value => oddNumber(value, () => change(buffer)));
      return [result instanceof Float64Array ? state(result) : result, state(view), log.join()];
    });
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const view = new Float64Array([i, 2, 3, 4]);
  warm += view.slice(1).length + view.indexOf(3, 1) + (view.at(1) ?? 0) + view.fill(9, 2).length + view.subarray(1).length;
}
console.log("2000 honest rounds: " + warm);

study("slice(odd)", (view, odd) => view.slice(odd(1)));
study("slice(0, odd)", (view, odd) => view.slice(0, odd(3)));
study("subarray(odd)", (view, odd) => view.subarray(odd(1)));
study("fill(9, odd)", (view, odd) => view.fill(9, odd(1)).length);
study("fill(odd)", (view, odd) => view.fill(odd(9)).length);
study("fill(9, 0, odd)", (view, odd) => view.fill(9, 0, odd(3)).length);
study("copyWithin(odd, 2)", (view, odd) => view.copyWithin(odd(0), 2).length);
study("at(odd)", (view, odd) => view.at(odd(3)));
study("with(odd, 9)", (view, odd) => view.with(odd(3), 9));
study("with(3, odd)", (view, odd) => view.with(3, odd(9)));
study("indexOf(4, odd)", (view, odd) => view.indexOf(4, odd(1)));
study("includes(4, odd)", (view, odd) => view.includes(4, odd(1)));
study("lastIndexOf(4, odd)", (view, odd) => view.lastIndexOf(4, odd(3)));
study("set([9], odd)", (view, odd) => view.set([9], odd(3)));
study("set([odd])", (view, odd) => view.set([odd(9), 8], 2));
study("view[3] = odd", (view, odd) => (view[3] = odd(9)) === undefined);
study("view[0] = odd", (view, odd) => typeof (view[0] = odd(9)));
study("new Float64Array(buffer, 0, odd)", (view, odd) => new Float64Array(view.buffer, 0, odd(2)));
study("new Float64Array(buffer, odd)", (view, odd) => new Float64Array(view.buffer, odd(8)));

export {};
