// Outside strict mode a function declared in a block also becomes a variable of the function or module around it, once the block has run. Here: both arms of an if, a bare block, a labeled declaration and a try block. Plain Bun has no such variable for the function in the two arms and throws a ReferenceError, so the output is stored.
console.log(typeof inArm, typeof inBlock, typeof inTry);

if (process.argv.length > 0) {
  function inArm() {
    return "the first arm, " + helperOfFirstArm();
  }
} else {
  function inArm() {
    return "the second arm, " + helperOfSecondArm();
  }
}
console.log(inArm());

{
  function inBlock() {
    return "in a block, " + helperOfBlock();
  }
}
console.log(inBlock());

label: function labeled() {
  return "labeled, " + helperOfLabeled();
}
console.log(labeled());

try {
  function inTry() {
    return "in try, " + helperOfTry();
  }
} finally {
}
console.log(inTry());

function helperOfFirstArm() { return "helper of the first arm"; }
function helperOfSecondArm() { return "helper of the second arm"; }
function helperOfBlock() { return "helper of the block"; }
function helperOfLabeled() { return "helper of the labeled one"; }
function helperOfTry() { return "helper of try"; }
