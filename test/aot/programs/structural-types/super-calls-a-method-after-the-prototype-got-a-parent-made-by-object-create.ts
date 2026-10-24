class First {
  greet(): string {
    return "first";
  }
}
class Child extends First {
  greet(): string {
    return "child > " + super.greet();
  }
}
const child = new Child();
console.log("zq " + child.greet());
const between = Object.create(First.prototype, { greet: { value: () => "between", configurable: true } });
Object.setPrototypeOf(Child.prototype, between);
console.log("zq " + child.greet());
