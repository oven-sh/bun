// Strings over 2^31 - 1 characters: the RangeError comes from the same concatenation as in plain Bun, with the same side effects before it.
const log: string[] = [];
function doubled(times: number): string {
  let text = "x";
  for (let i = 0; i < times; i++) text = text + text;
  return text;
}
const powers: string[] = [];
for (let k = 0; k <= 30; k++) powers.push(doubled(k));
const big = powers[30]!;
const half = powers[29]!;

function noisy(label: string, text: string): string {
  log.push(label);
  return text;
}
function attempt(label: string, run: () => string): void {
  log.length = 0;
  let outcome: string;
  try {
    outcome = "length " + run().length;
  } catch (error) {
    outcome = (error as Error).name + ": " + (error as Error).message;
  }
  console.log(label, outcome, log.join(","));
}

function wrap(label: string, text: string, times: number): string {
  let html = "<w>";
  for (let i = 0; i < times; i++) {
    log.push(label + i);
    html += `[${text}]`;
  }
  return html + "</w>";
}
function pair(a: string, b: string): string {
  return `${noisy("a", a)}${wrap("p", b, 1)}${noisy("c", "c")}`;
}
function nested(a: string, b: string, times: number): string {
  return `<n>${noisy("first", a)}${wrap("n", b, times)}${noisy("last", "!")}</n>`;
}
function conditional(a: string, b: string, flag: boolean): string {
  return `<c>${a}${flag ? `(${wrap("t", b, 1)})` : `{${noisy("f", b)}}`}${noisy("end", ".")}</c>`;
}
function everyPower(from: number): string {
  let text = "";
  for (let k = from; k <= 30; k++) text += powers[k]!;
  return text;
}

attempt("small", () => pair("a", "b"));
attempt("half half", () => pair(half, half));
attempt("big half", () => pair(big, half));
attempt("big big", () => pair(big, big));
attempt("inner alone", () => nested("a", big, 2));
attempt("inner alone 3", () => nested("a", big, 3));
attempt("outer only", () => nested(big, half, 1));
attempt("outer only 2", () => nested(big, half, 2));
attempt("conditional true", () => conditional(big, big, true));
attempt("conditional false", () => conditional(big, big, false));
attempt("conditional fits", () => conditional(half, half, true));
attempt("every power", () => everyPower(0));
attempt("every power and one", () => everyPower(0) + "y");
attempt("every power in a template", () => `${everyPower(0)}${noisy("after", "")}`);
attempt("one too many in a template", () => `${everyPower(0)}${noisy("after", "z")}`);
attempt("after all that", () => nested("a", "b", 3));
console.log(nested("a", "b", 2), conditional("p", "q", true), conditional("p", "q", false));
