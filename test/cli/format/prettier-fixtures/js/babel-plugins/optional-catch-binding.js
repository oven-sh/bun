// https://babeljs.io/docs/babel-plugin-proposal-optional-catch-binding

try {
  throw 0;
} catch {
  doSomethingWhichDoesNotCareAboutTheValueThrown();
}

try {
  throw 0;
} catch {
  doSomethingWhichDoesNotCareAboutTheValueThrown();
} finally {
  doSomeCleanup();
}
