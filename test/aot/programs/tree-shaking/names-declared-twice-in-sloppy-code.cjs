// Outside strict mode one name may be declared several times at the top level: var twice, var and function, function twice, var in a block and outside, var in a loop, var in both arms. The last store counts, and functions come first.
var twice = "first";
var twice = "second";
var varAndFunction = "the var wins once its statement ran";
function varAndFunction() { return "the function"; }
function functionTwice() { return "first"; }
function functionTwice() { return "second"; }
var inBlock = "outside";
{
  var inBlock = "inside the block";
}
for (var inLoop = 0; inLoop < 3; inLoop++) var madeInLoop = "made in a loop " + inLoop;
if (twice) {
  var inArm = "the first arm";
} else {
  var inArm = "the second arm";
}
var neverRead = 1;
var neverRead = 2;
var unusedThenFunction = 1;
function unusedThenFunction() {}
try {
  var inTry = "in try";
} catch (error) {
  var inCatch = "in catch";
}
switch (1) {
  case 1:
    var inSwitch = "in a switch";
}
label: var labeled = "labeled";

console.log(twice, varAndFunction, functionTwice(), inBlock, inLoop, madeInLoop, inArm, inTry, inCatch, inSwitch, labeled);
console.log(typeof globalThis.twice, typeof globalThis.functionTwice, typeof this.twice);
