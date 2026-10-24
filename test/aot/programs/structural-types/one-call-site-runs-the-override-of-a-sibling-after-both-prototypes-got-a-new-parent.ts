class First {
  greet(): string {
    return "first";
  }
}
class Child extends First {
  greet(): string {
    return "child";
  }
}
class Plain extends First {}
function greet(f: First): string {
  return f.greet();
}
const child = new Child();
const plain = new Plain();
console.log("zq " + greet(child) + " " + greet(plain));
const between = Object.create(First.prototype, { greet: { value: () => "between", configurable: true } });
Object.setPrototypeOf(Child.prototype, between);
Object.setPrototypeOf(Plain.prototype, between);
console.log("zq " + greet(child) + " " + greet(plain));
