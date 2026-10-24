function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

type Signal = { type: "key"; code: number } | { type: "key"; name: string } | { type: "click"; x: number; y: number };

function describe(s: Signal): string {
  if (s.type === "key") {
    if ("code" in s) return "code " + (s.code + 1);
    return "name " + s.name.toUpperCase();
  }
  return "click " + (s.x + s.y);
}

function weight(s: Signal): number {
  switch (s.type) {
    case "key":
      return "name" in s ? s.name.length : s.code;
    case "click":
      return s.x * s.y;
  }
}

function both(): { type: "key"; code: number; name: string } {
  return { type: "key", code: 1, name: "one" };
}

const signals: Signal[] = [{ type: "key", code: 65 }, { type: "key", name: "enter" }, { type: "click", x: 2, y: 3 }, both()];

for (const s of signals) {
  attempt("describe " + JSON.stringify(s), () => describe(s));
  attempt("weight " + JSON.stringify(s), () => weight(s));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += weight(signals[i % 3]) + describe(signals[i % 3]).length;
console.log("2000 honest rounds", warm);

attempt("a name member that also has a code of another type", () => {
  const odd: { type: "key"; name: string; code: string } = { type: "key", name: "odd", code: "not a number" };
  const named: { type: "key"; name: string } = odd;
  return describe(named);
});
attempt("a code member that also has a name of another type", () => {
  const odd: { type: "key"; code: number; name: number } = { type: "key", code: 7, name: 8 };
  const coded: { type: "key"; code: number } = odd;
  return weight(coded);
});
attempt("a code that is inherited", () => {
  class Base {
    code = 5;
  }
  class Key extends Base {
    type: "key" = "key";
  }
  return describe(new Key()) + "/" + weight(new Key());
});
attempt("a code on the prototype", () => {
  class Key {
    type: "key" = "key";
    get code(): number {
      log.push("get-code");
      return 9;
    }
  }
  return describe(new Key()) + "/" + weight(new Key());
});
attempt("a code that is present and undefined", () => {
  const partial: { type: "key"; name: string; code?: undefined } = { type: "key", name: "n", code: undefined };
  return describe(partial);
});
attempt("the code is deleted between the test and the read", () => {
  const s: { type: "key"; code?: number; name: string } = { type: "key", code: 1, name: "n" };
  const view: { type: "key"; name: string } = s;
  const seen: Signal = view;
  const first = describe(seen);
  delete s.code;
  return first + "/" + describe(seen);
});
for (const s of signals) attempt("honest again " + JSON.stringify(s), () => describe(s) + "/" + weight(s));
