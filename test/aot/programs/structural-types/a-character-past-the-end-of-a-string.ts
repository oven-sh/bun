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

function letter(text: string, index: number): string {
  return text[index];
}

function letterWidth(text: string, index: number): number {
  return text[index].length;
}

function upper(text: string, index: number): string {
  return text[index].toUpperCase();
}

function code(text: string, index: number): number {
  return text.charCodeAt(index);
}

function count(text: string, wanted: string): number {
  let found = 0;
  for (let i = 0; i <= text.length; i++) if (text[i] === wanted) found++;
  return found;
}

function glueOneTooFar(text: string): string {
  let out = "";
  for (let i = 0; i <= text.length; i++) out += text[i];
  return out;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += letter("abc", i % 3).length + letterWidth("abc", i % 3) + upper("abc", i % 3).length + code("abc", i % 3) + count("abca", "a");
console.log("2000 honest rounds: " + total);

const text = "abc";
attempt("text[99]", () => [typeof text[99], text[99]]);
attempt("text[3]", () => typeof text[3]);
attempt("text[99] === ''", () => text[99] === "");
attempt("text[99] + '!'", () => text[99] + "!");
attempt("text[99].length", () => text[99].length);
attempt("text[-1]", () => typeof text[-1]);
attempt("text[1.5]", () => typeof text[1.5]);
attempt("text[-0]", () => text[-0]);
attempt("text[NaN]", () => typeof text[NaN]);
attempt("text.at", () => [text.at(99), text.at(-1), text.at(-99), text.at(1.9), text.at(NaN), text.at(-0), text.at(Infinity)]);
attempt("text.charAt", () => [text.charAt(99), text.charAt(-1), text.charAt(1.9), text.charAt(NaN), text.charAt(Infinity), text.charAt(2 ** 32)]);
attempt("text.charCodeAt", () => [text.charCodeAt(99), text.charCodeAt(-1), text.charCodeAt(1.9), text.charCodeAt(NaN), text.charCodeAt(2 ** 32)]);
attempt("text.charCodeAt(99) | 0", () => text.charCodeAt(99) | 0);
attempt("text.codePointAt", () => [text.codePointAt(99), text.codePointAt(-1), text.codePointAt(1.9)]);
attempt("text.substring and slice", () => [text.substring(99), text.slice(99), text.slice(-99), text.substring(2, 0), text.slice(2, 0), text.substring(NaN, 1)]);

for (const index of [0, 2, 3, 99, -1, 1.5, -0, NaN, Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 1]) {
  attempt("by a variable " + show(index), () => [typeof letter(text, index), letter(text, index), code(text, index)]);
  attempt("by a variable " + show(index) + ": width", () => letterWidth(text, index));
  attempt("by a variable " + show(index) + ": upper case", () => upper(text, index));
}

attempt("an empty string", () => [typeof ""[0], "".charAt(0), "".charCodeAt(0), "".at(0), "".at(-1)]);
attempt("one too far: counted", () => [count("abca", "a"), count("", "a"), count("undefined", "u")]);
attempt("one too far: glued", () => [glueOneTooFar("ab"), glueOneTooFar("")]);
attempt("half of a pair", () => ["\u{1F600}".length, "\u{1F600}"[0].charCodeAt(0), "\u{1F600}"[1].charCodeAt(0), typeof "\u{1F600}"[2], "\u{1F600}".codePointAt(0), "\u{1F600}".codePointAt(1)]);
attempt("a rope", () => {
  let rope = "";
  for (let i = 0; i < 20; i++) rope += "ab";
  return [rope[39], typeof rope[40], rope.charAt(40), rope.charCodeAt(40)];
});
attempt("'length' in a string object", () => [new String("ab")[5], typeof new String("ab")[1]]);

export {};
