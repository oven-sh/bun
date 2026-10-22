function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Args = [kind: "add", payload: number] | [kind: "name", payload: string];

const handle: (...args: Args) => unknown = (kind, payload) => {
  if (kind === "add") return [kind, payload, payload + 1, payload * 2];
  return [kind, payload, payload.length, payload.toUpperCase()];
};

function declared(...args: Args): unknown {
  const [kind, payload] = args;
  if (kind === "add") return [kind, payload, payload + 1, payload * 2];
  return [kind, payload, payload.length, payload.toUpperCase()];
}

function byIndex(...args: Args): unknown {
  if (args[0] === "add") return [args[0], args[1], args[1] + 1];
  return [args[0], args[1], args[1].length];
}

const inASwitch: (...args: Args) => unknown = (kind, payload) => {
  switch (kind) {
    case "add":
      return payload + 1;
    case "name":
      return payload.length;
  }
};

const all: [string, (...args: Args) => unknown][] = [
  ["an arrow function", handle],
  ["a rest parameter taken apart", declared],
  ["a rest parameter read by index", byIndex],
  ["a switch", inASwitch],
];

function mixedUp(kind: "add" | "name"): Args {
  const args: Args = kind === "add" ? ["add", 1] : ["name", "n"];
  const loose: (string | number)[] = args;
  loose[1] = kind === "add" ? "text" : 5;
  return args;
}

function short(): Args {
  const args: Args = ["add", 1];
  const loose: (string | number)[] = args;
  loose.pop();
  return args;
}

for (const [name, f] of all) attempt("honest: " + name, () => [f("add", 1), f("name", "n")]);
for (let i = 0; i < 2000; i++) for (const [, f] of all) i % 2 === 0 ? f("add", i) : f("name", "n");
for (const [name, f] of all) {
  attempt("add with a string: " + name, () => f(...mixedUp("add")));
  attempt("name with a number: " + name, () => f(...mixedUp("name")));
  attempt("add with nothing: " + name, () => f(...short()));
  attempt("through apply: " + name, () => f.apply(undefined, mixedUp("add")));
}
for (const [name, f] of all) attempt("honest again: " + name, () => [f("add", 1), f("name", "n")]);
