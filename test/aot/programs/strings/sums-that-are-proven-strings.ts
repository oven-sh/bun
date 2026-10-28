// Which sums are strings by proof. A place that TypeScript calls string may hold undefined or null, so the sum of two such places may be a number.
// IRT= 1 ofFunctionResult : string = Add
// IRT= 1 ofRecursiveResult : string = Add
// IRT= 1 ofLiteral : string = Add
// IRT= 1 ofMethodResult : string = Add
// IRT= 1 ofDefault : string = Add
// IRT= 1 ofConstant : string = Add
// IRT= 0 ofParameters : string = Add
// IRT= 0 ofUnprovenResult : string = Add
// IRT= 0 ofReassignedFunction : string = Add
function suffix(name: string | undefined): string { return name ? `@${name}` : ""; }
function repeated(n: number): string { return n > 0 ? "x" + repeated(n - 1) : ""; }
function same(text: string): string { return text; }
function first(list: string[]): string { return list[0]; }
let chosen = function (): string { return "a"; };
if (Date.now() < 0) chosen = () => undefined as unknown as string;

function ofFunctionResult(id: number, name: string | undefined) { return id + suffix(name); }
function ofRecursiveResult(n: number, b: string) { return repeated(n) + b; }
function ofLiteral(a: string) { return a + "!"; }
function ofMethodResult(a: string, b: string) { return a.trim() + b; }
function ofDefault(a: string, b: string) { return (a || "-") + b; }
function ofConstant(a: string, c: boolean) { const mark = c ? "+" : "-"; return mark + a; }
function ofParameters(a: string, b: string) { return a + b; }
function ofUnprovenResult(id: number, text: string) { return id + same(text); }
function ofResultThatMayBeMissing(list: string[], b: string) { return first(list) + b; }
function ofReassignedFunction(b: string) { return chosen() + b; }

const missing = undefined as unknown as string;
for (const text of ["t", missing]) {
  console.log(ofFunctionResult(1, text), ofRecursiveResult(2, text), ofLiteral(text), ofMethodResult("m ", text), ofDefault(text, text), ofConstant(text, text === "t"));
  console.log(ofParameters(text, text), ofUnprovenResult(1, text), ofResultThatMayBeMissing(text === "t" ? ["f"] : [], text), ofReassignedFunction(text));
}
(globalThis as any).kept = [ofFunctionResult, ofRecursiveResult, ofLiteral, ofMethodResult, ofDefault, ofConstant, ofParameters, ofUnprovenResult, ofResultThatMayBeMissing, ofReassignedFunction];
