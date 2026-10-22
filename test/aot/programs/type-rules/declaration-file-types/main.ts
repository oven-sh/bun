// A type tests a value only where a checked file wrote it. The same alias, interface and function type declared in a `.d.ts` test nothing: the value goes on as in plain Bun.
import type { DeclaredCount, DeclaredHandler, DeclaredPoint } from "./declared";
import { double } from "./helper.js";

type WrittenCount = number;
interface WrittenPoint { x: number; y: number }
type WrittenHandler = (n: number) => number;

const text: any = "text";
const odd: any = { x: "left", y: 2 };
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
function writtenX(p: WrittenPoint) { return p.x; }
function declaredX(p: DeclaredPoint) { return p.x; }

attempt("a variable, alias written here", () => { const n: WrittenCount = text; return typeof n; });
attempt("a variable, alias of the .d.ts", () => { const n: DeclaredCount = text; return typeof n; });
attempt("a cast, alias written here", () => typeof (text as WrittenCount));
attempt("a cast, alias of the .d.ts", () => typeof (text as DeclaredCount));
attempt("a parameter, interface written here, a string", () => writtenX(text));
attempt("a parameter, interface of the .d.ts, a string", () => declaredX(text));
attempt("a field read, interface written here", () => writtenX(odd));
attempt("a field read, interface of the .d.ts", () => declaredX(odd));
attempt("a function type written here, a string", () => { const h: WrittenHandler = text; return typeof h; });
attempt("a function type of the .d.ts, a string", () => { const h: DeclaredHandler = text; return typeof h; });
attempt("a function of a .js file that a .d.ts declares", () => double(text));
attempt("its result in a variable without an annotation", () => { const r = double(text); return typeof r; });
attempt("its result in a variable annotated here", () => { const r: number = double(text); return typeof r; });
