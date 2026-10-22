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

function study(title: string, run: (list: number[], odd: (value: number) => number) => unknown): void {
  const changes: [string, (list: number[]) => void][] = [
    ["nothing", () => {}],
    ["emptied", list => (list.length = 0)],
    ["cut to 1", list => (list.length = 1)],
    ["made 8 long", list => (list.length = 8)],
    ["pushed to", list => list.push(0.5)],
    ["a far store", list => (list[2000] = 7)],
  ];
  for (const [name, change] of changes) {
    log.length = 0;
    attempt(title + ", " + name, () => {
      const list = [1, 2, 3, 4];
      const result = run(list, value => oddNumber(value, () => change(list)));
      return [result, list.length > 40 ? "length " + list.length : list, log.join()];
    });
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const list = [i, 2, 3, 4];
  warm += list.slice(1).length + list.indexOf(3, 1) + (list.at(1) ?? 0) + list.fill(9, 2).length + list.splice(1, 1).length;
}
console.log("2000 honest rounds: " + warm);

study("slice(odd)", (list, odd) => list.slice(odd(1)));
study("slice(0, odd)", (list, odd) => list.slice(0, odd(3)));
study("splice(odd, 1)", (list, odd) => list.splice(odd(1), 1));
study("splice(1, odd)", (list, odd) => list.splice(1, odd(2)));
study("splice(1, odd, 9)", (list, odd) => list.splice(1, odd(1), 9));
study("fill(9, odd)", (list, odd) => list.fill(9, odd(1)).length);
study("fill(9, 0, odd)", (list, odd) => list.fill(9, 0, odd(3)).length);
study("copyWithin(odd, 2)", (list, odd) => list.copyWithin(odd(0), 2).length);
study("copyWithin(0, odd)", (list, odd) => list.copyWithin(0, odd(2)).length);
study("at(odd)", (list, odd) => list.at(odd(3)));
study("at(-odd)", (list, odd) => list.at(odd(-1)));
study("with(odd, 9)", (list, odd) => list.with(odd(3), 9));
study("indexOf(4, odd)", (list, odd) => list.indexOf(4, odd(1)));
study("includes(4, odd)", (list, odd) => list.includes(4, odd(1)));
study("lastIndexOf(4, odd)", (list, odd) => list.lastIndexOf(4, odd(3)));
study("toSpliced(odd, 1)", (list, odd) => list.toSpliced(odd(1), 1));
study("flat(odd)", (list, odd) => list.flat(odd(1)));
study("length = odd", (list, odd) => (list.length = odd(2)));
study("push(odd)", (list, odd) => typeof list[list.push(odd(5)) - 1]);

export {};
