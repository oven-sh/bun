// @bun
// This tests that Error.prepareStackTrace behaves the same when it is set to undefined as when it was never set.
const orig = Error.prepareStackTrace;

Error.prepareStackTrace = (err, stack) => {
  return orig(err, stack);
};
var stack2, stack;

function twoWrapperLevel() {
  const err = new Error();
  Error.captureStackTrace(err);
  stack = err.stack;

  Error.prepareStackTrace = undefined;
  const err2 = new Error();
  Error.captureStackTrace(err2);
  stack2 = err2.stack;
}

function oneWrapperLevel() {
  // ...
  var a = 123;
  globalThis.a = a;
  // ---

  twoWrapperLevel();
}

oneWrapperLevel();

// The native line column numbers might differ a bit here.
const stackIgnoringLineAndColumn = stack.replaceAll(":12:26", ":NN:NN").replaceAll(/native:.*$/gm, "native)");
const stack2IgnoringLineAndColumn = stack2.replaceAll(":17:26", ":NN:NN").replaceAll(/native:.*$/gm, "native)");
if (stackIgnoringLineAndColumn !== stack2IgnoringLineAndColumn) {
  console.log("\n-----\n");
  console.log(stackIgnoringLineAndColumn);
  console.log("\n-----\n");
  console.log(stack2IgnoringLineAndColumn);
  console.log("\n-----\n");
  throw new Error("Stacks are different");
}
