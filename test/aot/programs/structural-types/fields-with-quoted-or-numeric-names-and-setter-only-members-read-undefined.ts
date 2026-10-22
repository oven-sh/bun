function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Quoted {
  "size": number;
  "two words": string;
  0: number;
  1.5: string;
  plain: number = 1;
  total(): number {
    return this.size + this[0] + this.plain;
  }
  words(): number {
    return this["two words"].length;
  }
}

const quoted = new Quoted();
show("size", () => quoted.size);
show("size + 1", () => quoted.size + 1);
show("two words", () => quoted["two words"]);
show("words", () => quoted.words());
show("0", () => quoted[0]);
show("0 + 1", () => quoted[0] + 1);
show("1.5", () => quoted[1.5]);
show("total", () => quoted.total());
show("keys", () => Object.keys(quoted).join());
quoted.size = 2;
quoted[0] = 3;
show("total when set", () => quoted.total());
show("keys when set", () => Object.keys(quoted).join());

class WriteOnly {
  stored: number = 0;
  set level(v: number) {
    this.stored = v;
  }
  static set mode(v: string) {}
}
const writeOnly = new WriteOnly();
writeOnly.level = 5;
show("setter only: read", () => writeOnly.level);
show("setter only: read + 1", () => writeOnly.level + 1);
show("setter only: stored", () => writeOnly.stored);
show("setter only: +=", () => (writeOnly.level += 1));
show("setter only: stored after +=", () => writeOnly.stored);
show("static setter only", () => WriteOnly.mode);
show("static setter only: length", () => WriteOnly.mode.length);

const literal = {
  kept: "",
  set name(v: string) {
    this.kept = v;
  },
};
literal.name = "given";
show("literal setter only: read", () => literal.name);
show("literal setter only: length", () => literal.name.length);
show("literal kept", () => literal.kept);

function levelOf(o: { level: number }): number {
  return o.level;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += levelOf({ level: 1 });
show("2000 plain objects", () => sum);
show("then the setter-only one", () => levelOf(writeOnly));

function tool(): number {
  return tool.size;
}
show("a member of a function, before it is assigned", tool);
show("plus one", () => tool() + 1);
tool.size = 4;
show("afterwards", tool);
