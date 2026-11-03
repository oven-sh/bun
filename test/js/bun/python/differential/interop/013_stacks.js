import m from "./013_stacks.py";
import python from "bun:python";
const print = (...values) => console.log(values.map(String).join(" "));
const b = python.import("builtins");
// JSC asks the functions on the stack, and any function handed to Function.prototype.toString(), for their names.
const ts = Function.prototype.toString;
print(ts.call(m.call), "|", ts.call(m.K), "|", ts.call(b.len), "|", ts.call(b.int), "|", ts.call([].constructor === Array ? b.str.upper : 0), "|", ts.call("x".constructor === String ? b.dict().get : 0));
for (const f of [new m.K(() => 1).method, new m.K(() => 1)]) { try { print(ts.call(f)); } catch (e) { print(e.name); } }
const names = stack => stack.split("\n").map(l => l.trim().replace(/^at /, "").split(/[ @(]/)[0]).filter(n => n && !n.startsWith("/") && n != "Error:" && n != "module" && n != "<anonymous>" && n != "moduleEvaluation" && n != "asyncFunctionResume" && n != "loadAndEvaluateModule" && n != "processTicksAndRejections").slice(0, 3).join(",");
function capture() { return new Error("here").stack; }
print(names(m.call(capture)));
print(names(m.call_sorted(x => { globalThis.s1 = capture(); return x; }) && globalThis.s1));
print(names(m.call_map(capture)[0]));
print(names(new m.K(capture).v));
print(names(new m.K(() => 1).method(capture)));
print(names(new m.K(() => 1)(capture)));
print(names([...m.gen(capture)][0]));
print(names(b.max([1], python.kwargs({ key: x => { globalThis.s2 = capture(); return x; } })) && globalThis.s2));
