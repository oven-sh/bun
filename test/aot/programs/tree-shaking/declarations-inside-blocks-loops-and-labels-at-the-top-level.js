// What stands inside a block, a loop, a label, an arm or a try at the top level is not a declaration of the top level, except a var. Some of it is used after the block, some inside, some nowhere, and an arm that a constant condition removes declares a var all the same.
const log = [];
{
  const insideOnly = "read inside its block";
  const unusedInside = { a: 1 };
  var leaks = "a var leaks out of a block";
  class InBlock { name() { return "a class in a block"; } }
  log.push(insideOnly, new InBlock().name());
}
for (var counter = 0; counter < 2; counter++) {
  const perTurn = "turn " + counter;
  var lastTurn = perTurn;
}
label: {
  var inLabel = "a var in a labeled block";
  const unusedInLabel = 1;
  break label;
}
if (false) {
  var neverAssigned = "never";
  const neverEvaluated = log.push("never");
}
if (log.length) {
  var inArm = "a var in an arm";
  let unusedInArm = [1];
}
try {
  var inTry = "a var in try";
  const unusedInTry = "x";
} finally {
  var inFinally = "a var in finally";
}
while (true) {
  var inWhile = "a var in while";
  break;
}
var unusedInNoBlock = 1;
log.push(leaks, counter, lastTurn, inLabel, String(neverAssigned), inArm, inTry, inFinally, inWhile);
console.log(log.join("\n"));
