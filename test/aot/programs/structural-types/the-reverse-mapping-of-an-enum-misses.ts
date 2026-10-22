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

enum Color {
  Red,
  Green,
  Blue = 10,
}

enum Mixed {
  No = 0,
  Yes = "YES",
}

enum Bits {
  None = 0,
  Read = 1 << 0,
  Write = 1 << 1,
  Both = Read | Write,
}

function nameOf(color: Color): string {
  return Color[color];
}

function shout(color: Color): string {
  return Color[color].toUpperCase();
}

function widthOf(index: number): number {
  return Color[index].length;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += nameOf(i % 2).length + shout(i % 2).length + widthOf(10);
console.log("2000 honest rounds: " + total);

attempt("members", () => [Color[0], Color[1], Color[10], Color[Color.Blue], nameOf(Color.Green), shout(Color.Red)]);
attempt("Color[999]", () => [typeof Color[999], Color[999]]);
attempt("Color[999].length", () => Color[999].length);
attempt("Color[999] + '!'", () => Color[999] + "!");
attempt("Color[999] === ''", () => Color[999] === "");
attempt("Color[2]: between the members", () => typeof Color[2]);
attempt("Color[-1]", () => typeof Color[-1]);
attempt("Color[0.5]", () => typeof Color[0.5]);
attempt("Color[-0]", () => Color[-0]);
attempt("Color[NaN]", () => typeof Color[NaN]);
attempt("Color[1e1]", () => Color[1e1]);

for (const index of [0, 1, 2, 10, 999, -1, 0.5, -0, NaN, Infinity, 2 ** 32]) {
  attempt("by a variable " + show(index), () => {
    const name: string = Color[index];
    return [typeof name, name];
  });
  attempt("by a variable " + show(index) + ": its width", () => widthOf(index));
}

const large: number = 999;
const outside: Color = large;
attempt("a color that is no member", () => [typeof nameOf(outside), nameOf(outside)]);
attempt("a color that is no member: shouted", () => shout(outside));
attempt("a name used as a key again", () => {
  const name = Color[1];
  return name === "Green" ? Color[name] : -1;
});
attempt("string members have no reverse mapping", () => [Mixed[0], Object.keys(Mixed), typeof Mixed[1]]);
attempt("flags", () => [Bits[0], Bits[1], Bits[2], Bits[3], typeof Bits[4], typeof Bits[Bits.Read | 4]]);
attempt("flags: a combination that is no member, its length", () => Bits[Bits.Write | 4].length);
attempt("the keys of the enum's object", () => Object.keys(Color));

export {};
