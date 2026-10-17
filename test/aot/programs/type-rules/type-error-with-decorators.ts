// A type error stops the build in a file that has decorators as in any other: inside a function that runs, inside a method, in an argument.
const plain = (value: unknown, context: unknown) => {};
class Decorated {
  @plain method() {
    const inAMethod: number = "a method";
    return inAMethod;
  }
}
function called() {
  const inAFunction: boolean = "a function";
  return inAFunction;
}
const arrow = () => {
  const inAnArrow: bigint = "an arrow";
  return inAnArrow;
};
function takes(given: symbol) {
  return given;
}
console.log(new Decorated().method(), called(), arrow(), takes("an argument"));
