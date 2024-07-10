// @bun
// This tests that Error.prepareStackTrace behaves the same when it is set to undefined as when it was never set.
const orig = Error.prepareStackTrace;

Error.prepareStackTrace = (err, stack) => {
  return orig(err, stack);
};

const err = new Error();
Error.captureStackTrace(err);
const stack = err.stack;

Error.prepareStackTrace = undefined;
const err2 = new Error();
Error.captureStackTrace(err2);
const stack2 = err2.stack;

const stackIgnoringLineAndColumn = stack.replaceAll(":10:24", "N");
const stack2IgnoringLineAndColumn = stack2.replaceAll(":15:24", "N");
if (stackIgnoringLineAndColumn !== stack2IgnoringLineAndColumn) {
  console.log(stackIgnoringLineAndColumn);
  console.log(stack2IgnoringLineAndColumn);
  throw new Error("Stacks are different");
}
