function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Flag {
  None = 0,
  Read = 1,
  Write = 2,
  Run = 4,
}

const labels: Record<Flag, string> = { [Flag.None]: "none", [Flag.Read]: "read", [Flag.Write]: "write", [Flag.Run]: "run" };
const words = ["zero", "one", "two", "three", "four"];

function nameOf(flag: Flag): string {
  switch (flag) {
    case Flag.None:
      return "none";
    case Flag.Read:
      return "read";
    case Flag.Write:
      return "write";
    case Flag.Run:
      return "run";
  }
}

function has(flags: Flag, one: Flag): boolean {
  return (flags & one) === one;
}

function add(flags: Flag, one: Flag): Flag {
  return flags | one;
}

function remove(flags: Flag, one: Flag): Flag {
  return flags & ~one;
}

class Entry {
  mode: Flag = Flag.None;
  grant(one: Flag): this {
    this.mode |= one;
    return this;
  }
  describe(): string {
    return nameOf(this.mode) + "/" + Flag[this.mode] + "/" + labels[this.mode];
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const flag: Flag = 1 << (i % 3);
  warm += nameOf(flag).length + labels[flag].length + Flag[flag].length + (has(flag, Flag.Read) ? 1 : 0);
}
console.log("2000 honest rounds", warm);

const made: [string, Flag][] = [
  ["read | write", Flag.Read | Flag.Write],
  ["all three", Flag.Read | Flag.Write | Flag.Run],
  ["~read", ~Flag.Read],
  ["~none", ~Flag.None],
  ["run + 1", Flag.Run + 1],
  ["run << 29", Flag.Run << 29],
  ["run * 2 ** 29", Flag.Run * 2 ** 29],
  ["~read >>> 0", ~Flag.Read >>> 0],
  ["read / 2", Flag.Read / 2],
  ["-none", -Flag.None],
  ["read % none", Flag.Read % Flag.None],
];

for (const [label, flag] of made) {
  attempt(label + " value", () => flag);
  attempt(label + " name", () => nameOf(flag));
  attempt(label + " length of the name", () => nameOf(flag).length);
  attempt(label + " reverse", () => Flag[flag]);
  attempt(label + " label", () => labels[flag]);
  attempt(label + " word", () => words[flag]);
  attempt(label + " has read, write, run", () => [has(flag, Flag.Read), has(flag, Flag.Write), has(flag, Flag.Run)]);
  attempt(label + " add and remove", () => [add(flag, Flag.Run), remove(flag, Flag.Read), remove(add(flag, Flag.Run), flag)]);
  attempt(label + " in a field", () => {
    const entry = new Entry();
    entry.mode = flag;
    return [entry.mode, entry.describe(), entry.grant(Flag.Write).mode];
  });
}

attempt("granted one by one", () => new Entry().grant(Flag.Read).grant(Flag.Run).describe());
attempt("honest again", () => [nameOf(Flag.Run), labels[Flag.Write], Flag[Flag.Read], new Entry().grant(Flag.Write).describe()]);
