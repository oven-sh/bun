function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare var evaluatedVar: number;
declare let evaluatedLet: number;
declare const evaluatedConst: number;
declare function evaluatedFunction(n: number): number;
declare class EvaluatedClass {
  size: number;
  grow(): number;
}
declare var madeByFunction: number;

function readVar(): number {
  return evaluatedVar;
}

function readLet(): number {
  return evaluatedLet;
}

function kinds(): string[] {
  return [typeof evaluatedVar, typeof evaluatedLet, typeof evaluatedConst, typeof evaluatedFunction, typeof EvaluatedClass, typeof madeByFunction];
}

const evaluate = eval;

show("before", () => kinds());
show("before: read", () => readVar());

evaluate("var evaluatedVar = '5';");
evaluate("let evaluatedLet = [1];");
evaluate("const evaluatedConst = null;");
evaluate("function evaluatedFunction(n) { return String(n) + n; }");
evaluate("class EvaluatedClass { constructor() { this.width = 1; } grow() { return 'grown'; } }");
new Function("globalThis.madeByFunction = true;")();

show("after", () => kinds());
show("the var is text", () => [evaluatedVar, readVar(), evaluatedVar + 1, readVar() * 2]);
show("the let is a list", () => [evaluatedLet, readLet(), typeof readLet()]);
show("the let plus one", () => readLet() + 1);
show("the const is null", () => [evaluatedConst, evaluatedConst + 1]);
show("the function answers text", () => [evaluatedFunction(2), evaluatedFunction(2) + 1, typeof evaluatedFunction(2)]);
show("the class has other members", () => {
  const made = new EvaluatedClass();
  return [made.size, made.size + 1, made.grow(), Object.keys(made)];
});
show("the one made by a function is a boolean", () => [madeByFunction, madeByFunction + 1]);
show("which of them the global object has", () => ["evaluatedVar", "evaluatedLet", "evaluatedConst", "evaluatedFunction", "EvaluatedClass", "madeByFunction"].map(name => name in globalThis));

show("a store to the var", () => {
  evaluatedVar = 7;
  return [evaluatedVar, readVar(), evaluate("evaluatedVar")];
});
show("a store to the let", () => {
  evaluatedLet = 8;
  return [evaluatedLet, readLet(), evaluate("evaluatedLet")];
});
show("evaluated text stores to the let", () => {
  evaluate("evaluatedLet = 'again text'");
  return [evaluatedLet, readLet()];
});

evaluate("evaluatedVar = 3; evaluatedLet = 4;");
let sum = 0;
for (let i = 0; i < 2000; i++) sum += readVar() + readLet();
show("2000 honest reads", () => sum);
evaluate("evaluatedVar = 'x'; evaluatedLet = 'y';");
show("then text again", () => [readVar(), readLet(), readVar() + readLet()]);
