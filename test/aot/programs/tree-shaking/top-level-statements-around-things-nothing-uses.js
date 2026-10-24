// Control flow at the top level of a module whose results nothing reads: conditions, loops, try and finally, a label, a block with its own declarations, a switch, a top-level await, and a using declaration. `bun run` and `bun build --compile` print the same.
const log = [];
function effect(name) { log.push(name); return name; }

if (effect("a condition")) {
  const inside = effect("a constant in an arm");
}
for (let i = 0; i < 2; i++) {
  const unused = effect("a loop body " + i);
}
for (const unused of [effect("the list of a for-of")]);
for (const unused in { [effect("a key of a for-in")]: 1 });
while (log.length < 0) effect("never");
try {
  const unused = effect("a try block");
} finally {
  effect("a finally block");
}
{
  let scoped = effect("a bare block");
  function hoistedInBlock() { return effect("never"); }
}
label: {
  const unused = effect("a labeled block");
  break label;
}
switch (effect("a discriminant")) {
  case effect("a case that is compared"):
    break;
  default:
    effect("the default");
}
const awaited = await new Promise(resolve => { effect("an executor"); resolve(1); });
await null;
{
  using resource = { [Symbol.dispose]() { effect("a disposer"); } };
}
var hoisted = effect("a var");
var hoisted = effect("the same var again");

console.log(log.join("\n"));
