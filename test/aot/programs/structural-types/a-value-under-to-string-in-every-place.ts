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

type Held = { toString(): string };

function honest(seed: number): Held {
  return { toString: () => "honest " + seed };
}

const visitors: [string, Held][] = [
  ["7", 7],
  ["-0", -0],
  ["0.5", 0.5],
  ["a string", "text"],
  ["an empty string", ""],
  ["true", true],
  ["false", false],
  ["a symbol", Symbol("s")],
  ["a bigint", 10n],
  ["a built-in function", Math.max],
  ["an array", [1, 2]],
];

function pick(index: number): Held {
  return index < 0 ? honest(index) : visitors[index][1];
}

function inAParameter(held: Held): unknown {
  return held.toString();
}

function inALocal(index: number): unknown {
  const local: Held = pick(index);
  return [typeof local, local.toString()];
}

function inALocalThatChanges(index: number): unknown {
  let local: Held = honest(1);
  const seen: unknown[] = [];
  for (let round = 0; round < 3; round++) {
    seen.push(local.toString());
    local = round === 0 ? pick(index) : honest(2);
  }
  return seen;
}

class Box {
  before = 1;
  held: Held;
  after = 2.5;
  constructor(held: Held) {
    this.held = held;
  }
  use(): unknown {
    return this.held.toString();
  }
}

class Hidden {
  #held: Held;
  static latest: Held = honest(0);
  constructor(held: Held) {
    this.#held = held;
  }
  use(): unknown {
    return this.#held.toString();
  }
  static use(): unknown {
    return Hidden.latest.toString();
  }
}

function inAnElement(list: Held[], index: number): unknown {
  return list[index].toString();
}

function inEveryElement(list: Held[]): unknown[] {
  const seen: unknown[] = [];
  for (const held of list) seen.push(held.toString());
  return seen;
}

function inAMapValue(map: Map<string, Held>, key: string): unknown {
  const held = map.get(key);
  return held === undefined ? "missing" : held.toString();
}

function inARecord(record: Record<string, Held>, key: string): unknown {
  return record[key].toString();
}

function inATuple(pair: [number, Held]): unknown {
  return [pair[0], pair[1].toString()];
}

function captured(start: Held): { use(): unknown; put(next: Held): void } {
  let held = start;
  return {
    use: () => held.toString(),
    put(next) {
      held = next;
    },
  };
}

function orNull(held: Held | null): unknown {
  return held === null ? "null" : held.toString();
}

function orUndefined(held?: Held): unknown {
  return held === undefined ? "undefined" : held.toString();
}

function generic<T extends Held>(held: T): unknown {
  return held.toString();
}

function withADefault(held: Held = honest(3)): unknown {
  return held.toString();
}

function inAnOptionalMember(holder: { held?: Held }): unknown {
  return holder.held === undefined ? "absent" : holder.held.toString();
}

let shared: Held = honest(4);
function inAModuleVariable(): unknown {
  return shared.toString();
}

const reusedBox = new Box(honest(5));
const reusedCapture = captured(honest(6));
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const held = honest(i);
  reusedBox.held = held;
  reusedCapture.put(held);
  shared = held;
  Hidden.latest = held;
  const results = [
    inAParameter(held), inALocal(-1), inALocalThatChanges(-1), new Box(held).use(), reusedBox.use(), new Hidden(held).use(), Hidden.use(),
    inAnElement([held, held], 1), inEveryElement([held]), inAMapValue(new Map([["k", held]]), "k"), inARecord({ k: held }, "k"), inATuple([i, held]),
    reusedCapture.use(), orNull(held), orNull(null), orUndefined(held), orUndefined(), generic(held), withADefault(held), withADefault(),
    inAnOptionalMember({ held }), inAnOptionalMember({}), inAModuleVariable(),
  ];
  warm += results.length;
}
console.log("after 2000 honest values", warm);

for (let index = 0; index < visitors.length; index++) {
  const [name, value] = visitors[index];
  attempt(name + ": a parameter", () => inAParameter(value));
  attempt(name + ": a result", () => pick(index).toString());
  attempt(name + ": a local", () => inALocal(index));
  attempt(name + ": a local that changes", () => inALocalThatChanges(index));
  attempt(name + ": a field of a new object", () => {
    const box = new Box(value);
    return [box.before, box.use(), box.after];
  });
  attempt(name + ": a field of an old object", () => {
    reusedBox.held = value;
    return [reusedBox.before, reusedBox.use(), reusedBox.after];
  });
  attempt(name + ": a private field", () => new Hidden(value).use());
  attempt(name + ": a static field", () => {
    Hidden.latest = value;
    return Hidden.use();
  });
  attempt(name + ": an element", () => inAnElement([honest(7), value, honest(8)], 1));
  attempt(name + ": every element", () => inEveryElement([honest(7), value, honest(8), value]));
  attempt(name + ": a map value", () => inAMapValue(new Map([["k", value]]), "k"));
  attempt(name + ": a record entry", () => inARecord({ k: value }, "k"));
  attempt(name + ": a place of a tuple", () => inATuple([1, value]));
  attempt(name + ": a captured variable", () => {
    reusedCapture.put(value);
    return [reusedCapture.use(), captured(value).use()];
  });
  attempt(name + ": beside null", () => orNull(value));
  attempt(name + ": an optional parameter", () => orUndefined(value));
  attempt(name + ": a generic", () => generic(value));
  attempt(name + ": a parameter with a default", () => withADefault(value));
  attempt(name + ": an optional member", () => inAnOptionalMember({ held: value }));
  attempt(name + ": a module variable", () => {
    shared = value;
    return inAModuleVariable();
  });
  attempt(name + ": honest again", () => [inAParameter(honest(9)), new Box(honest(9)).use(), inAnElement([honest(9)], 0)]);
}
