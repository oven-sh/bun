// A store into a member written as a function type, or declared as a method, refuses what is no function and takes any function, whatever its signature.
interface Handler {
  run: (n: number) => number;
  stop(): void;
}
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
const handler: Handler = { run: n => n + 1, stop() {} };
const notFunctions: [string, any][] = [
  ["a number", 0],
  ["a string", "text"],
  ["a boolean", true],
  ["an object", {}],
  ["an array", []],
  ["a symbol", Symbol("s")],
  ["a bigint", 10n],
  ["a regular expression", /x/],
];
const functions: [string, any][] = [
  ["a function of another signature", (a: string, b: string) => a + b],
  ["a class", class {}],
  ["a bound function", function () {}.bind(null)],
  ["an async function", async () => {}],
  ["a generator function", function* () {}],
  ["undefined", undefined],
  ["null", null],
];
function readRun(h: Handler) { return typeof h.run; }

for (const [label, value] of notFunctions) attempt("run = " + label, () => { handler.run = value; return "stored"; });
for (const [label, value] of notFunctions) attempt("stop = " + label, () => { handler.stop = value; return "stored"; });
attempt("run is what it was", () => handler.run(1));
for (const [label, value] of functions) attempt("run = " + label, () => { handler.run = value; return "stored"; });
for (const [label, value] of functions) attempt("stop = " + label, () => { handler.stop = value; return "stored"; });
attempt("a number stored through any", () => { (handler as any).run = 5; return typeof (handler as any).run; });
attempt("and a typed read of it", () => readRun(handler));
