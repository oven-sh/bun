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

class Circle {
  radius = 1;
}

class Square {
  edge = 2;
}

const log: string[] = [];

function edgeOrRadius(s: Circle | Square): unknown {
  if ("edge" in s) return ["edge", s.edge, s.edge * 2];
  return ["radius", s.radius, s.radius * 2];
}

attempt("a circle", () => edgeOrRadius(new Circle()));
attempt("a square", () => edgeOrRadius(new Square()));
for (let i = 0; i < 2000; i++) edgeOrRadius(i % 2 === 0 ? new Circle() : new Square());

attempt("a proxy of a circle that has everything", () =>
  edgeOrRadius(
    new Proxy(new Circle(), {
      has(target, key) {
        log.push("has " + String(key));
        return true;
      },
      get(target, key, receiver) {
        log.push("get " + String(key));
        return Reflect.get(target, key, receiver);
      },
    }),
  ),
);
attempt("a proxy of a square that has nothing", () =>
  edgeOrRadius(
    new Proxy(new Square(), {
      has(target, key) {
        log.push("has " + String(key));
        return false;
      },
      get(target, key, receiver) {
        log.push("get " + String(key));
        return Reflect.get(target, key, receiver);
      },
    }),
  ),
);
attempt("a proxy of a square without traps", () => edgeOrRadius(new Proxy(new Square(), {})));
attempt("a proxy whose has trap throws", () =>
  edgeOrRadius(
    new Proxy(new Circle(), {
      has() {
        throw new RangeError("no");
      },
    }),
  ),
);
console.log("traps: " + log.join(", "));
attempt("a circle again", () => edgeOrRadius(new Circle()));
