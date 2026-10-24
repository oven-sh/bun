function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Note {
  title: string;
  body: string;
}

function codes(text: string): string {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i++) parts.push(text.charCodeAt(i).toString(16));
  return parts.join(" ");
}
function uses(note: Note): unknown[] {
  return [codes(note.title), note.title.length, codes(note.body), note.title + note.body === note.title.concat(note.body), note.title === note.body, codes(JSON.stringify(note.title)), note.title.isWellFormed()];
}

const values = ['""', '"a"', '"\\""', '"\\\\"', '"\\/"', '"\\b\\f\\n\\r\\t"', '"\\u0000"', '"\\u0041"', '"\\u00e9"', '"é"', '"\\u65e5"', '"日"', '"\\ud83d\\ude00"', '"😀"', '"\\ud800"', '"\\udc00"', '"\\ude00\\ud83d"', '"a\\ud800b"', '"\\uD83D"', '"\\u2028\\u2029"', '"\u007f"', '"\\uFFFF"', '"\\ufeff"'];
for (const value of values) {
  attempt(codes(value), () => uses(JSON.parse<Note>('{"title":' + value + ',"body":"a"}')));
}
attempt("declared keys written with escapes", () => {
  const note = JSON.parse<Note>('{"\\u0074itle":"t","bod\\u0079":"b"}');
  return [note, Object.keys(note), note.title, note.body];
});
attempt("declared keys written with every letter escaped", () => {
  const note = JSON.parse<Note>('{"\\u0074\\u0069\\u0074\\u006c\\u0065":"t","\\u0062\\u006F\\u0064\\u0079":"b"}');
  return [note, Object.keys(note), note.title, note.body];
});
attempt("keys that only look like the declared ones", () => {
  const note = JSON.parse<Note>('{"title":"t","body":"b","tіtle":"cyrillic","title\\u0000":"nul","Title":"upper","title ":"space"}');
  return [Object.keys(note).map(codes), note.title, note.body];
});
attempt("keys that are lone surrogates", () => {
  const table = JSON.parse<Record<string, number>>('{"\\ud800":1,"\\udc00":2,"\\ud800\\udc00":3,"":4}');
  return [Object.keys(table).map(codes), table["\ud800"], table["\udc00"], table["𐀀"], table[""]];
});
attempt("a text in 16 bits", () => {
  const note = JSON.parse<Note>('{"title":"日本","body":"語","日":"本"}');
  return [note, uses(note)];
});
