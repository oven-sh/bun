// `typeof x === "string"` is decided at the build where x is a string by how it is made: a literal, a template, a conversion, or a choice between such. What may be something else is still asked at run time.
// IR= 2 every TypeOfIs
// IR= 2 others TypeOfIs
// IR= 1 inALoop TypeOfIs
function wrap(text: string): unknown {
  return `<${text}>`;
}
function pick(text: string, yes: boolean): unknown {
  if (yes) return `<${text}>`;
  return "";
}
function pickOther(text: string, yes: boolean): unknown {
  if (yes) return `<${text}>`;
  return 5;
}
function made(text: string): string {
  const x = wrap(text);
  return typeof x === "string" ? x + "!" : "no string";
}
function chosen(text: string, yes: boolean): string {
  const x = pick(text, yes);
  if (typeof x !== "string") return "no string";
  return x + "!";
}
function chosenTwice(text: string, yes: boolean, again: boolean): string {
  const x = again ? pick(text, yes) : String(text.length);
  return typeof x === "number" ? "a number" : typeof x === "string" ? "a string" : "neither";
}
function given(x: unknown): string {
  return typeof x === "string" ? x + "!" : "no string";
}
function mixed(text: string, yes: boolean): string {
  const x = pickOther(text, yes);
  return typeof x === "string" ? x + "!" : "no string";
}
function inALoop(texts: unknown[]): string {
  let x: unknown = "";
  for (const text of texts) x = typeof x === "string" ? text : `${x}`;
  return String(x);
}
function every(texts: string[], lines: string[]): void {
  for (const text of texts) {
    for (const yes of [true, false]) lines.push(made(text), chosen(text, yes), chosenTwice(text, yes, true), chosenTwice(text, yes, false));
  }
}
function others(texts: string[], lines: string[]): void {
  for (const text of texts) {
    for (const yes of [true, false]) lines.push(mixed(text, yes), given(yes ? text : 5));
  }
}
const lines: string[] = [];
every(["a", "b"], lines);
every([""], lines);
others(["c"], lines);
others(["", "d"], lines);
lines.push(given(null), given({}), inALoop(["a", 1, "b"]), inALoop([1, 2]), inALoop([]));
console.log(lines.join("\n"));
