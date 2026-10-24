// A type error in code that folding removes does not stop the build, and a `@ts-expect-error` there is not reported as unused.
if (false) {
  const a: number = "one";
  // @ts-expect-error
  const b: number = "two";
  missing(a, b);
}
console.log("printed");
