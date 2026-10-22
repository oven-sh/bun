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

type Action = { kind: "add"; payload: number } | { kind: "name"; payload: string };

class Add {
  kind: "add" = "add";
  payload: number = 1;
}

class Name {
  kind: "name" = "name";
  payload: string = "n";
}

function inTheBody(action: Action): unknown {
  const { kind, payload } = action;
  if (kind === "add") return [kind, payload, payload + 1, payload * 2];
  return [kind, payload, payload.length, payload.toUpperCase()];
}

function inTheParameters({ kind, payload }: Action): unknown {
  if (kind === "add") return [kind, payload, payload + 1, payload * 2];
  return [kind, payload, payload.length, payload.toUpperCase()];
}

function inASwitch({ kind, payload }: Add | Name): unknown {
  switch (kind) {
    case "add":
      return [kind, payload, payload + 1];
    case "name":
      return [kind, payload, payload.length];
  }
}

function all(label: string, make: () => Add | Name): void {
  attempt(label + " in the body", () => inTheBody(make()));
  attempt(label + " in the parameters", () => inTheParameters(make()));
  attempt(label + " in a switch", () => inASwitch(make()));
}

function retag(t: { kind: "add" | "name" }, kind: "add" | "name"): void {
  t.kind = kind;
}

all("an honest add", () => new Add());
all("an honest name", () => new Name());
for (let i = 0; i < 2000; i++) {
  inTheBody(i % 2 === 0 ? new Add() : new Name());
  inTheParameters(i % 2 === 0 ? new Add() : new Name());
  inASwitch(i % 2 === 0 ? new Add() : new Name());
}
all("a name tagged add", () => {
  const n = new Name();
  retag(n, "add");
  return n;
});
all("an add tagged name", () => {
  const a = new Add();
  retag(a, "name");
  return a;
});
attempt("the payload is a getter that runs after the tag", () => {
  const order: string[] = [];
  const action: Action = {
    get kind(): "add" {
      order.push("kind");
      return "add";
    },
    get payload(): number {
      order.push("payload");
      return 5;
    },
  };
  return [inTheBody(action), inTheParameters(action), order.join()];
});
all("an honest add again", () => new Add());
