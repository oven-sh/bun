// A built-in that lets in code is called through a bound function that binds no argument: the text runs, the module is loaded, and what they reach is there.
const evaluate = eval.bind(null);
const make = Function.bind(null);
globalThis.reachedByText = () => "reached";
console.log(evaluate("reachedByText() + ' by eval'"));
console.log(make("return reachedByText() + ' by Function'")());
const load = process.getBuiltinModule.bind(process);
console.log(typeof load(["node:", "path"].join("")).join);
const apply = Reflect.apply.bind(Reflect);
console.log(apply(eval, null, ["reachedByText() + ' by Reflect.apply'"]));
const call = Function.prototype.call.bind(eval);
console.log(call(null, "reachedByText() + ' by call'"));
