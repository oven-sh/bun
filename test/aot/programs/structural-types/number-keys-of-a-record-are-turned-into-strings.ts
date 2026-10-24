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

function write(record: Record<number, string>, key: number, value: string): void {
  record[key] = value;
}

function read(record: Record<number, string>, key: number): string {
  return record[key];
}

function width(record: Record<number, string>, key: number): number {
  return record[key].length;
}

let total = 0;
const warm: Record<number, string> = {};
for (let i = 0; i < 2000; i++) {
  write(warm, i % 7, "v" + i);
  total += read(warm, i % 7).length + width(warm, i % 7);
}
console.log("2000 honest rounds: " + total);

const keys = [3, 1, -1, 1.5, -0, 0, NaN, Infinity, -Infinity, 0.1 + 0.2, 1e21, 1e-7, 123456789012345680000, 2 ** 31, 2 ** 32 - 2, 2 ** 32 - 1, 2 ** 53, 2 ** 53 + 1, 0.000001, 1 / 3, 5e-324, 1.7976931348623157e308];
const record: Record<number, string> = {};
for (const key of keys) write(record, key, "at " + show(key));
console.log("keys: " + Object.keys(record).join("|"));
for (const key of keys) attempt("read " + show(key), () => [read(record, key), width(record, key)]);
attempt("what is not there", () => [typeof read(record, 2), typeof read(record, -2), typeof read(record, 0.5)]);
attempt("what is not there: its width", () => width(record, 2));
attempt("what is not there: glued", () => read(record, 2) + "!");

const byText: Record<string, string> = record;
attempt("the same by strings", () => [byText["3"], byText["-1"], byText["1.5"], byText["0"], byText["-0"], byText["NaN"], byText["Infinity"], byText["0.30000000000000004"], byText["1e+21"], byText["1e21"], byText["1e-7"], byText["9007199254740992"], byText["0.000001"]]);

const written: Record<number, string> = {};
written[-0] = "minus zero";
written[1e21] = "large";
written[NaN] = "nan";
written[0.5] = "half";
written[1_000] = "thousand";
written[0b11] = "three";
console.log("written out: " + Object.keys(written).join("|") + " " + JSON.stringify(written));
attempt("written out: reads", () => [written[0], written[-0], written[1e21], written[NaN], written[0.5], written[1000], written[3], typeof written[4]]);

const points: Record<number, { x: number }> = { 1: { x: 1 } };
attempt("objects: there", () => points[1].x);
attempt("objects: not there", () => points[2].x);
attempt("objects: 1.0 and 1", () => points[1.0] === points[1]);
const functions: Record<number, () => number> = { 0: () => 5 };
attempt("functions: there, by minus zero", () => functions[-0]());
attempt("functions: not there", () => functions[1]());

const list: Record<number, string> = ["a", "b"];
attempt("a list behind the record type", () => [read(list, 0), typeof read(list, 2), typeof read(list, -1), Object.keys(list)]);
write(list, 3, "d");
write(list, -1, "minus");
attempt("stored to", () => [Object.keys(list), Array.isArray(list) ? list.length : -1]);
const text: Record<number, string> = "xyz";
attempt("a string behind the record type", () => [read(text, 0), typeof read(text, 3), width(text, 1)]);
attempt("a string behind the record type is stored to", () => write(text, 0, "q"));

export {};
