// Statements that only store: into a variable nothing reads, into a property of a function nothing calls, into a prototype, into a setter. The right-hand sides run, and so does the setter. `bun run` and `bun build --compile` print the same.
const log = [];
function effect(name) { log.push(name); return name; }

let never;
never = effect("stored into a variable");
var alsoNever = 1;
alsoNever += effect("added to a variable").length;

function Unused() {}
Unused.label = effect("stored into a property of a function");
Unused.prototype.method = effect("stored into a prototype");

const target = { set value(v) { effect("a setter got " + v); } };
target.value = "x";

const frozen = Object.freeze({ a: 1 });
try {
  (() => { "use strict"; frozen.a = effect("stored into a frozen object"); })();
} catch (error) {
  log.push(error.constructor.name);
}

console.log(log.join("\n"));
