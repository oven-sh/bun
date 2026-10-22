class Bare extends null {
  static hello(): string {
    return "static members work";
  }
}

console.log(Bare.hello());
console.log("prototype of the prototype: " + Object.getPrototypeOf(Bare.prototype));
console.log("prototype of the class is Function.prototype: " + (Object.getPrototypeOf(Bare) === Function.prototype));
try {
  new Bare();
  console.log("constructed");
} catch (error) {
  console.log("construction threw a TypeError: " + (error instanceof TypeError));
}
