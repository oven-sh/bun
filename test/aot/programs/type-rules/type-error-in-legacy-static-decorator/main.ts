// The decorators of a method are evaluated with the class, also where nobody calls the method: a type error in one stops the build.
const made = (option: unknown) => (target: unknown, key: unknown, descriptor?: unknown) => {};
class Decorated {
  @made((1 as number).first) static fixed() {}
  @made((1 as number).second) method() {}
}
console.log(typeof Decorated);
