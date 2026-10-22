// The same functions and class, written in a `.ts` file with annotations and in a `.js` file with JSDoc types. Only the `.ts` file's types are tested, whoever calls.
import * as checked from "./checked";
import * as inferred from "./inferred.js";

const eight: any = "8";
const seven: any = 7;
const numbered: any = { name: 5 };
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}

attempt("a parameter, .ts", () => checked.half(eight));
attempt("a parameter, .js", () => inferred.half(eight));
attempt("a parameter of a method, .ts", () => new checked.Meter().raise(eight));
attempt("a parameter of a method, .js", () => new inferred.Meter().raise(eight));
attempt("an object type given a number, .ts", () => checked.label(seven));
attempt("an object type given a number, .js", () => inferred.label(seven));
attempt("a field of another kind, .ts", () => checked.label(numbered));
attempt("a field of another kind, .js", () => inferred.label(numbered));
attempt("the .js file calls the .ts function", () => inferred.callWithText(checked.half));
attempt("the .js file calls the .js function", () => inferred.callWithText(inferred.half));
