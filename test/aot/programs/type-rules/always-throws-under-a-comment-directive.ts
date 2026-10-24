// `// @ts-expect-error` and `// @ts-ignore` silence every diagnostic on the next line, "this always throws a TypeError under --aot"
// among them: whoever wrote the comment knows that the line is ill-typed, and the line may never run. The build goes on. What the
// line does when it runs is unchanged: the argument is still held to the parameter's type.
interface Matcher {
  kind: string;
}
function match(pattern: Matcher, handler: () => number[]): number[] {
  return pattern.kind ? handler() : [];
}
function underExpectError() {
  // @ts-expect-error
  return match(1, () => [1, 2]);
}
function underIgnore() {
  // @ts-ignore
  return match(2, () => [1, 2]);
}
function insideAnExpression() {
  return [
    // @ts-expect-error: a reason
    match(3, () => [1, 2]),
  ];
}
function neverCalled() {
  // @ts-expect-error
  return match(4, () => [1, 2]);
}
for (const call of [underExpectError, underIgnore, insideAnExpression]) {
  try {
    console.log(call.name, "returned", JSON.stringify(call()));
  } catch (error) {
    console.log(call.name, "threw a TypeError:", error instanceof TypeError);
  }
}
console.log(typeof neverCalled, JSON.stringify(match({ kind: "k" }, () => [1, 2])));
