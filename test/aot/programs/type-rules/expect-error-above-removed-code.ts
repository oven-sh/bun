// A `@ts-expect-error` directly above code that folding removes is not reported as unused: the error it expects is in code that is not checked.
// @ts-expect-error
if (false) missing();
const kept = false &&
  // @ts-expect-error
  missing();
console.log("printed", kept);
