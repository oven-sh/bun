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

function reciprocal(x: 0 | 1): number {
  if (x === 0) return 1 / x;
  return x;
}

function zeroText(x: 0 | 1): string {
  return x === 0 ? Object.is(x, 0) + ":" + Object.is(x, -0) : "one";
}

function switchOnZero(x: 0 | 1 | 2): number {
  switch (x) {
    case 0:
      return 10 / x;
    case 1:
      return 10;
    case 2:
      return 5;
  }
}

function common(a: number | string, b: string | boolean): number {
  if (a === b) return a.length + b.length;
  return -1;
}

function looseNull(v: number | null | undefined): number {
  if (v == null) return -1;
  return v + 1;
}

function notUndefined(v: number | undefined): number {
  return v !== undefined ? v + 1 : -1;
}

function sameObject(a: { n: number } | null, b: { n: number }): number {
  if (a === b) return a.n + b.n;
  return -1;
}

function literal(mode: "on" | "off", other: "on" | "auto"): string {
  if (mode === other) return mode + other;
  return "differ";
}

const negativeZero: 0 = -0;

attempt("honest", () => [reciprocal(0), reciprocal(1), zeroText(0), switchOnZero(0), switchOnZero(2), common("ab", "ab"), common(1, true), looseNull(null), looseNull(undefined), looseNull(0), notUndefined(0), literal("on", "on")]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += reciprocal(1) + switchOnZero(i & 1 ? 1 : 2) + common("a", "a") + looseNull(i) + notUndefined(i);
console.log("2000 honest rounds", warm);

attempt("negative zero typed 0: reciprocal", () => reciprocal(negativeZero));
attempt("negative zero typed 0: text", () => zeroText(negativeZero));
attempt("negative zero typed 0: switch", () => switchOnZero(negativeZero));
attempt("negative zero typed 0: written in place", () => reciprocal(-0));
attempt("negative zero typed 0: in a field", () => {
  class Holder {
    x: 0 | 1 = -0;
    read(): number {
      return this.x === 0 ? 1 / this.x : 7;
    }
  }
  return new Holder().read();
});
attempt("negative zero typed 0: in an element", () => {
  const list: (0 | 1)[] = [0, -0, 1];
  return list.map(reciprocal);
});
attempt("negative zero typed 0: as a key", () => {
  const names: Record<0 | 1, string> = { 0: "zero", 1: "one" };
  return names[negativeZero];
});
attempt("negative zero typed 0: in a template", () => `${negativeZero}` + String(negativeZero) + JSON.stringify(negativeZero) + [negativeZero].join());
attempt("negative zero typed 0: in a Map and a Set", () => {
  const m = new Map<0 | 1, string>([[negativeZero, "stored"]]);
  return [m.get(0), [...m.keys()].map(k => Object.is(k, -0)), new Set<0 | 1>([0, negativeZero]).size];
});
attempt("NaN never equals itself", () => {
  const same = (a: number, b: number): string => (a === b ? "same" : a !== a ? "not a number" : "differ");
  return [same(NaN, NaN), same(0, -0), same(1, 1)];
});
attempt("the same object", () => {
  const o = { n: 2 };
  return [sameObject(o, o), sameObject(null, o), sameObject({ n: 2 }, o)];
});
attempt("equal by a getter that changes", () => {
  let reads = 0;
  const o: { readonly mode: "on" | "off" } = {
    get mode(): "on" | "off" {
      return reads++ === 0 ? "on" : "off";
    },
  };
  if (o.mode === "on") return o.mode;
  return "was off";
});
attempt("switch (true)", () => {
  const grade = (n: number | string): string => {
    switch (true) {
      case typeof n === "string":
        return "text " + n.length;
      case typeof n === "number" && n > 5:
        return "big " + n.toFixed(0);
      default:
        return "small " + String(n);
    }
  };
  return [grade("ab"), grade(9), grade(1), grade(NaN)];
});
attempt("honest again", () => [reciprocal(0), reciprocal(1), zeroText(0), switchOnZero(0), common("ab", "ab"), looseNull(null), notUndefined(0)]);
